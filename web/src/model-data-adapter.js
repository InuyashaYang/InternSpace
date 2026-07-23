export class ModelDataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ModelDataError";
    this.details = details;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").replace(/^`|`$/g, "").trim();
}

function issueReferenceNumber(value) {
  if (value && typeof value === "object") {
    const number = Number(value.number);
    if (Number.isInteger(number) && number > 0) return number;
    value = value.raw || value.label || value.url;
  }
  const match = cleanText(value).match(/(?:^|\/issues\/|#)(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

function issueArchitectureName(issue) {
  return cleanText(issue?.architecture_name)
    || cleanText(issue?.parsed?.architectureName)
    || cleanText(issue?.title).replace(/^\[ARCH-PROP\]\s*/i, "")
    || `Issue #${issue?.number ?? "?"}`;
}

function issueParent(issue) {
  return issue?.parent_issue ?? issue?.parsed?.parentIssue ?? null;
}

function issueText(issue, snakeKey, parsedKey) {
  return cleanText(issue?.[snakeKey] ?? issue?.parsed?.[parsedKey]);
}

function issueRelatedWork(issue) {
  const value = issue?.related_work ?? issue?.parsed?.relatedWork ?? {};
  return {
    text: cleanText(value?.text ?? value?.raw),
    references: asArray(value?.references),
  };
}

function proposalIssueNumber(pullRequest) {
  return issueReferenceNumber(
    pullRequest?.proposal_issue
      ?? pullRequest?.parsed?.basicInformation?.proposalIssue
      ?? pullRequest?.parsed?.relatedArchitecture?.proposalIssue,
  );
}

function normalizePullRequest(pullRequest) {
  const parsed = pullRequest?.parsed ?? {};
  return {
    ...pullRequest,
    architecture_name: cleanText(
      pullRequest?.architecture_name
        ?? parsed?.basicInformation?.architectureName
        ?? parsed?.templateTitle
        ?? pullRequest?.title,
    ),
    proposal_issue_number: proposalIssueNumber(pullRequest),
    implementation_summary: cleanText(pullRequest?.implementation_summary ?? parsed?.implementationSummary),
    experiments_summary: cleanText(pullRequest?.experiments_summary ?? parsed?.experimentsSummary),
    experiments_outcome: asArray(pullRequest?.experiments_outcome ?? parsed?.experimentsOutcome),
    reproduction_status: asArray(pullRequest?.reproduction_status ?? parsed?.reproductionStatus),
    conclusion: cleanText(pullRequest?.conclusion ?? parsed?.conclusion),
    merge_checklist: asArray(pullRequest?.merge_checklist ?? parsed?.mergeChecklist),
    wandb_links: asArray(pullRequest?.wandb_links).length
      ? asArray(pullRequest.wandb_links)
      : Object.entries(parsed?.wandbLinks ?? {}).flatMap(([label, value]) => value?.url ? [{ label, url: value.url }] : []),
    commits: asArray(pullRequest?.commits),
    files: asArray(pullRequest?.files),
  };
}

function buildChildren(nodes) {
  const childrenById = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    if (node.parent_id && childrenById.has(node.parent_id)) childrenById.get(node.parent_id).push(node);
  }
  for (const children of childrenById.values()) {
    children.sort((left, right) => left.issueNumber - right.issueNumber);
  }
  return childrenById;
}

function repairCycles(nodes, byId, rootId, warnings) {
  for (const node of nodes) {
    if (node.id === rootId) continue;
    const visited = new Set([node.id]);
    let cursor = node;
    while (cursor.parent_id) {
      if (visited.has(cursor.parent_id)) {
        warnings.push(`${node.id} 的 Parent issue 形成循环，已回挂根节点`);
        node.parent_id = rootId;
        break;
      }
      visited.add(cursor.parent_id);
      cursor = byId.get(cursor.parent_id);
      if (!cursor) {
        node.parent_id = rootId;
        break;
      }
    }
  }
}

function auxiliaryFeatureTitle(feature) {
  return cleanText(feature?.title_zh) || cleanText(feature?.title) || cleanText(feature?.id);
}

export function normalizeModelGraph(payload, auxiliaryPayload = { features: [] }) {
  if (!payload || typeof payload !== "object") throw new ModelDataError("模型数据库必须是 JSON 对象");
  const issues = asArray(payload.issues);
  if (!issues.length) throw new ModelDataError("模型数据库中没有 Architecture Proposal Issue");

  const rootIssueNumber = Number(payload?.mapping?.root_issue_number ?? 13);
  const issueByNumber = new Map(issues.map((issue) => [Number(issue.number), issue]));
  if (!issueByNumber.has(rootIssueNumber)) {
    throw new ModelDataError(`模型数据库缺少配置的根 Issue #${rootIssueNumber}`);
  }

  const pullRequests = asArray(payload.pull_requests ?? payload.pullRequests).map(normalizePullRequest);
  const pullRequestsByIssue = new Map(issues.map((issue) => [Number(issue.number), []]));
  const unmatchedPullRequests = [];
  for (const pullRequest of pullRequests) {
    const target = pullRequestsByIssue.get(pullRequest.proposal_issue_number);
    target ? target.push(pullRequest) : unmatchedPullRequests.push(pullRequest);
  }

  const warnings = [];
  const nodes = issues.map((issue) => {
    const issueNumber = Number(issue.number);
    const parentIssue = issueParent(issue);
    const parentIssueNumber = issueReferenceNumber(parentIssue);
    let parentId = null;
    if (issueNumber !== rootIssueNumber) {
      if (parentIssueNumber && parentIssueNumber !== issueNumber && issueByNumber.has(parentIssueNumber)) {
        parentId = `issue-${parentIssueNumber}`;
      } else {
        parentId = `issue-${rootIssueNumber}`;
        warnings.push(`Issue #${issueNumber} 的 Parent issue 无法解析，已回挂根节点`);
      }
    }
    const architectureName = issueArchitectureName(issue);
    return {
      id: `issue-${issueNumber}`,
      nodeType: "model",
      issueNumber,
      title: architectureName,
      title_zh: cleanText(issue?.title_zh) || architectureName,
      summary: issueText(issue, "motivations", "motivations"),
      parent_id: parentId,
      category: issueNumber === rootIssueNumber ? "root_model" : "model",
      state: cleanText(issue?.state).toLowerCase() || "unknown",
      issue,
      parentIssue,
      parentIssueNumber,
      relatedWork: issueRelatedWork(issue),
      motivations: issueText(issue, "motivations", "motivations"),
      proposedArchitecture: issueText(issue, "proposed_architecture", "proposedArchitecture"),
      experimentsPlan: issueText(issue, "experiments_plan", "experimentsPlan"),
      pullRequests: pullRequestsByIssue.get(issueNumber) ?? [],
      depends_on: [],
      related_to: [],
    };
  });

  const rootId = `issue-${rootIssueNumber}`;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  repairCycles(nodes, byId, rootId, warnings);
  const childrenById = buildChildren(nodes);
  const auxiliaryFeatures = asArray(auxiliaryPayload?.features).map((feature) => ({
    ...feature,
    displayTitle: auxiliaryFeatureTitle(feature),
  }));

  return Object.freeze({
    rootId,
    features: Object.freeze(nodes),
    models: Object.freeze(nodes),
    byId,
    childrenById,
    pullRequests: Object.freeze(pullRequests),
    unmatchedPullRequests: Object.freeze(unmatchedPullRequests),
    auxiliaryFeatures: Object.freeze(auxiliaryFeatures),
    source: payload.source ?? {},
    mapping: payload.mapping ?? {},
    warnings: Object.freeze(warnings),
    stats: Object.freeze({
      models: nodes.length,
      openIssues: nodes.filter((node) => node.state === "open").length,
      pullRequests: pullRequests.length,
      parentLinks: nodes.filter((node) => node.parent_id).length,
      auxiliaryFeatures: auxiliaryFeatures.length,
    }),
  });
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new ModelDataError(`${url} 返回 ${response.status}`);
  return response.json();
}

export async function loadModelGraph(
  modelUrl = "../data/template-test-data.json",
  auxiliaryUrl = "../data/feature-tree.json",
  fetchImpl = fetch,
) {
  try {
    const [modelPayload, auxiliaryPayload] = await Promise.all([
      fetchJson(modelUrl, fetchImpl),
      fetchJson(auxiliaryUrl, fetchImpl),
    ]);
    return normalizeModelGraph(modelPayload, auxiliaryPayload);
  } catch (error) {
    if (error instanceof ModelDataError) throw error;
    throw new ModelDataError(`模型数据库无法加载: ${error.message}`);
  }
}

export function modelTitle(model) {
  return model?.title_zh || model?.title || model?.id || "未命名模型";
}

export function modelSubtitle(model) {
  const english = cleanText(model?.title);
  const issue = `Issue #${model?.issueNumber ?? "?"}`;
  return english && english !== modelTitle(model) ? `${english} · ${issue}` : issue;
}

export function compactModelTitle(model, limit = 22) {
  const title = modelTitle(model);
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}

export function matchesModelSearch(model, query) {
  const term = cleanText(query).toLocaleLowerCase("zh-CN");
  if (!term) return false;
  const searchText = JSON.stringify({
    title: model.title,
    title_zh: model.title_zh,
    issue: model.issue,
    pullRequests: model.pullRequests,
  }).toLocaleLowerCase("zh-CN");
  return searchText.includes(term);
}
