/**
 * Top-performer vision passes (image / carousel / video) should not scan the whole import.
 * After the usual pre-LLM cutoff:
 * - By default, rows must have **`broad_llm`** row insights (same cohort as the broad insights pass).
 * - Additionally, rows may be restricted to the top fraction of **rated** performers
 *   (`inputs_evidence_rows.rating_score`), default top 5%.
 */
import type { Pool } from "pg";
import { listEvidenceRowInsightIdsByImportTier } from "../repositories/inputs-evidence-insights.js";
import { listTopFractionRatedEvidenceRowIds } from "../repositories/inputs-evidence.js";

export type TopPerformerRatingGateDisabled = "none" | "criteria" | "no_rated_rows" | "request";

/** Optional per-request overrides for `POST …/run-deep-*-insights` bodies (does not mutate the processing profile). */
export type TopPerformerRatingGateOverrides = {
  /** When true, the rating gate is inactive for this run (same effect as `criteria_json.top_performer.disable_rating_percentile_gate`). */
  disable_rating_percentile_gate?: boolean;
  /** Fraction of rated rows to keep (e.g. 0.05 = top 5%). Overrides `criteria_json.top_performer.rating_top_fraction` when set. */
  rating_top_fraction?: number;
};

/** Maps optional `run-deep-*-insights` POST fields into gate overrides (undefined = use profile only). */
export function buildTopPerformerRatingGateRequestOverrides(opts: {
  rating_top_fraction?: number;
  disable_rating_percentile_gate?: boolean;
}): TopPerformerRatingGateOverrides | undefined {
  const o: TopPerformerRatingGateOverrides = {};
  if (opts.disable_rating_percentile_gate === true) {
    o.disable_rating_percentile_gate = true;
  }
  if (typeof opts.rating_top_fraction === "number" && Number.isFinite(opts.rating_top_fraction)) {
    o.rating_top_fraction = opts.rating_top_fraction;
  }
  if (o.disable_rating_percentile_gate != null || o.rating_top_fraction != null) return o;
  return undefined;
}

export type BroadInsightsSampleGateDisabled = "none" | "criteria" | "no_broad_rows";

export interface ResolvedBroadInsightsSampleGate {
  /** When true, only evidence rows that already have `analysis_tier=broad_llm` insights may proceed. */
  active: boolean;
  broad_llm_row_count: number;
  idSet: Set<string>;
  disabled: BroadInsightsSampleGateDisabled;
}

/**
 * Align expensive vision with the broad-insights sample (`inputs_evidence_row_insights` tier `broad_llm`).
 * Inactive when this import has no broad rows yet (so you can still experiment before the first broad run),
 * unless the gate is explicitly disabled in criteria.
 */
export async function resolveBroadInsightsSampleGate(
  db: Pool,
  importId: string,
  criteria: Record<string, unknown>
): Promise<ResolvedBroadInsightsSampleGate> {
  const tpRaw = criteria.top_performer;
  const tp =
    tpRaw && typeof tpRaw === "object" && !Array.isArray(tpRaw) ? (tpRaw as Record<string, unknown>) : {};
  if (tp.disable_broad_insights_align_gate === true) {
    return { active: false, broad_llm_row_count: 0, idSet: new Set(), disabled: "criteria" };
  }
  const idSet = await listEvidenceRowInsightIdsByImportTier(db, importId, "broad_llm");
  const n = idSet.size;
  if (n <= 0) {
    return { active: false, broad_llm_row_count: 0, idSet, disabled: "no_broad_rows" };
  }
  return { active: true, broad_llm_row_count: n, idSet, disabled: "none" };
}

export interface ResolvedTopPerformerRatingGate {
  /** When true, only `idSet` rows may proceed past the pre-LLM cutoff. */
  active: boolean;
  /** Fraction of rated rows to keep (e.g. 0.05 = top 5%). */
  fraction: number;
  rated_row_count: number;
  gate_row_cap: number;
  idSet: Set<string>;
  disabled: TopPerformerRatingGateDisabled;
}

export async function resolveTopPerformerRatingGate(
  db: Pool,
  projectId: string,
  importId: string,
  criteria: Record<string, unknown>,
  overrides?: TopPerformerRatingGateOverrides | null
): Promise<ResolvedTopPerformerRatingGate> {
  const tpRaw = criteria.top_performer;
  const tp =
    tpRaw && typeof tpRaw === "object" && !Array.isArray(tpRaw) ? (tpRaw as Record<string, unknown>) : {};
  if (overrides?.disable_rating_percentile_gate === true) {
    return {
      active: false,
      fraction: 0,
      rated_row_count: 0,
      gate_row_cap: 0,
      idSet: new Set(),
      disabled: "request",
    };
  }
  if (tp.disable_rating_percentile_gate === true) {
    return {
      active: false,
      fraction: 0,
      rated_row_count: 0,
      gate_row_cap: 0,
      idSet: new Set(),
      disabled: "criteria",
    };
  }
  const rawFrac = overrides?.rating_top_fraction ?? tp.rating_top_fraction;
  let fraction = 0.05;
  if (typeof rawFrac === "number" && Number.isFinite(rawFrac)) {
    fraction = rawFrac;
  } else if (rawFrac != null && String(rawFrac).trim() !== "") {
    const p = parseFloat(String(rawFrac));
    if (Number.isFinite(p)) fraction = p;
  }
  fraction = Math.min(0.5, Math.max(0.0001, fraction));

  const { ids, rated_count, limit_k } = await listTopFractionRatedEvidenceRowIds(db, projectId, importId, fraction);
  if (rated_count <= 0) {
    return {
      active: false,
      fraction,
      rated_row_count: 0,
      gate_row_cap: 0,
      idSet: new Set(),
      disabled: "no_rated_rows",
    };
  }
  return {
    active: true,
    fraction,
    rated_row_count: rated_count,
    gate_row_cap: limit_k,
    idSet: ids,
    disabled: "none",
  };
}
