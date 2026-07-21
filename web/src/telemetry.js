function hashString(value, seed) {
  let hash = seed >>> 0;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitValue(hash) {
  let value = hash >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0xffffffff;
}

export class TelemetryProvider {
  snapshot() {
    throw new Error("TelemetryProvider.snapshot must be implemented");
  }
}

export class DemoTelemetryProvider extends TelemetryProvider {
  constructor({ seed = 0x1a2b3c4d, intervalMs = 1600 } = {}) {
    super();
    this.seed = seed >>> 0;
    this.intervalMs = intervalMs;
  }

  snapshot(featureIds, tick = 0) {
    const byFeature = new Map();
    for (const id of featureIds) {
      const hash = hashString(id, this.seed);
      const base = unitValue(hash);
      const phase = base * Math.PI * 2;
      const activity = 0.35 + unitValue(hash ^ 0x9e3779b9) * 0.6;
      const progress = Math.min(0.96, 0.18 + unitValue(hash ^ 0x85ebca6b) * 0.66 + tick * 0.0015);
      const loss = 1.35 + base * 0.62 + Math.sin(phase + tick * 0.22) * 0.035;
      const throughput = 42 + unitValue(hash ^ 0xc2b2ae35) * 86 + Math.cos(phase + tick * 0.17) * 2.2;
      const sparkline = Array.from({ length: 18 }, (_, index) => {
        const trend = loss + (17 - index) * 0.012;
        return Number((trend + Math.sin(phase + index * 0.72 + tick * 0.18) * 0.025).toFixed(3));
      });
      byFeature.set(id, Object.freeze({
        source: "demo",
        simulated: true,
        loss: Number(loss.toFixed(3)),
        throughput: Number(throughput.toFixed(1)),
        progress: Number(progress.toFixed(3)),
        activity: Number(activity.toFixed(3)),
        sparkline: Object.freeze(sparkline),
      }));
    }
    const values = [...byFeature.values()];
    const aggregate = Object.freeze({
      source: "demo",
      simulated: true,
      loss: values.length ? Number((values.reduce((sum, item) => sum + item.loss, 0) / values.length).toFixed(3)) : 0,
      throughput: Number(values.reduce((sum, item) => sum + item.throughput, 0).toFixed(1)),
      active: values.filter((item) => item.activity > 0.58).length,
    });
    return Object.freeze({ source: "demo", simulated: true, tick, byFeature, aggregate });
  }

  start(featureIds, onSnapshot, { reducedMotion = false } = {}) {
    let tick = 0;
    onSnapshot(this.snapshot(featureIds, tick));
    if (reducedMotion) return () => {};
    const timer = setInterval(() => onSnapshot(this.snapshot(featureIds, ++tick)), this.intervalMs);
    return () => clearInterval(timer);
  }
}

export class StaticArtifactTelemetryProvider extends TelemetryProvider {
  constructor(snapshotByFeature = new Map()) {
    super();
    this.snapshotByFeature = snapshotByFeature;
  }

  snapshot(featureIds) {
    return Object.freeze({
      source: "artifact",
      simulated: false,
      tick: 0,
      byFeature: new Map(featureIds.map((id) => [id, this.snapshotByFeature.get(id)]).filter(([, value]) => value)),
      aggregate: null,
    });
  }
}
