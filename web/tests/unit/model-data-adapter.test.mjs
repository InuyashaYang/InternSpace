import assert from "node:assert/strict";
import test from "node:test";
import { ModelDataError, normalizeModelGraph } from "../../src/model-data-adapter.js";

function payload(issues, pullRequests = []) {
  return {
    mapping: { root_issue_number: 13 },
    issues,
    pull_requests: pullRequests,
  };
}

function issue(number, parent = null, overrides = {}) {
  return {
    number,
    architecture_name: `Model ${number}`,
    title_zh: `模型 ${number}`,
    state: "open",
    parent_issue: parent ? { number: parent, label: `#${parent}` } : null,
    motivations: `Motivation ${number}`,
    ...overrides,
  };
}

test("uses configured Issue root and Parent issue links as the only canvas nodes", () => {
  const tree = normalizeModelGraph(payload([
    issue(13),
    issue(15, 13),
    issue(16, 13),
    issue(17, 15),
    issue(21, 16),
  ]), { features: [{ id: "feat-a", title: "Aux A" }, { id: "feat-b", title: "Aux B" }] });
  assert.equal(tree.rootId, "issue-13");
  assert.deepEqual(tree.childrenById.get("issue-13").map((node) => node.id), ["issue-15", "issue-16"]);
  assert.deepEqual(tree.childrenById.get("issue-15").map((node) => node.id), ["issue-17"]);
  assert.deepEqual(tree.childrenById.get("issue-16").map((node) => node.id), ["issue-21"]);
  assert.deepEqual(tree.features.map((node) => node.id), ["issue-13", "issue-15", "issue-16", "issue-17", "issue-21"]);
  assert.equal(tree.auxiliaryFeatures.length, 2);
  assert.equal(tree.features.some((node) => node.id === "feat-a"), false);
});

test("associates PRs with their Proposal Issue instead of creating PR nodes", () => {
  const tree = normalizeModelGraph(payload([
    issue(13),
    issue(15, 13),
  ], [{ number: 19, title: "Implementation", proposal_issue: { number: 15 }, commits: [], files: [] }]));
  assert.equal(tree.features.length, 2);
  assert.deepEqual(tree.byId.get("issue-15").pullRequests.map((pullRequest) => pullRequest.number), [19]);
});

test("repairs missing parents and cycles back to the configured root without placeholders", () => {
  const missing = normalizeModelGraph(payload([issue(13), issue(15, 999)]));
  assert.equal(missing.byId.get("issue-15").parent_id, "issue-13");
  assert.equal(missing.features.length, 2);
  assert.equal(missing.warnings.length, 1);

  const cyclic = normalizeModelGraph(payload([issue(13), issue(15, 16), issue(16, 15)]));
  assert.equal(cyclic.features.length, 3);
  assert.ok(cyclic.warnings.length >= 1);
  assert.ok([cyclic.byId.get("issue-15").parent_id, cyclic.byId.get("issue-16").parent_id].includes("issue-13"));
});

test("rejects a database without its configured root", () => {
  assert.throws(() => normalizeModelGraph(payload([issue(15)])), ModelDataError);
});
