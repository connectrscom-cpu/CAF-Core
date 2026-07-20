import { describe, expect, it } from "vitest";
import {
  computeLlmReviewCalibration,
  percentile,
  rankAgreement,
  type CalibrationReviewRow,
} from "./llm-review-calibration.js";

function rev(
  id: string,
  score: number,
  decision: string | null
): CalibrationReviewRow {
  return { review_id: id, task_id: `t_${id}`, overall_score: score, decision };
}

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns the single value regardless of p", () => {
    expect(percentile([0.7], 0.1)).toBe(0.7);
    expect(percentile([0.7], 0.9)).toBe(0.7);
  });

  it("interpolates between order statistics", () => {
    expect(percentile([0, 1], 0.5)).toBe(0.5);
    expect(percentile([0.6, 0.7, 0.8, 0.9], 0.5)).toBeCloseTo(0.75, 10);
    expect(percentile([0.6, 0.7, 0.8, 0.9], 0.75)).toBeCloseTo(0.825, 10);
  });
});

describe("rankAgreement", () => {
  it("is null when either side is empty", () => {
    expect(rankAgreement([], [0.5])).toBeNull();
    expect(rankAgreement([0.5], [])).toBeNull();
  });

  it("is 1 for perfect separation and 0.5 for identical scores", () => {
    expect(rankAgreement([0.8, 0.9], [0.5, 0.6])).toBe(1);
    expect(rankAgreement([0.7, 0.7], [0.7, 0.7])).toBe(0.5);
  });

  it("is 0 when the reviewer inverts human judgment", () => {
    expect(rankAgreement([0.4], [0.9])).toBe(0);
  });
});

describe("computeLlmReviewCalibration", () => {
  it("separates approved vs not-approved averages and computes agreement", () => {
    const rows = [
      rev("a1", 0.8, "APPROVED"),
      rev("a2", 0.9, "APPROVED"),
      rev("b1", 0.5, "REJECTED"),
      rev("b2", 0.6, "NEEDS_EDIT"),
      rev("u1", 0.7, null), // undecided — counted in reviews_scored only
    ];
    const cal = computeLlmReviewCalibration(rows, { min_decided_per_side: 2 });
    expect(cal.reviews_scored).toBe(5);
    expect(cal.reviews_with_human_decision).toBe(4);
    expect(cal.approved).toBe(2);
    expect(cal.not_approved).toBe(2);
    expect(cal.avg_score_approved).toBeCloseTo(0.85, 8);
    expect(cal.avg_score_not_approved).toBeCloseTo(0.55, 8);
    expect(cal.score_separation).toBeCloseTo(0.3, 8);
    expect(cal.rank_agreement).toBe(1);
  });

  it("suggests thresholds only when both sides have enough samples", () => {
    const insufficient = computeLlmReviewCalibration(
      [rev("a1", 0.8, "APPROVED"), rev("b1", 0.5, "REJECTED")],
      { min_decided_per_side: 5 }
    );
    expect(insufficient.suggested_thresholds.sample_sufficient).toBe(false);
    expect(insufficient.suggested_thresholds.improve_below).toBeNull();
    expect(insufficient.suggested_thresholds.positive_at_or_above).toBeNull();

    const approved = [0.7, 0.75, 0.8, 0.85, 0.9].map((s, i) => rev(`a${i}`, s, "APPROVED"));
    const rejected = [0.4, 0.5, 0.55, 0.6, 0.65].map((s, i) => rev(`b${i}`, s, "REJECTED"));
    const sufficient = computeLlmReviewCalibration([...approved, ...rejected], {
      min_decided_per_side: 5,
    });
    expect(sufficient.suggested_thresholds.sample_sufficient).toBe(true);
    // Median of rejected scores.
    expect(sufficient.suggested_thresholds.improve_below).toBeCloseTo(0.55, 8);
    // p75 of approved scores.
    expect(sufficient.suggested_thresholds.positive_at_or_above).toBeCloseTo(0.85, 8);
  });

  it("buckets scores and reports per-bucket human approval rates", () => {
    const rows = [
      rev("a1", 0.82, "APPROVED"),
      rev("a2", 0.84, "APPROVED"),
      rev("b1", 0.52, "REJECTED"),
      rev("u1", 0.53, null),
    ];
    const cal = computeLlmReviewCalibration(rows, { bucket_width: 0.05 });
    const high = cal.buckets.find((b) => b.from === 0.8);
    const low = cal.buckets.find((b) => b.from === 0.5);
    expect(high?.reviews).toBe(2);
    expect(high?.human_approval_rate).toBe(1);
    expect(low?.reviews).toBe(2);
    expect(low?.human_approved).toBe(0);
    expect(low?.human_approval_rate).toBe(0);
    // Empty buckets are dropped.
    expect(cal.buckets.every((b) => b.reviews > 0)).toBe(true);
  });

  it("exposes the current hardcoded default thresholds", () => {
    const cal = computeLlmReviewCalibration([]);
    expect(cal.current_thresholds.improve_below).toBeGreaterThan(0);
    expect(cal.current_thresholds.positive_at_or_above).toBeGreaterThan(
      cal.current_thresholds.improve_below
    );
  });
});
