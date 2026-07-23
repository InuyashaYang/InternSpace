import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModelGraph } from "../../src/model-data-adapter.js";
import { renderModelDetail } from "../../src/model-detail-view.js";

test("root detail keeps canonical Features auxiliary and outside the model graph", () => {
  const tree = normalizeModelGraph({
    mapping: { root_issue_number: 13 },
    issues: [{
      number: 13,
      architecture_name: "Olmo3",
      title_zh: "OLMo-3 标准架构",
      state: "open",
      url: "https://github.com/example/repo/issues/13",
      motivations: "Root <script>",
      parent_issue: null,
    }],
    pull_requests: [],
  }, { features: [{ id: "feat-aux", title: "Aux", summary: "Evidence" }] });
  const html = renderModelDetail(tree.byId.get(tree.rootId), tree);
  assert.match(html, /辅助 Feature 档案（1）/);
  assert.match(html, /feat-aux/);
  assert.doesNotMatch(html, /Root <script>/);
  assert.equal(tree.features.some((node) => node.id === "feat-aux"), false);
});

test("PR detail exposes sanitized W&B, commits, files and code symbols", () => {
  const tree = normalizeModelGraph({
    mapping: { root_issue_number: 13 },
    issues: [{ number: 13, architecture_name: "Olmo3", state: "open", parent_issue: null }],
    pull_requests: [{
      number: 14,
      title: "Root implementation",
      state: "open",
      url: "https://github.com/example/repo/pull/14",
      proposal_issue: { number: 13 },
      wandb_links: [{ label: "Training", url: "https://wandb.ai/org/project/runs/abc?accessToken=secret" }],
      commits: [{ sha: "a".repeat(40), message: "Initial code", url: `https://github.com/example/repo/commit/${"a".repeat(40)}` }],
      files: [{ path: "model.py", url: `https://github.com/example/repo/blob/${"a".repeat(40)}/model.py`, symbols: ["Model"], excerpt: "class Model: pass" }],
    }],
  });
  const html = renderModelDetail(tree.byId.get(tree.rootId), tree, "pr-14");
  assert.match(html, /wandb\.ai\/org\/project\/runs\/abc/);
  assert.doesNotMatch(html, /accessToken|secret/);
  assert.match(html, /Initial code/);
  assert.match(html, /model\.py/);
  assert.match(html, /Model/);
});
