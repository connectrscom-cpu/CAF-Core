/**
 * Robust relative statistics for the performance learning loop.
 *
 * The previous heuristic compared raw per-flow means against 1.5x / 0.5x of the
 * project mean — noisy at small n (one viral post flips a flow to "high
 * performing"). This module applies empirical-Bayes shrinkage: each flow's
 * mean is pulled toward the project baseline proportionally to how little
 * data it has, so lifts only emerge when the sample actually supports them.
 *
 *   shrunk_mean = (n * flow_mean + k * baseline) / (n + k)
 *
 * where k (prior strength) is "how many baseline-quality samples of belief"
 * we require before trusting a flow's own numbers.
 */

export interface MetricSample {
  group: string;
  value: number;
}

export interface GroupPerformanceStats {
  group: string;
  n: number;
  raw_mean: number;
  shrunk_mean: number;
  /** (shrunk_mean / baseline) - 1; 0 when baseline is 0. */
  lift: number;
  /** |lift| >= liftThreshold and n >= minSamples. */
  significant: boolean;
}

export interface GroupStatsOptions {
  /** Prior strength k — pseudo-samples of the baseline mixed into each group. Default 5. */
  priorStrength?: number;
  /** Minimum real samples before a group can be significant. Default 5. */
  minSamples?: number;
  /** Minimum |lift| (fraction, e.g. 0.25 = ±25%) to flag. Default 0.25. */
  liftThreshold?: number;
}

export function shrunkMean(n: number, mean: number, baseline: number, priorStrength: number): number {
  if (n <= 0) return baseline;
  const k = Math.max(0, priorStrength);
  return (n * mean + k * baseline) / (n + k);
}

export function computeGroupPerformanceStats(
  samples: MetricSample[],
  opts?: GroupStatsOptions
): { baseline: number; total_samples: number; groups: GroupPerformanceStats[] } {
  const priorStrength = opts?.priorStrength ?? 5;
  const minSamples = opts?.minSamples ?? 5;
  const liftThreshold = opts?.liftThreshold ?? 0.25;

  const valid = samples.filter((s) => Number.isFinite(s.value) && s.group.trim() !== "");
  const total = valid.length;
  const baseline = total > 0 ? valid.reduce((a, s) => a + s.value, 0) / total : 0;

  const byGroup = new Map<string, number[]>();
  for (const s of valid) {
    const arr = byGroup.get(s.group) ?? [];
    arr.push(s.value);
    byGroup.set(s.group, arr);
  }

  const groups: GroupPerformanceStats[] = [];
  for (const [group, values] of byGroup.entries()) {
    const n = values.length;
    const rawMean = values.reduce((a, b) => a + b, 0) / n;
    const shrunk = shrunkMean(n, rawMean, baseline, priorStrength);
    const lift = baseline > 0 ? shrunk / baseline - 1 : 0;
    groups.push({
      group,
      n,
      raw_mean: Math.round(rawMean * 100000) / 100000,
      shrunk_mean: Math.round(shrunk * 100000) / 100000,
      lift: Math.round(lift * 10000) / 10000,
      significant: n >= minSamples && Math.abs(lift) >= liftThreshold,
    });
  }

  groups.sort((a, b) => b.lift - a.lift);
  return { baseline: Math.round(baseline * 100000) / 100000, total_samples: total, groups };
}

/**
 * Ranking-rule magnitude from a lift: capped, symmetric, proportional.
 * +40% lift → +0.2 boost; -40% lift → -0.2 penalty (caps at ±0.2).
 */
export function boostFromLift(lift: number): number {
  const capped = Math.max(-0.4, Math.min(0.4, lift));
  return Math.round(capped * 0.5 * 100) / 100;
}
