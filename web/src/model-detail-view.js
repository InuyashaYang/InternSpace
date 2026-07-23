import { modelSubtitle, modelTitle } from "./model-data-adapter.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function cleanDisplay(value) {
  return String(value ?? "").replace(/^`|`$/g, "").trim();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(access.?token|auth|credential|key|secret|signature)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.hostname === "wandb.ai") url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function textBlock(value, empty = "未填写") {
  const text = cleanDisplay(value);
  if (!text) return `<span class="empty-value">${escapeHtml(empty)}</span>`;
  return `<p class="copy-block">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

function externalLink(url, label = "打开来源") {
  const safe = safeExternalUrl(url);
  return safe
    ? `<a class="source-link" href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
    : "";
}

function section(title, content, className = "") {
  return content ? `<section class="detail-section ${className}"><h3>${escapeHtml(title)}</h3><div>${content}</div></section>` : "";
}

function facts(entries) {
  const rows = entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(cleanDisplay(value))}</dd></div>`)
    .join("");
  return rows ? `<dl class="fact-list">${rows}</dl>` : "";
}

function renderCheckboxes(items) {
  if (!items?.length) return "";
  return `<ul class="check-list">${items.map((item) => `
    <li class="${item.checked ? "is-checked" : ""}"><span aria-hidden="true">${item.checked ? "✓" : "○"}</span>${escapeHtml(item.label)}</li>
  `).join("")}</ul>`;
}

function renderRelatedWork(model) {
  const links = (model.relatedWork?.references ?? [])
    .map((reference) => externalLink(reference?.url, reference?.label || "相关来源"))
    .filter(Boolean)
    .join("");
  return [textBlock(model.relatedWork?.text, ""), links ? `<div class="source-links">${links}</div>` : ""]
    .filter(Boolean)
    .join("");
}

function featureCodeLinks(feature) {
  const locators = feature?.implementation?.code_symbols ?? feature?.implementation?.code_locators ?? feature?.code_locators ?? [];
  return (Array.isArray(locators) ? locators : []).slice(0, 3).map((locator) => {
    const label = locator.symbol || locator.path || "代码位置";
    return externalLink(locator.url || locator.pinned_url, label);
  }).filter(Boolean).join("");
}

function renderAuxiliaryFeatures(tree) {
  if (!tree.auxiliaryFeatures.length) return "";
  return `
    <p class="auxiliary-note">这些是 InternSpace 原有 Feature 档案，仅作为当前模型根节点的补充说明与证据，不参与主画布布局。</p>
    <div class="auxiliary-feature-list">
      ${tree.auxiliaryFeatures.map((feature) => `
        <article class="auxiliary-feature-card">
          <div><strong>${escapeHtml(feature.displayTitle)}</strong><code>${escapeHtml(feature.id)}</code></div>
          <span>${escapeHtml(feature.status || "unknown")}</span>
          ${textBlock(feature.summary_zh || feature.summary, "暂无摘要")}
          ${featureCodeLinks(feature) ? `<div class="source-links">${featureCodeLinks(feature)}</div>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderProposal(model, tree) {
  const parent = model.parent_id ? tree.byId.get(model.parent_id) : null;
  const issueLink = externalLink(model.issue?.url, `打开 Issue #${model.issueNumber}`);
  return `
    ${section("模型关系", facts([
      ["模型节点", modelTitle(model)],
      ["Parent", parent ? modelTitle(parent) : "谱系根节点"],
      ["Parent issue", model.parentIssueNumber ? `#${model.parentIssueNumber}` : "None"],
      ["Issue 状态", model.state],
      ["作者", model.issue?.author],
    ]) + issueLink, "model-relation")}
    ${section("动机 / Motivations", textBlock(model.motivations))}
    ${section("架构提案 / Proposed Architecture", textBlock(model.proposedArchitecture))}
    ${section("实验计划 / Experiments Plan", textBlock(model.experimentsPlan))}
    ${section("相关工作 / Related Work", renderRelatedWork(model))}
    ${model.id === tree.rootId ? section(`辅助 Feature 档案（${tree.auxiliaryFeatures.length}）`, renderAuxiliaryFeatures(tree), "auxiliary-feature-section") : ""}
  `;
}

function renderWandbLinks(links) {
  const rendered = (links ?? []).map((link) => externalLink(link?.url, link?.label || "W&B")).filter(Boolean);
  return rendered.length ? `<div class="source-links">${rendered.join("")}</div>` : "";
}

function renderCommits(commits) {
  if (!commits?.length) return "";
  return `<div class="commit-list">${commits.map((commit) => `
    <a href="${escapeHtml(safeExternalUrl(commit.url))}" target="_blank" rel="noreferrer">
      <code>${escapeHtml(String(commit.sha || "").slice(0, 10))}</code>
      <strong>${escapeHtml(commit.message || "无提交说明")}</strong>
      <small>${escapeHtml(commit.author || "unknown")}</small>
    </a>
  `).join("")}</div>`;
}

function renderFiles(files) {
  if (!files?.length) return "";
  return `<div class="code-file-list">${files.map((file) => {
    const symbols = (file.symbols ?? []).slice(0, 12).map((symbol) => `<code>${escapeHtml(symbol)}</code>`).join("");
    const link = externalLink(file.url, file.path || "打开代码");
    return `<article class="code-file-card">
      ${link}
      <small>+${escapeHtml(file.additions ?? 0)} / -${escapeHtml(file.deletions ?? 0)} · SHA-256 ${escapeHtml(String(file.content_sha256 || "").slice(0, 16) || "unavailable")}</small>
      ${symbols ? `<div class="code-symbols">${symbols}</div>` : ""}
      ${file.excerpt ? `<details><summary>查看有限代码摘录</summary><pre><code>${escapeHtml(file.excerpt)}</code></pre></details>` : ""}
    </article>`;
  }).join("")}</div>`;
}

function renderPullRequest(pullRequest) {
  const base = pullRequest.base ? `${pullRequest.base.repo || ""}:${pullRequest.base.branch || ""}` : "";
  const head = pullRequest.head ? `${pullRequest.head.repo || ""}:${pullRequest.head.branch || ""}` : "";
  const state = pullRequest.merged ? "merged" : pullRequest.state;
  return `
    <section class="pr-summary">
      <div>
        <span class="pr-state pr-state-${escapeHtml(state)}">${escapeHtml(state)}</span>
        <strong>${escapeHtml(pullRequest.architecture_name || pullRequest.title)}</strong>
        <small>PR #${escapeHtml(pullRequest.number)} · ${escapeHtml(pullRequest.author || "unknown")}</small>
      </div>
      ${externalLink(pullRequest.url, "打开 Pull Request")}
    </section>
    ${section("实现关系", facts([
      ["Proposal Issue", `#${pullRequest.proposal_issue_number}`],
      ["Base", base],
      ["Head", head],
      ["Commits", pullRequest.commit_count ?? pullRequest.commitCount],
      ["Changed files", pullRequest.changed_files ?? pullRequest.changedFiles],
      ["Additions / Deletions", `+${pullRequest.additions ?? 0} / -${pullRequest.deletions ?? 0}`],
    ]))}
    ${section("W&B 与实验链接", renderWandbLinks(pullRequest.wandb_links))}
    ${section("实现摘要", textBlock(pullRequest.implementation_summary))}
    ${section("实验摘要", textBlock(pullRequest.experiments_summary))}
    ${section("实验结论", renderCheckboxes(pullRequest.experiments_outcome))}
    ${section("复现状态", renderCheckboxes(pullRequest.reproduction_status))}
    ${section("结论", textBlock(pullRequest.conclusion))}
    ${section("合并检查", renderCheckboxes(pullRequest.merge_checklist))}
    ${section(`提交记录（${pullRequest.commits.length}）`, renderCommits(pullRequest.commits))}
    ${section(`代码位置（${pullRequest.files.length}）`, renderFiles(pullRequest.files))}
  `;
}

function tabsForModel(model) {
  return [
    { id: "proposal", label: `Issue #${model.issueNumber}` },
    ...model.pullRequests.map((pullRequest) => ({ id: `pr-${pullRequest.number}`, label: `PR #${pullRequest.number}` })),
  ];
}

export function renderModelDetail(model, tree, requestedTab = "") {
  const tabs = tabsForModel(model);
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0].id;
  const pullRequest = activeTab.startsWith("pr-")
    ? model.pullRequests.find((item) => `pr-${item.number}` === activeTab)
    : null;
  const content = pullRequest ? renderPullRequest(pullRequest) : renderProposal(model, tree);
  return `
    <div class="detail-header model-detail-header">
      <div class="detail-eyebrow status-${escapeHtml(model.state)}"><span class="status-dot"></span>${escapeHtml(model.state)}<span class="detail-category">${escapeHtml(model.category)}</span></div>
      <h1>${escapeHtml(modelTitle(model))}</h1>
      <code>${escapeHtml(modelSubtitle(model))}</code>
    </div>
    <div class="model-tabs" role="tablist" aria-label="${escapeHtml(modelTitle(model))} 信息">
      ${tabs.map((tab) => `<button type="button" role="tab" data-detail-tab="${escapeHtml(tab.id)}" aria-selected="${tab.id === activeTab}">${escapeHtml(tab.label)}</button>`).join("")}
    </div>
    <div class="model-tab-panel" role="tabpanel">${content}</div>
  `;
}
