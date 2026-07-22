import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ExperimentIndexDataError,
  FeatureTreeDataError,
  ROOT_ID,
  normalizeExperimentIndex,
  normalizeFeatureTree,
} from "../../src/data-adapter.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/feature-tree.fixture.json", import.meta.url)));

test("normalizes one connected Feature tree", () => {
  const tree = normalizeFeatureTree(fixture);
  assert.equal(tree.rootId, ROOT_ID);
  assert.equal(tree.features.length, 8);
  assert.deepEqual(tree.childrenById.get(ROOT_ID).map((item) => item.id), [
    "feat-context-prediction",
    "feat-optimizer-stability",
    "feat-token-routing",
  ]);
  assert.deepEqual(tree.byId.get("feat-context-window").depends_on, ["feat-token-routing"]);
  assert.equal(tree.byId.get("feat-context-prediction").title_zh, "上下文预测");
  assert.equal(tree.byId.get("feat-context-prediction").summary_zh, "加入显式上下文信号预测目标。");
});

test("rejects a second root", () => {
  const payload = structuredClone(fixture);
  payload.features.push({ id: "feat-other-root", title: "Other", parent_id: null });
  assert.throws(() => normalizeFeatureTree(payload), FeatureTreeDataError);
});

test("rejects cycles and unreachable nodes", () => {
  const payload = structuredClone(fixture);
  payload.features.find((item) => item.id === "feat-context-prediction").parent_id = "feat-context-window";
  assert.throws(() => normalizeFeatureTree(payload), /Feature Tree 数据无效/);
});

test("normalizes an experiment index with multi-Feature coverage", () => {
  const tree = normalizeFeatureTree(fixture);
  const index = normalizeExperimentIndex({
    experiments: [{
      id: "exp-routing",
      title: "Routing run",
      status: "completed",
      cursor_type: "wandb-final",
      covered_feature_ids: ["feat-token-routing", "feat-context-window"],
      final_metrics: { loss: 1.23 },
    }],
  }, tree);
  assert.equal(index.experiments.length, 1);
  assert.deepEqual(index.byFeatureId.get("feat-token-routing").map((item) => item.id), ["exp-routing"]);
  assert.deepEqual(index.byFeatureId.get("feat-context-window").map((item) => item.id), ["exp-routing"]);
});

test("rejects experiment coverage for unknown Features", () => {
  const tree = normalizeFeatureTree(fixture);
  assert.throws(() => normalizeExperimentIndex({
    experiments: [{
      id: "exp-missing",
      title: "Missing",
      status: "completed",
      cursor_type: "wandb-final",
      covered_feature_ids: ["feat-missing"],
    }],
  }, tree), ExperimentIndexDataError);
});
