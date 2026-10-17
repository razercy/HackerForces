import { describe, expect, it } from "vitest";
import { generateDataset, DATASET_VERSION } from "../../eval/generate";
import { SCENARIOS } from "../../eval/scenarios";

describe("synthetic evaluation dataset", () => {
  const a = generateDataset({ seed: 7, contestants: 40 });

  it("is deterministic for a seed and differs across seeds", () => {
    expect(generateDataset({ seed: 7, contestants: 40 })).toEqual(a);
    expect(generateDataset({ seed: 8, contestants: 40 })).not.toEqual(a);
  });

  it("tags every record as synthetic with a known scenario and matching label", () => {
    const labels = new Map(SCENARIOS.map((s) => [s.id, s.label]));
    for (const r of a) {
      expect(r.synthetic).toBe(true);
      expect(r.dataset).toBe(DATASET_VERSION);
      expect(labels.get(r.scenario)).toBe(r.label);
    }
  });

  it("uses the production scorer: unscored records are exactly the insufficient ones", () => {
    for (const r of a) {
      expect(r.baselinePriors.score === null).toBe(r.insufficient);
      if (r.degraded === "no_session") expect(r.insufficient).toBe(true);
    }
  });

  it("contains both classes and multiple records per contestant", () => {
    expect(a.some((r) => r.label === 1)).toBe(true);
    expect(a.some((r) => r.label === 0)).toBe(true);
    const per = new Map<string, number>();
    for (const r of a) per.set(r.contestant, (per.get(r.contestant) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeGreaterThan(1);
  });

  it("separates the clear-cut scenarios in the expected direction", () => {
    const mean = (id: string) => {
      const xs = a.filter((r) => r.scenario === id && r.baselinePriors.score !== null).map((r) => r.baselinePriors.score!);
      return xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null;
    };
    const typed = mean("L_typed");
    expect(typed).not.toBeNull();
    expect(typed!).toBeLessThan(10);
  });
});
