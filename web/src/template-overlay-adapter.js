import { normalizeExperimentIndex, normalizeFeatureTree } from "./data-adapter.js";

export class TemplateOverlayDataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TemplateOverlayDataError";
    this.details = details;
  }
}

const asArray = (value) => Array.isArray(value) ? value : [];

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeRelation(relation) {
  const url = safeUrl(relation?.url);
  if (!url) return null;
  return Object.freeze({
    type: String(relation?.type ?? "external_reference"),
    label: String(relation?.label ?? url),
    url,
  });
}

function normalizeNode(node) {
  return Object.freeze({
    ...node,
    id: String(node?.id ?? ""),
    external_architecture_id: String(node?.external_architecture_id ?? ""),
    maps_to_feature_id: String(node?.maps_to_feature_id ?? ""),
    merge_strategy: String(node?.merge_strategy ?? "external-display-local-structure"),
    title: String(node?.title ?? node?.external_architecture_id ?? "External submission"),
    title_zh: String(node?.title_zh ?? ""),
    summary: String(node?.summary ?? ""),
    summary_zh: String(node?.summary_zh ?? ""),
    status: String(node?.status ?? "open"),
    proposal_type: String(node?.proposal_type ?? "architecture proposal"),
    hypothesis: String(node?.hypothesis ?? ""),
    temporary_equivalence: node?.temporary_equivalence && typeof node.temporary_equivalence === "object"
      ? Object.freeze({ ...node.temporary_equivalence })
      : Object.freeze({}),
    issue: node?.issue && typeof node.issue === "object" ? Object.freeze({ ...node.issue, url: safeUrl(node.issue.url) }) : null,
    pull_request: node?.pull_request && typeof node.pull_request === "object"
      ? Object.freeze({ ...node.pull_request, url: safeUrl(node.pull_request.url) })
      : null,
    model_configuration: node?.model_configuration && typeof node.model_configuration === "object"
      ? Object.freeze({ ...node.model_configuration })
      : Object.freeze({}),
    commits: Object.freeze(asArray(node?.commits).map((commit) => Object.freeze({
      sha: String(commit?.sha ?? ""),
      message: String(commit?.message ?? ""),
      author: String(commit?.author ?? ""),
      authored_at: String(commit?.authored_at ?? ""),
      url: safeUrl(commit?.url),
    })).filter((commit) => commit.sha)),
    implementation_files: Object.freeze(asArray(node?.implementation_files).map((file) => Object.freeze({
      path: String(file?.path ?? ""),
      url: safeUrl(file?.url),
      status: String(file?.status ?? ""),
      additions: file?.additions != null && Number.isFinite(Number(file.additions)) ? Number(file.additions) : null,
      deletions: file?.deletions != null && Number.isFinite(Number(file.deletions)) ? Number(file.deletions) : null,
      blob_sha: String(file?.blob_sha ?? ""),
      content_sha256: String(file?.content_sha256 ?? ""),
      line_count: file?.line_count != null && Number.isFinite(Number(file.line_count)) ? Number(file.line_count) : null,
      symbols: Object.freeze(asArray(file?.symbols).map(String).filter(Boolean)),
      excerpt: String(file?.excerpt ?? ""),
    })).filter((file) => file.path)),
    relations: Object.freeze(asArray(node?.relations).map(normalizeRelation).filter(Boolean)),
    warnings: Object.freeze(asArray(node?.warnings).map(String).filter(Boolean)),
    related_feature_ids: Object.freeze(asArray(node?.related_feature_ids).map(String).filter(Boolean)),
  });
}

export function normalizeTemplateOverlay(payload, tree = null) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.nodes) || !Array.isArray(payload.experiments)) {
    throw new TemplateOverlayDataError("Template overlay 数据形状无效");
  }
  const nodes = payload.nodes.map(normalizeNode);
  const errors = [];
  const byFeatureId = new Map();
  const ids = new Set();
  for (const node of nodes) {
    if (!node.id) errors.push("overlay node 缺少 id");
    else if (ids.has(node.id)) errors.push(`重复的 overlay node id: ${node.id}`);
    else ids.add(node.id);
    if (!node.maps_to_feature_id) errors.push(`${node.id} 缺少 maps_to_feature_id`);
    if (tree?.byId && !tree.byId.has(node.maps_to_feature_id)) {
      errors.push(`${node.id} 映射的 Feature 不存在: ${node.maps_to_feature_id}`);
    }
    for (const relatedId of node.related_feature_ids) {
      if (tree?.byId && !tree.byId.has(relatedId)) errors.push(`${node.id} 的 overlay relation 不存在: ${relatedId}`);
    }
    if (!byFeatureId.has(node.maps_to_feature_id)) byFeatureId.set(node.maps_to_feature_id, []);
    byFeatureId.get(node.maps_to_feature_id).push(node);
  }
  if (errors.length) throw new TemplateOverlayDataError("Template overlay 数据无效", errors);
  return Object.freeze({
    id: String(payload.overlay_id ?? "template-overlay"),
    sourceRepository: String(payload.source_repository ?? ""),
    fetchedAt: String(payload.fetched_at ?? ""),
    mergePolicy: Object.freeze({ ...(payload.merge_policy ?? {}) }),
    nodes: Object.freeze(nodes),
    experiments: Object.freeze(payload.experiments.map((experiment) => Object.freeze({ ...experiment }))),
    byFeatureId,
  });
}

export async function loadTemplateOverlay(url = "../data/template-test-overlay.json", tree = null, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (error) {
    throw new TemplateOverlayDataError(`无法连接 template overlay 数据源: ${error.message}`);
  }
  if (!response.ok) throw new TemplateOverlayDataError(`Template overlay 数据源返回 ${response.status}`);
  try {
    return normalizeTemplateOverlay(await response.json(), tree);
  } catch (error) {
    if (error instanceof TemplateOverlayDataError) throw error;
    throw new TemplateOverlayDataError(`Template overlay JSON 无法解析: ${error.message}`);
  }
}

function localFeatureSnapshot(feature) {
  return Object.freeze({
    id: feature.id,
    title: feature.title,
    title_zh: feature.title_zh,
    summary: feature.summary,
    summary_zh: feature.summary_zh,
    kind: feature.kind,
    category: feature.category ?? (feature.kind === "baseline" ? "baseline" : "architecture"),
    baseline: feature.baseline ?? null,
  });
}

export function applyTemplateOverlay(tree, overlay) {
  const features = tree.features.map((feature) => {
    const overlays = overlay.byFeatureId.get(feature.id) ?? [];
    if (!overlays.length) return feature;
    const external = overlays.at(-1);
    const relatedTo = [...new Set([...feature.related_to, ...external.related_feature_ids])];
    return {
      ...feature,
      title: external.title || feature.title,
      title_zh: external.title_zh || feature.title_zh,
      summary: external.summary || feature.summary,
      summary_zh: external.summary_zh || feature.summary_zh,
      related_to: relatedTo,
      template_overlay: Object.freeze({
        source_repository: overlay.sourceRepository,
        fetched_at: overlay.fetchedAt,
        merge_policy: overlay.mergePolicy,
        local: localFeatureSnapshot(feature),
        external,
        overlays: Object.freeze(overlays),
      }),
    };
  });
  return normalizeFeatureTree({
    features,
    metadata: {
      ...tree.metadata,
      template_overlay: {
        id: overlay.id,
        source_repository: overlay.sourceRepository,
        fetched_at: overlay.fetchedAt,
        mapped_nodes: overlay.nodes.length,
      },
    },
  });
}

function evidenceKey(evidence) {
  return `${evidence?.locator ?? ""}\u0000${evidence?.label ?? evidence?.id ?? ""}`;
}

function unionEvidence(localEvidence, externalEvidence) {
  const merged = new Map();
  for (const evidence of [...asArray(localEvidence), ...asArray(externalEvidence)]) {
    merged.set(evidenceKey(evidence), evidence);
  }
  return [...merged.values()];
}

function experimentSnapshot(experiment) {
  return Object.freeze({
    id: experiment.id,
    title: experiment.title,
    title_zh: experiment.title_zh,
    status: experiment.status,
    cursor_type: experiment.cursor_type,
    wandb_url: experiment.wandb_url,
    final_metrics: Object.freeze({ ...(experiment.final_metrics ?? {}) }),
  });
}

export function applyTemplateExperiments(experimentIndex, overlay, tree) {
  const experiments = experimentIndex.experiments.map((experiment) => ({ ...experiment }));
  for (const external of overlay.experiments) {
    const replacementId = external.replaces_experiment_id;
    const matchIndex = experiments.findIndex((local) =>
      (replacementId && local.id === replacementId)
      || (external.wandb_url && local.wandb_url === external.wandb_url));
    if (matchIndex < 0) {
      experiments.push({
        ...external,
        template_overlay: {
          source_repository: overlay.sourceRepository,
          external_experiment_id: external.id,
          local: null,
        },
      });
      continue;
    }
    const local = experiments[matchIndex];
    experiments[matchIndex] = {
      ...local,
      ...external,
      id: local.id,
      covered_feature_ids: [...new Set([...local.covered_feature_ids, ...asArray(external.covered_feature_ids)])],
      primary_feature_ids: [...new Set([...local.primary_feature_ids, ...asArray(external.primary_feature_ids)])],
      final_metrics: { ...(local.final_metrics ?? {}), ...(external.final_metrics ?? {}) },
      evidence: unionEvidence(local.evidence, external.evidence),
      template_overlay: {
        source_repository: overlay.sourceRepository,
        external_experiment_id: external.id,
        local: experimentSnapshot(local),
      },
    };
  }
  return normalizeExperimentIndex({
    experiments,
    metadata: {
      ...experimentIndex.metadata,
      template_overlay: {
        id: overlay.id,
        source_repository: overlay.sourceRepository,
        adapted_experiments: overlay.experiments.length,
      },
    },
  }, tree);
}
