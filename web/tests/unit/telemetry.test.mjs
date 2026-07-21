import assert from "node:assert/strict";
import test from "node:test";
import { DemoTelemetryProvider, StaticArtifactTelemetryProvider } from "../../src/telemetry.js";

test("demo telemetry is seeded, deterministic and explicitly simulated", () => {
  const ids = ["feat-olmo3-standard", "feat-concept-self-dd"];
  const first = new DemoTelemetryProvider({ seed: 42 }).snapshot(ids, 3);
  const second = new DemoTelemetryProvider({ seed: 42 }).snapshot(ids, 3);
  assert.deepEqual(first, second);
  assert.equal(first.source, "demo");
  assert.equal(first.simulated, true);
  assert.equal(first.byFeature.get(ids[0]).simulated, true);
  assert.equal(first.byFeature.get(ids[0]).sparkline.length, 18);
});

test("demo telemetry changes by deterministic tick without mutating ids", () => {
  const ids = Object.freeze(["feat-a"]);
  const provider = new DemoTelemetryProvider({ seed: 7 });
  assert.notDeepEqual(provider.snapshot(ids, 0), provider.snapshot(ids, 1));
  assert.deepEqual(ids, ["feat-a"]);
});

test("reduced motion emits once and never schedules updates", () => {
  const provider = new DemoTelemetryProvider({ intervalMs: 1 });
  let updates = 0;
  const stop = provider.start(["feat-a"], () => { updates += 1; }, { reducedMotion: true });
  stop();
  assert.equal(updates, 1);
});

test("static artifact provider is a separate non-simulated contract", () => {
  const provider = new StaticArtifactTelemetryProvider(new Map([["feat-a", { loss: 1.2 }]]));
  const snapshot = provider.snapshot(["feat-a"]);
  assert.equal(snapshot.source, "artifact");
  assert.equal(snapshot.simulated, false);
});
