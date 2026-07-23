import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeExperimentIndex, normalizeFeatureTree } from "../../src/data-adapter.js";
import {
  applyTemplateExperiments,
  applyTemplateOverlay,
  normalizeTemplateOverlay,
} from "../../src/template-overlay-adapter.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/feature-tree.fixture.json", import.meta.url)));

function overlayPayload() {
  return {
    schema_version: "1.0.0",
    overlay_id: "template-test-overlay",
    source_repository: "JT-Ushio/template-test",
    fetched_at: "2026-07-23T00:00:00+00:00",
    merge_policy: {
      external_display_precedence: true,
      preserve_local_identity: true,
      preserve_local_structure: true,
      preserve_relation_union: true,
    },
    nodes: [{
      id: "template-test-olmo2-0425-1b",
      external_architecture_id: "olmo2-0425-1b",
      maps_to_feature_id: "feat-olmo3-standard",
      merge_strategy: "external-display-local-structure",
      title: "OLMo-2 1B Base Architecture",
      title_zh: "OLMo-2 1B 基础架构",
      summary: "External summary wins in the view.",
      summary_zh: "外部摘要在视图层优先。",
      temporary_equivalence: {
        external: "olmo2-0425-1b",
        local: "feat-olmo3-standard",
        assumption: "Temporary visualization alias only.",
      },
      relations: [{
        type: "proposal_issue",
        label: "Issue #3",
        url: "https://github.com/JT-Ushio/template-test/issues/3",
      }],
      commits: [{
        sha: "c1390d4637c448e2574057f819e6f42884d2ccec",
        message: "add olmo2 modeling files",
        author: "scv11",
        authored_at: "2026-07-22T12:22:35Z",
        url: "https://github.com/scv11/template-test-olmo2/commit/c1390d4637c448e2574057f819e6f42884d2ccec",
      }],
      related_feature_ids: ["feat-token-routing"],
      implementation_files: [{
        path: "models/olmo2/modeling_olmo2.py",
        url: "https://github.com/scv11/template-test-olmo2/blob/c1390d4637c448e2574057f819e6f42884d2ccec/models/olmo2/modeling_olmo2.py",
        additions: 508,
        deletions: 0,
        content_sha256: "a".repeat(64),
        line_count: 508,
        symbols: ["Olmo2Model", "Olmo2ForCausalLM"],
        excerpt: "class Olmo2Model:\n    pass",
      }],
      warnings: ["Temporary alias"],
    }],
    experiments: [{
      id: "exp-template-test-olmo2",
      title: "External training record",
      title_zh: "外部训练记录",
      type: "training_reference",
      status: "completed",
      cursor_type: "wandb-final",
      covered_feature_ids: ["feat-olmo3-standard"],
      primary_feature_ids: ["feat-olmo3-standard"],
      summary: "External result",
      summary_zh: "外部结果",
      wandb_url: "https://wandb.ai/example/project/runs/abc123",
      final_metrics: { final_training_loss: 3.18 },
      replay: { enabled: false, source: null, loss_trace: [] },
      evidence: [{ label: "PR #5", locator: "https://github.com/JT-Ushio/template-test/pull/5", summary: "External PR" }],
      replaces_experiment_id: "exp-local",
    }],
  };
}

test("external display replaces the mapped point while local structure and identity survive", () => {
  const canonical = normalizeFeatureTree(fixture);
  const rootChildren = canonical.childrenById.get(canonical.rootId).map((feature) => feature.id);
  const overlay = normalizeTemplateOverlay(overlayPayload(), canonical);
  const merged = applyTemplateOverlay(canonical, overlay);
  const root = merged.byId.get(merged.rootId);
  assert.equal(root.title, "OLMo-2 1B Base Architecture");
  assert.equal(root.title_zh, "OLMo-2 1B 基础架构");
  assert.equal(root.template_overlay.local.title, "OLMo-3 标准态");
  assert.equal(root.template_overlay.external.external_architecture_id, "olmo2-0425-1b");
  assert.equal(root.template_overlay.external.commits[0].message, "add olmo2 modeling files");
  assert.deepEqual(root.template_overlay.external.implementation_files[0].symbols, ["Olmo2Model", "Olmo2ForCausalLM"]);
  assert.deepEqual(merged.childrenById.get(merged.rootId).map((feature) => feature.id), rootChildren);
  assert(root.related_to.includes("feat-token-routing"));
  assert.equal(merged.rootId, "feat-olmo3-standard");
});

test("same experiment is replaced visually and keeps local coverage and evidence", () => {
  const canonical = normalizeFeatureTree(fixture);
  const overlay = normalizeTemplateOverlay(overlayPayload(), canonical);
  const tree = applyTemplateOverlay(canonical, overlay);
  const local = normalizeExperimentIndex({
    experiments: [{
      id: "exp-local",
      title: "Local W&B reference",
      title_zh: "本地 W&B 参考",
      type: "training_reference",
      status: "archived",
      cursor_type: "none",
      covered_feature_ids: ["feat-olmo3-standard", "feat-context-prediction"],
      primary_feature_ids: ["feat-olmo3-standard"],
      summary: "Local record",
      summary_zh: "本地记录",
      wandb_url: "https://wandb.ai/example/project/runs/abc123",
      final_metrics: {},
      replay: { enabled: false, source: null, loss_trace: [] },
      evidence: [{ label: "Local", locator: "https://example.com/local", summary: "Local evidence" }],
    }],
  }, canonical);
  const merged = applyTemplateExperiments(local, overlay, tree);
  assert.equal(merged.experiments.length, 1);
  const experiment = merged.byId.get("exp-local");
  assert.equal(experiment.title_zh, "外部训练记录");
  assert.equal(experiment.status, "completed");
  assert.equal(experiment.cursor_type, "wandb-final");
  assert.equal(experiment.final_metrics.final_training_loss, 3.18);
  assert.deepEqual(experiment.covered_feature_ids, ["feat-olmo3-standard", "feat-context-prediction"]);
  assert.equal(experiment.evidence.length, 2);
  assert.equal(experiment.template_overlay.local.title, "Local W&B reference");
});
