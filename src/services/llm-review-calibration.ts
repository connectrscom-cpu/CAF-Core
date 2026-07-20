/**
 * Calibration report for the post-approval LLM reviewer (Loop 3).
 *
 * Compares Nemotron `overall_score` against the human editorial decision for
 * the same task, so operators can see whether the reviewer's scores actually
 * separate good from bad content — and get data-driven suggestions for the
 * mint thresholds instead of the hardcoded defaults
 * (DEFAULT_LLM_APPROVAL_MINT_IMPROVE_BELOW / _POSITIVE_AT_OR_ABOVE).
 *
 * Read-only: nothing here mutates rules or reviews.
 */
import type { Pool } from "pg";
import { q } from "../db/queries.js";
import {
  DEFAULT_LLM_APPROVAL_MINT_IMPROVE_BELOW,
  DEFAULT_LLM_APPROVAL_MINT_POSITIVE_AT_OR_ABOVE,
} from "./approved-content-llm-review.js";

export interface CalibrationReviewRow {
  review_id: string;
  task_id: string;
  overall_score: number;
  /** Latest human editorial decision for the task (null when never decided). */
  decision: string | null;
}

export interface ScoreBucket {
  /** Inclusive lower bound of the bucket, e.g. 0.7 for [0.70, 0.75). */
  from: number;
  /** Exclusive upper bound (last bucket includes 1.0). */
  to: number;
  reviews: number;
  human_approved: number;
  human_not_approved: number;
  /** Approval rate among decided reviews in this bucket (null when none decided). */
  human_approval_rate: number | null;
}

export interface LlmReviewCalibration {
  reviews_scored: number;
  reviews_with_human_decision: number;
  approved: number;
  not_approved: number;
  avg_score_approved: number | null;
  avg_score_not_approved: number | null;
  /** avg_score_approved − avg_score_not_approved. Positive = reviewer agrees with humans. */
  score_separation: number | null;
  /**
   * Rank agreement (AUC): probability a random approved review outscores a
   * random non-approved one. 0.5 = no signal, 1.0 = perfect separation.
   */
  rank_agreement: number | null;
  buckets: ScoreBucket[];
  current_thresholds: { improve_below: number; positive_at_or_above: number };
  suggested_thresholds: {
    /** Median score of human-rejected/needs-edit content (mint improvements below it). */
    improve_below: number | null;
    /** 75th percentile score of human-approved content (mint strengths at/above it). */
    positive_at_or_above: number | null;
    sample_sufficient: boolean;
    rationale: string;
  };
}

export interface CalibrationOptions {
  /** Bucket width for the score histogram (default 0.05). */
  bucket_width?: number;
  /** Min decided reviews on each side before thresholds are suggested (default 10). */
  min_decided_per_side?: number;
}

const APPROVED = "APPROVED";
const NOT_APPROVED = new Set(["REJECTED", "NEEDS_EDIT"]);

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return round4(xs.reduce((s, x) => s + x, 0) / xs.length);
}

/** p in [0,1]; linear interpolation between order statistics. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Mann–Whitney style rank agreement with tie correction (ties count 0.5). */
export function rankAgreement(approvedScores: number[], notApprovedScores: number[]): number | null {
  if (approvedScores.length === 0 || notApprovedScores.length === 0) return null;
  let wins = 0;
  for (const a of approvedScores) {
    for (const b of notApprovedScores) {
      if (a > b) wins += 1;
      else if (a === b) wins += 0.5;
    }
  }
  return round4(wins / (approvedScores.length * notApprovedScores.length));
}

export function computeLlmReviewCalibration(
  rows: CalibrationReviewRow[],
  opts?: CalibrationOptions
): LlmReviewCalibration {
  const bucketWidth = Math.min(0.25, Math.max(0.01, opts?.bucket_width ?? 0.05));
  const minPerSide = Math.max(1, opts?.min_decided_per_side ?? 10);

  const approvedScores: number[] = [];
  const notApprovedScores: number[] = [];
  for (const r of rows) {
    const d = (r.decision ?? "").trim().toUpperCase();
    if (d === APPROVED) approvedScores.push(r.overall_score);
    else if (NOT_APPROVED.has(d)) notApprovedScores.push(r.overall_score);
  }

  const bucketCount = Math.ceil(1 / bucketWidth);
  const buckets: ScoreBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: round4(i * bucketWidth),
    to: round4(Math.min(1, (i + 1) * bucketWidth)),
    reviews: 0,
    human_approved: 0,
    human_not_approved: 0,
    human_approval_rate: null,
  }));
  for (const r of rows) {
    const idx = Math.min(bucketCount - 1, Math.floor(r.overall_score / bucketWidth));
    const b = buckets[idx];
    b.reviews++;
    const d = (r.decision ?? "").trim().toUpperCase();
    if (d === APPROVED) b.human_approved++;
    else if (NOT_APPROVED.has(d)) b.human_not_approved++;
  }
  for (const b of buckets) {
    const decided = b.human_approved + b.human_not_approved;
    b.human_approval_rate = decided > 0 ? round4(b.human_approved / decided) : null;
  }

  const avgApproved = mean(approvedScores);
  const avgNotApproved = mean(notApprovedScores);

  const sampleSufficient =
    approvedScores.length >= minPerSide && notApprovedScores.length >= minPerSide;
  const sortedApproved = [...approvedScores].sort((a, b) => a - b);
  const sortedNotApproved = [...notApprovedScores].sort((a, b) => a - b);
  const suggestedImprove = sampleSufficient ? percentile(sortedNotApproved, 0.5) : null;
  const suggestedPositive = sampleSufficient ? percentile(sortedApproved, 0.75) : null;

  return {
    reviews_scored: rows.length,
    reviews_with_human_decision: approvedScores.length + notApprovedScores.length,
    approved: approvedScores.length,
    not_approved: notApprovedScores.length,
    avg_score_approved: avgApproved,
    avg_score_not_approved: avgNotApproved,
    score_separation:
      avgApproved != null && avgNotApproved != null ? round4(avgApproved - avgNotApproved) : null,
    rank_agreement: rankAgreement(approvedScores, notApprovedScores),
    buckets: buckets.filter((b) => b.reviews > 0),
    current_thresholds: {
      improve_below: DEFAULT_LLM_APPROVAL_MINT_IMPROVE_BELOW,
      positive_at_or_above: DEFAULT_LLM_APPROVAL_MINT_POSITIVE_AT_OR_ABOVE,
    },
    suggested_thresholds: {
      improve_below: suggestedImprove != null ? round4(suggestedImprove) : null,
      positive_at_or_above: suggestedPositive != null ? round4(suggestedPositive) : null,
      sample_sufficient: sampleSufficient,
      rationale: sampleSufficient
        ? "improve_below = median LLM score of human-rejected/needs-edit content; positive_at_or_above = 75th percentile LLM score of human-approved content. Pass these as mint_pending_hints_below_score / mint_positive_hints_above_score when triggering reviews."
        : `Need at least ${minPerSide} decided reviews on each side (approved vs rejected/needs-edit) before suggesting thresholds; defaults remain in effect.`,
    },
  };
}

export async function getLlmReviewCalibrationForProject(
  db: Pool,
  projectId: string,
  opts?: CalibrationOptions & { window_days?: number }
): Promise<LlmReviewCalibration & { window_days: number }> {
  const windowDays = Math.min(365, Math.max(1, opts?.window_days ?? 120));
  const rows = await q<{
    review_id: string;
    task_id: string;
    overall_score: string | number;
    decision: string | null;
  }>(
    db,
    `SELECT r.review_id, r.task_id, r.overall_score, lr.decision
     FROM caf_core.llm_approval_reviews r
     LEFT JOIN LATERAL (
       SELECT decision FROM caf_core.editorial_reviews
       WHERE project_id = r.project_id AND task_id = r.task_id AND decision IS NOT NULL
       ORDER BY created_at DESC LIMIT 1
     ) lr ON true
     WHERE r.project_id = $1
       AND r.overall_score IS NOT NULL
       AND r.created_at >= now() - ($2 || ' days')::interval`,
    [projectId, String(windowDays)]
  );
  const parsed: CalibrationReviewRow[] = rows
    .map((r) => ({
      review_id: r.review_id,
      task_id: r.task_id,
      overall_score:
        typeof r.overall_score === "number" ? r.overall_score : parseFloat(String(r.overall_score)),
      decision: r.decision,
    }))
    .filter((r) => Number.isFinite(r.overall_score));
  return { ...computeLlmReviewCalibration(parsed, opts), window_days: windowDays };
}
