import { featureEnglishSubtitle, featureSummary, featureTitle } from "./feature-display.js";
import {
  configurationView,
  deltaOperations,
  featureValidation,
  structuredCodeLocators,
  validationView,
} from "./feature-view-model.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const labelFor = (key) => ({
  commits: "Commits",
  sessions: "Sessions",
  code_symbols: "Python / 代码符号",
  repositories: "代码仓库",
  checkpoints: "Checkpoints",
}[key] ?? key.replaceAll("_", " "));

function renderValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (!value.length) return "";
    return `<ul>${value.map((item) => `<li>${renderValue(item)}</li>`).join("")}</ul>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item != null && item !== "" && (!Array.isArray(item) || item.length));
    if (!entries.length) return "";
    return `<dl class="fact-list">${entries.map(([key, item]) => `<div><dt>${escapeHtml(labelFor(key))}</dt><dd>${renderValue(item)}</dd></div>`).join("")}</dl>`;
  }
  const text = escapeHtml(value);
  return /^https?:\/\//.test(String(value)) ? `<a href="${text}" target="_blank" rel="noreferrer">${text}</a>` : text;
}

function section(title, value, className = "") {
  const content = renderValue(value);
  if (!content) return "";
  return `<section class="detail-section ${className}"><h3>${title}</h3><div>${content}</div></section>`;
}

function htmlSection(title, content, className = "") {
  if (!content) return "";
  return `<section class="detail-section ${className}"><h3>${title}</h3>${content}</section>`;
}

function renderDelta(feature, parent) {
  const operations = deltaOperations(feature);
  if (!operations.length && !parent) return "";
  const parentHtml = parent
    ? `<p class="detail-parent"><span>结构父 Feature</span><strong>${escapeHtml(featureTitle(parent))}</strong><code>${escapeHtml(parent.id)}</code></p>`
    : "";
  const operationHtml = operations.map((operation) => `
    <article class="delta-card">
      ${operation.target ? `<code class="delta-target">${escapeHtml(operation.target)}</code>` : ""}
      <div class="delta-grid">
        <div><span>Before</span>${renderValue(operation.before) || "<em>未记录</em>"}</div>
        <div><span>After</span>${renderValue(operation.after) || "<em>未记录</em>"}</div>
      </div>
      ${operation.rationale ? `<p>${escapeHtml(operation.rationale)}</p>` : ""}
    </article>
  `).join("");
  return htmlSection("相对父节点的变化", `<div>${parentHtml}${operationHtml}</div>`, "detail-delta");
}

function renderConfiguration(feature) {
  const config = configurationView(feature);
  if (!config.design && !config.parameters && !feature.baseline) return "";
  const content = [
    config.design ? `<div class="config-design"><span>设计</span><p>${escapeHtml(config.design)}</p></div>` : "",
    config.parameters ? `<div class="config-parameters"><span>配置开关 / 参数</span>${renderValue(config.parameters)}</div>` : "",
    feature.baseline ? `<div class="config-parameters"><span>标准态 pin 状态</span>${renderValue(feature.baseline)}</div>` : "",
  ].join("");
  return htmlSection("设计 / 配置开关与参数", `<div>${content}</div>`, "detail-config");
}

function renderLocators(feature) {
  const locators = structuredCodeLocators(feature);
  if (!locators.length) return "";
  const content = locators.map((locator) => `
    <article class="locator-card">
      <strong class="locator-symbol">${escapeHtml(locator.symbol || locator.id || "代码位置")}</strong>
      <dl>
        ${locator.repository ? `<div><dt>Repository</dt><dd>${escapeHtml(locator.repository)}</dd></div>` : ""}
        ${locator.revision ? `<div><dt>Full revision</dt><dd><code>${escapeHtml(locator.revision)}</code></dd></div>` : ""}
        ${locator.path ? `<div><dt>Path</dt><dd><code>${escapeHtml(locator.path)}</code></dd></div>` : ""}
        ${locator.symbol ? `<div><dt>Symbol</dt><dd><code>${escapeHtml(locator.symbol)}</code></dd></div>` : ""}
        ${locator.role ? `<div><dt>Role</dt><dd>${escapeHtml(locator.role)}</dd></div>` : ""}
      </dl>
      ${locator.pinnedUrl ? `<a class="pinned-link" href="${escapeHtml(locator.pinnedUrl)}" target="_blank" rel="noreferrer">打开 commit-pinned source ↗</a>` : ""}
    </article>
  `).join("");
  return htmlSection("实现 / 结构化代码定位", `<div class="locator-list">${content}</div>`, "detail-locators");
}

function validationRow(label, value) {
  const content = renderValue(value);
  return content ? `<div class="validation-row"><span>${label}</span>${content}</div>` : "";
}

function renderValidation(feature) {
  if (feature.kind === "baseline") return "";
  const view = validationView(feature);
  const rows = [
    validationRow("假设 / 需求", view.hypothesis),
    validationRow("Comparison", view.comparison),
    validationRow("Conditions", view.conditions),
    validationRow("Metrics", view.metrics),
    validationRow("证据 / Artifacts", view.artifacts),
    validationRow("Observations", view.observations),
    validationRow("Conclusion", view.conclusion),
  ].join("");
  return htmlSection("验证 / 分析与结论", `
    <div class="validation-summary validation-${view.validation.key}">
      <span class="validation-pill">${escapeHtml(view.validation.label)}</span>
      ${view.statement ? `<strong>${escapeHtml(view.statement)}</strong>` : ""}
    </div>
    <div class="validation-rows">${rows}</div>
  `, "detail-validation");
}

function renderRelations(feature, tree) {
  const dependencies = feature.depends_on.map((id) => tree.byId.get(id)).filter(Boolean);
  const related = feature.related_to.map((id) => tree.byId.get(id)).filter(Boolean);
  if (!dependencies.length && !related.length) return "";
  return section("辅助关系", {
    ...(dependencies.length ? { "依赖 Feature": dependencies.map((item) => `${featureTitle(item)} · ${item.id}`) } : {}),
    ...(related.length ? { "相关 Feature": related.map((item) => `${featureTitle(item)} · ${item.id}`) } : {}),
  });
}

function renderLimitationsAndProvenance(feature) {
  const validation = validationView(feature);
  const content = {
    ...(validation.limitations.length ? { Limitations: validation.limitations } : {}),
    ...(feature.evidence?.length ? { Evidence: feature.evidence } : {}),
    ...(feature.provenance && Object.keys(feature.provenance).length ? { "来源 / Provenance": feature.provenance } : {}),
  };
  return section("Limitations / 来源与 provenance", content, "detail-provenance");
}

export function renderDetail(feature, tree) {
  const parent = feature.parent_id ? tree.byId.get(feature.parent_id) : null;
  const validation = featureValidation(feature);
  const englishSubtitle = featureEnglishSubtitle(feature)
    ? `<p class="detail-title-en">${escapeHtml(featureEnglishSubtitle(feature))}</p>`
    : "";
  return `
    <div class="detail-header">
      <div class="detail-eyebrow validation-${validation.key}"><span class="status-dot"></span>${escapeHtml(validation.label)}<span class="detail-category">${escapeHtml(feature.category ?? (feature.kind === "baseline" ? "baseline" : "feature"))}</span></div>
      <h1>${escapeHtml(featureTitle(feature))}</h1>
      ${englishSubtitle}
      <code>${escapeHtml(feature.id)}</code>
    </div>
    ${section("一句话结构作用 / 摘要", featureSummary(feature), "detail-summary")}
    ${renderDelta(feature, parent)}
    ${renderConfiguration(feature)}
    ${renderLocators(feature)}
    ${renderValidation(feature)}
    ${renderRelations(feature, tree)}
    ${renderLimitationsAndProvenance(feature)}
  `;
}
