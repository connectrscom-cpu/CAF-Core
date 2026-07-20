import { describe, expect, it } from "vitest";
import { boostFromLift, computeGroupPerformanceStats, shrunkMean } from "./performance-stats.js";

describe("shrunkMean", () => {
  it("pulls small samples toward the baseline", () => {
    // n=1, mean=10, baseline=2, k=5 → (10 + 10) / 6 = 3.33
    expect(shrunkMean(1, 10, 2, 5)).toBeCloseTo(20 / 6, 5);
  });

  it("converges to the raw mean with large n", () => {
    expect(shrunkMean(1000, 10, 2, 5)).toBeCloseTo(9.96, 1);
  });

  it("returns baseline when n=0", () => {
    expect(shrunkMean(0, 99, 2, 5)).toBe(2);
  });
});

describe("computeGroupPerformanceStats", () => {
  it("does not flag a one-sample outlier as significant", () => {
    const samples = [
      { group: "FLOW_A", value: 100 },
      ...Array.from({ length: 10 }, () => ({ group: "FLOW_B", value: 2 })),
    ];
    const { groups } = computeGroupPerformanceStats(samples);
    const a = groups.find((g) => g.group === "FLOW_A")!;
    expect(a.significant).toBe(false); // n=1 < minSamples even though raw mean is huge
  });

  it("flags a consistently better flow with enough samples", () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ group: "FLOW_A", value: 10 })),
      ...Array.from({ length: 8 }, () => ({ group: "FLOW_B", value: 2 })),
    ];
    const { baseline, groups } = computeGroupPerformanceStats(samples);
    expect(baseline).toBeCloseTo(6, 5);
    const a = groups.find((g) => g.group === "FLOW_A")!;
    const b = groups.find((g) => g.group === "FLOW_B")!;
    expect(a.significant).toBe(true);
    expect(a.lift).toBeGreaterThan(0.25);
    expect(b.significant).toBe(true);
    expect(b.lift).toBeLessThan(-0.25);
  });

  it("shrunk mean sits between raw mean and baseline", () => {
    const samples = [
      ...Array.from({ length: 6 }, () => ({ group: "FLOW_A", value: 12 })),
      ...Array.from({ length: 6 }, () => ({ group: "FLOW_B", value: 4 })),
    ];
    const { baseline, groups } = computeGroupPerformanceStats(samples);
    const a = groups.find((g) => g.group === "FLOW_A")!;
    expect(a.shrunk_mean).toBeLessThan(a.raw_mean);
    expect(a.shrunk_mean).toBeGreaterThan(baseline);
  });

  it("ignores NaN values and blank groups", () => {
    const { total_samples, groups } = computeGroupPerformanceStats([
      { group: "FLOW_A", value: NaN },
      { group: "", value: 5 },
      { group: "FLOW_A", value: 3 },
    ]);
    expect(total_samples).toBe(1);
    expect(groups).toHaveLength(1);
  });

  it("sorts groups by lift descending", () => {
    const samples = [
      ...Array.from({ length: 5 }, () => ({ group: "LOW", value: 1 })),
      ...Array.from({ length: 5 }, () => ({ group: "HIGH", value: 9 })),
    ];
    const { groups } = computeGroupPerformanceStats(samples);
    expect(groups[0].group).toBe("HIGH");
    expect(groups[1].group).toBe("LOW");
  });
});

describe("boostFromLift", () => {
  it("scales lift into a capped boost", () => {
    expect(boostFromLift(0.4)).toBeCloseTo(0.2, 5);
    expect(boostFromLift(-0.4)).toBeCloseTo(-0.2, 5);
    expect(boostFromLift(0.2)).toBeCloseTo(0.1, 5);
  });

  it("caps extreme lifts at ±0.2", () => {
    expect(boostFromLift(3)).toBeCloseTo(0.2, 5);
    expect(boostFromLift(-3)).toBeCloseTo(-0.2, 5);
  });
});
