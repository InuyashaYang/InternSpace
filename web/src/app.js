import { FeatureTreeDataError, loadFeatureTree } from "./data-adapter.js";
import { compactFeatureTitle, featureTitle, matchesFeatureSearch } from "./feature-display.js";
import { featureValidation, primaryCodeHint } from "./feature-view-model.js";
import { ancestorIds, boundsForIds, layoutTree, visibleFeatureIds } from "./tree-layout.js";
import { renderDetail } from "./detail-view.js";
import { exceedsPanThreshold, translatedViewport } from "./viewport-state.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const elements = {
  svg: document.querySelector("#tree-canvas"),
  viewport: document.querySelector("#viewport-layer"),
  nodes: document.querySelector("#node-layer"),
  edges: document.querySelector("#edge-layer"),
  dependencies: document.querySelector("#dependency-layer"),
  scroller: document.querySelector("#canvas-scroller"),
  detail: document.querySelector("#detail-panel"),
  search: document.querySelector("#feature-search"),
  searchResults: document.querySelector("#search-results"),
  zoomOutput: document.querySelector("#zoom-output"),
  empty: document.querySelector("#empty-state"),
  emptyMessage: document.querySelector("#empty-message"),
};

const state = {
  tree: null,
  layout: null,
  expanded: new Set(),
  selectedId: null,
  scale: 1,
  translateX: 0,
  translateY: 0,
  pan: null,
  suppressClickUntil: 0,
};

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function curveBetween(source, target) {
  const startX = source.x + state.layout.config.nodeWidth;
  const startY = source.y + state.layout.config.nodeHeight / 2;
  const endX = target.x;
  const endY = target.y + state.layout.config.nodeHeight / 2;
  const midX = startX + (endX - startX) * 0.5;
  return `M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`;
}

function dependencyCurve(source, target) {
  const sourceX = source.x + state.layout.config.nodeWidth / 2;
  const sourceY = source.y + state.layout.config.nodeHeight / 2;
  const targetX = target.x + state.layout.config.nodeWidth / 2;
  const targetY = target.y + state.layout.config.nodeHeight / 2;
  const bend = Math.max(45, Math.abs(targetY - sourceY) * 0.35);
  return `M${sourceX},${sourceY} C${sourceX},${sourceY - bend} ${targetX},${targetY - bend} ${targetX},${targetY}`;
}

function renderTree() {
  if (!state.tree) return;
  const visible = visibleFeatureIds(state.tree, state.expanded);
  elements.nodes.replaceChildren();
  elements.edges.replaceChildren();
  elements.dependencies.replaceChildren();

  for (const id of visible) {
    const feature = state.tree.byId.get(id);
    if (!feature.parent_id || !visible.has(feature.parent_id)) continue;
    elements.edges.append(svgElement("path", {
      d: curveBetween(state.layout.positions.get(feature.parent_id), state.layout.positions.get(id)),
      class: "structure-edge",
      "data-edge": `${feature.parent_id}:${id}`,
    }));
  }

  if (state.selectedId && visible.has(state.selectedId)) {
    const selected = state.tree.byId.get(state.selectedId);
    const source = state.layout.positions.get(state.selectedId);
    const references = [
      ...selected.depends_on.map((id) => ({ id, type: "depends" })),
      ...selected.related_to.map((id) => ({ id, type: "related" })),
    ];
    for (const reference of references) {
      if (!visible.has(reference.id) || reference.id === state.selectedId) continue;
      elements.dependencies.append(svgElement("path", {
        d: dependencyCurve(source, state.layout.positions.get(reference.id)),
        class: `auxiliary-edge auxiliary-${reference.type}`,
        "data-auxiliary-edge": `${state.selectedId}:${reference.id}`,
        "marker-end": "url(#dependency-arrow)",
      }));
    }
  }

  for (const id of visible) {
    const feature = state.tree.byId.get(id);
    const displayTitle = featureTitle(feature);
    const validation = featureValidation(feature);
    const codeHint = primaryCodeHint(feature);
    const point = state.layout.positions.get(id);
    const children = state.tree.childrenById.get(id) ?? [];
    const group = svgElement("g", {
      class: `feature-node validation-${validation.key}${state.selectedId === id ? " is-selected" : ""}`,
      transform: `translate(${point.x} ${point.y})`,
      tabindex: "0",
      role: "treeitem",
      "aria-label": `${displayTitle}，${validation.label}${codeHint ? `，代码 ${codeHint}` : ""}`,
      "aria-selected": state.selectedId === id ? "true" : "false",
      "aria-expanded": children.length ? String(state.expanded.has(id)) : "false",
      "data-feature-id": id,
      "data-validation": validation.key,
    });
    group.append(svgElement("rect", { width: state.layout.config.nodeWidth, height: state.layout.config.nodeHeight, rx: 12 }));
    const title = svgElement("text", { x: 16, y: 20, class: "node-title" });
    title.textContent = compactFeatureTitle(feature);
    group.append(title);
    const badgeWidth = Math.min(132, Math.max(48, 20 + validation.label.length * 9));
    const badge = svgElement("g", { class: "validation-badge", transform: "translate(16 27)" });
    badge.append(svgElement("rect", { width: badgeWidth, height: 16, rx: 8 }));
    badge.append(svgElement("circle", { cx: 8, cy: 8, r: 2.5 }));
    const badgeLabel = svgElement("text", { x: 14, y: 11 });
    badgeLabel.textContent = validation.label;
    badge.append(badgeLabel);
    group.append(badge);
    if (codeHint) {
      const code = svgElement("text", { x: 16, y: 59, class: "node-code-hint" });
      code.textContent = codeHint;
      group.append(code);
    }
    if (children.length) {
      const toggle = svgElement("g", { class: "node-toggle", transform: `translate(${state.layout.config.nodeWidth - 11} 18)`, "data-toggle-id": id });
      toggle.append(svgElement("circle", { r: 10 }));
      const symbol = svgElement("text", { y: 4 });
      symbol.textContent = state.expanded.has(id) ? "−" : "+";
      toggle.append(symbol);
      group.append(toggle);
    }
    elements.nodes.append(group);
  }
  applyTransform();
}

function selectFeature(id, { reveal = false } = {}) {
  if (!state.tree?.byId.has(id)) return;
  if (reveal) for (const ancestor of ancestorIds(state.tree, id)) state.expanded.add(ancestor);
  state.selectedId = id;
  elements.detail.innerHTML = renderDetail(state.tree.byId.get(id), state.tree);
  renderTree();
  if (reveal) requestAnimationFrame(fitTree);
}

function toggleFeature(id) {
  if (!(state.tree.childrenById.get(id)?.length)) return;
  const expanding = !state.expanded.has(id);
  expanding ? state.expanded.add(id) : state.expanded.delete(id);
  renderTree();
  if (expanding) requestAnimationFrame(fitTree);
}

function applyTransform() {
  elements.viewport.setAttribute("transform", `translate(${state.translateX} ${state.translateY}) scale(${state.scale})`);
  elements.viewport.dataset.translateX = String(state.translateX);
  elements.viewport.dataset.translateY = String(state.translateY);
  elements.viewport.dataset.scale = String(state.scale);
  elements.zoomOutput.value = `${Math.round(state.scale * 100)}%`;
}

function clientPointToSvg(clientX, clientY) {
  const matrix = elements.svg.getScreenCTM();
  if (!matrix) return { x: clientX, y: clientY };
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function setZoom(scale, anchor = null) {
  const next = Math.min(2.4, Math.max(0.35, scale));
  if (anchor) {
    const localX = (anchor.x - state.translateX) / state.scale;
    const localY = (anchor.y - state.translateY) / state.scale;
    state.translateX = anchor.x - localX * next;
    state.translateY = anchor.y - localY * next;
  }
  state.scale = next;
  applyTransform();
}

function actualSize() {
  state.scale = 1;
  state.translateX = 0;
  state.translateY = 0;
  applyTransform();
}

function fitTree() {
  if (!state.tree) return;
  const visible = visibleFeatureIds(state.tree, state.expanded);
  const bounds = boundsForIds(state.layout, visible);
  const width = elements.scroller.clientWidth;
  const height = elements.scroller.clientHeight;
  const nextScale = Math.min(1.15, Math.max(0.35, Math.min(width / bounds.width, height / bounds.height)));
  state.scale = nextScale;
  state.translateX = (width - bounds.width * nextScale) / 2 - bounds.minX * nextScale;
  state.translateY = (height - bounds.height * nextScale) / 2 - bounds.minY * nextScale;
  applyTransform();
}

function searchFeatures(query) {
  const term = query.trim().toLocaleLowerCase("zh-CN");
  if (!term || !state.tree) return [];
  return state.tree.features
    .filter((feature) => matchesFeatureSearch(feature, term))
    .slice(0, 8);
}

function renderSearchResults() {
  const results = searchFeatures(elements.search.value);
  if (!elements.search.value.trim()) {
    elements.searchResults.hidden = true;
    return;
  }
  elements.searchResults.replaceChildren();
  if (results.length) {
    for (const feature of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.searchId = feature.id;
      const title = document.createElement("strong");
      title.textContent = featureTitle(feature);
      const metadata = document.createElement("small");
      metadata.textContent = `${feature.id} · ${featureValidation(feature).label}${primaryCodeHint(feature) ? ` · ${primaryCodeHint(feature)}` : ""}`;
      button.append(title, metadata);
      elements.searchResults.append(button);
    }
  } else {
    const empty = document.createElement("p");
    empty.textContent = "没有匹配的 Feature";
    elements.searchResults.append(empty);
  }
  elements.searchResults.hidden = false;
}

function showError(error) {
  elements.empty.hidden = false;
  elements.emptyMessage.textContent = error instanceof FeatureTreeDataError
    ? [error.message, ...error.details].join("；")
    : error.message;
  elements.svg.classList.add("is-unavailable");
}

async function initialize() {
  elements.empty.hidden = true;
  elements.svg.classList.remove("is-unavailable");
  try {
    state.tree = await loadFeatureTree();
    state.layout = layoutTree(state.tree);
    state.expanded = new Set([state.tree.rootId]);
    state.selectedId = state.tree.rootId;
    elements.svg.setAttribute("viewBox", `0 0 ${Math.max(state.layout.width, 1200)} ${Math.max(state.layout.height, 720)}`);
    elements.detail.innerHTML = renderDetail(state.tree.byId.get(state.tree.rootId), state.tree);
    renderTree();
    fitTree();
    document.documentElement.dataset.ready = "true";
    document.documentElement.dataset.featureCount = String(state.tree.features.length);
    document.documentElement.dataset.structuralEdgeCount = String(state.tree.features.length - 1);
    document.documentElement.dataset.auxiliaryEdgeCount = String(state.tree.features.reduce(
      (count, feature) => count + feature.depends_on.length + feature.related_to.length,
      0,
    ));
  } catch (error) {
    showError(error);
    document.documentElement.dataset.ready = "error";
  }
}

elements.nodes.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle-id]");
  if (toggle) {
    event.stopPropagation();
    toggleFeature(toggle.dataset.toggleId);
    return;
  }
  const node = event.target.closest("[data-feature-id]");
  if (node) selectFeature(node.dataset.featureId);
});
elements.nodes.addEventListener("dblclick", (event) => {
  const node = event.target.closest("[data-feature-id]");
  if (node) toggleFeature(node.dataset.featureId);
});
elements.nodes.addEventListener("keydown", (event) => {
  const node = event.target.closest("[data-feature-id]");
  if (!node) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectFeature(node.dataset.featureId);
  } else if (event.key === "ArrowRight") {
    state.expanded.add(node.dataset.featureId);
    renderTree();
  } else if (event.key === "ArrowLeft") {
    state.expanded.delete(node.dataset.featureId);
    renderTree();
  }
});
elements.svg.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || (event.pointerType !== "touch" && event.button !== 0)) return;
  if (event.target.closest("[data-feature-id], [data-toggle-id]")) return;
  event.preventDefault();
  state.pan = {
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    startSvg: clientPointToSvg(event.clientX, event.clientY),
    origin: { translateX: state.translateX, translateY: state.translateY },
    moved: false,
  };
  elements.svg.setPointerCapture(event.pointerId);
  elements.svg.classList.add("is-panning");
});
elements.svg.addEventListener("pointermove", (event) => {
  if (!state.pan || event.pointerId !== state.pan.pointerId) return;
  event.preventDefault();
  const currentClient = { x: event.clientX, y: event.clientY };
  if (!state.pan.moved && !exceedsPanThreshold(state.pan.startClient, currentClient)) return;
  state.pan.moved = true;
  const currentSvg = clientPointToSvg(event.clientX, event.clientY);
  const next = translatedViewport(state.pan.origin, {
    x: currentSvg.x - state.pan.startSvg.x,
    y: currentSvg.y - state.pan.startSvg.y,
  });
  state.translateX = next.translateX;
  state.translateY = next.translateY;
  applyTransform();
});

function finishPan(event) {
  if (!state.pan || event.pointerId !== state.pan.pointerId) return;
  if (state.pan.moved) state.suppressClickUntil = performance.now() + 400;
  if (elements.svg.hasPointerCapture(event.pointerId)) elements.svg.releasePointerCapture(event.pointerId);
  state.pan = null;
  elements.svg.classList.remove("is-panning");
}

elements.svg.addEventListener("pointerup", finishPan);
elements.svg.addEventListener("pointercancel", finishPan);
elements.svg.addEventListener("lostpointercapture", (event) => {
  if (state.pan?.pointerId !== event.pointerId) return;
  if (state.pan.moved) state.suppressClickUntil = performance.now() + 400;
  state.pan = null;
  elements.svg.classList.remove("is-panning");
});
elements.svg.addEventListener("click", (event) => {
  if (performance.now() >= state.suppressClickUntil) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
elements.search.addEventListener("input", renderSearchResults);
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const result = searchFeatures(elements.search.value)[0];
    if (result) {
      selectFeature(result.id, { reveal: true });
      elements.searchResults.hidden = true;
    }
  } else if (event.key === "Escape") {
    elements.search.value = "";
    elements.searchResults.hidden = true;
  }
});
elements.searchResults.addEventListener("click", (event) => {
  const result = event.target.closest("[data-search-id]");
  if (!result) return;
  selectFeature(result.dataset.searchId, { reveal: true });
  elements.searchResults.hidden = true;
});
elements.svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.scale * (event.deltaY > 0 ? 0.9 : 1.1), clientPointToSvg(event.clientX, event.clientY));
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== elements.search) {
    event.preventDefault();
    elements.search.focus();
  }
});
document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "zoom-in") setZoom(state.scale * 1.15);
  if (action === "zoom-out") setZoom(state.scale / 1.15);
  if (action === "actual-size") actualSize();
  if (action === "fit") fitTree();
  if (action === "retry") initialize();
});
new ResizeObserver(() => state.tree && fitTree()).observe(elements.scroller);
initialize();
