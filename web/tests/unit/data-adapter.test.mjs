import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FeatureTreeDataError, ROOT_ID, normalizeFeatureTree } from "../../src/data-adapter.js";

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
