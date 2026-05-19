/**
 * Top-performer vision selects rows by **top fraction** of a performance score
 * (`rating_score` when present on the import, else `pre_llm_score`).
 * Does not apply the Evidence-tab `min_pre_llm_score` cutoff unless the percentile gate is explicitly disabled.
 */
import type { TopPerformerRatingGateOverrides } from "./inputs-top-performer-rating-gate.js";

export type TopPerformerPercentileScoreBasis = "rating_score" | "pre_llm_score" | "mixed";

export interface TopPerformerPercentileConfig {
  active: boolean;
  fraction: number;
  disabled: "none" | "criteria" | "request";
  /** Only used when `active` is false (legacy path). */
  legacy_min_pre_llm_score: number;
}

export interface TopPerformerPercentileSelectionStats {
  universe_count: number;
  percentile_cap: number;
  selected_by_percentile: number;
  score_basis: TopPerformerPercentileScoreBasis;
  rated_rows_in_import: number;
}

export interface ScoredTopPerformerRow {
  id: string;
  score: number;
  score_source: "rating_score" | "pre_llm_score";
}

export function resolveTopPerformerPercentileFraction(
  criteria: Record<string, unknown>,
  overrides?: TopPerformerRatingGateOverrides | null
): number {
  const tpRaw = criteria.top_performer;
  const tp =
    tpRaw && typeof tpRaw === "object" && !Array.isArray(tpRaw) ? (tpRaw as Record<string, unknown>) : {};
  const rawFrac = overrides?.rating_top_fraction ?? tp.rating_top_fraction;
  let fraction = 0.05;
  if (typeof rawFrac === "number" && Number.isFinite(rawFrac)) {
    fraction = rawFrac;
  } else if (rawFrac != null && String(rawFrac).trim() !== "") {
    const p = parseFloat(String(rawFrac));
    if (Number.isFinite(p)) fraction = p;
  }
  return Math.min(0.5, Math.max(0.0001, fraction));
}

export function isTopPerformerPercentileGateDisabled(
  criteria: Record<string, unknown>,
  overrides?: TopPerformerRatingGateOverrides | null
): boolean {
  if (overrides?.disable_rating_percentile_gate === true) return true;
  const tpRaw = criteria.top_performer;
  const tp =
    tpRaw && typeof tpRaw === "object" && !Array.isArray(tpRaw) ? (tpRaw as Record<string, unknown>) : {};
  return tp.disable_rating_percentile_gate === true;
}

export function resolveTopPerformerPercentileConfig(
  criteria: Record<string, unknown>,
  overrides?: TopPerformerRatingGateOverrides | null,
  legacyMinPreLlmOverride?: number
): TopPerformerPercentileConfig {
  const tpRaw = criteria.top_performer;
  const tp =
    tpRaw && typeof tpRaw === "object" && !Array.isArray(tpRaw) ? (tpRaw as Record<string, unknown>) : {};
  const disabled = isTopPerformerPercentileGateDisabled(criteria, overrides);
  let legacy = 0.35;
  if (legacyMinPreLlmOverride != null && Number.isFinite(legacyMinPreLlmOverride)) {
    legacy = legacyMinPreLlmOverride;
  } else {
    const n = parseFloat(String(tp.pre_llm_min_score ?? ""));
    if (!Number.isNaN(n)) legacy = Math.max(0, Math.min(1, n));
  }
  if (overrides?.disable_rating_percentile_gate === true) {
    return { active: false, fraction: 0, disabled: "request", legacy_min_pre_llm_score: legacy };
  }
  if (tp.disable_rating_percentile_gate === true) {
    return { active: false, fraction: 0, disabled: "criteria", legacy_min_pre_llm_score: legacy };
  }
  return {
    active: true,
    fraction: resolveTopPerformerPercentileFraction(criteria, overrides),
    disabled: "none",
    legacy_min_pre_llm_score: legacy,
  };
}

export function scoreRowForTopPerformer(
  rowId: string,
  preLlmScore: number,
  ratingScores: Map<string, number>
): ScoredTopPerformerRow {
  const rated = ratingScores.get(rowId);
  if (rated != null && Number.isFinite(rated)) {
    return { id: rowId, score: rated, score_source: "rating_score" };
  }
  return { id: rowId, score: preLlmScore, score_source: "pre_llm_score" };
}

/**
 * Narrow eligible media rows to the top `fraction` by score (optionally within `broadIdSet`).
 */
export function applyTopPerformerPercentileSelection<T extends ScoredTopPerformerRow>(
  eligible: T[],
  config: TopPerformerPercentileConfig,
  opts: {
    broadIdSet?: Set<string> | null;
    maxRows?: number;
    ratedRowsInImport?: number;
  } = {}
): { selected: T[]; stats: TopPerformerPercentileSelectionStats } {
  let universe = eligible;
  if (opts.broadIdSet && opts.broadIdSet.size > 0) {
    universe = eligible.filter((r) => opts.broadIdSet!.has(r.id));
  }

  const ratedInImport = opts.ratedRowsInImport ?? 0;
  let scoreBasis: TopPerformerPercentileScoreBasis = "pre_llm_score";
  if (universe.some((r) => r.score_source === "rating_score")) {
    scoreBasis = universe.every((r) => r.score_source === "rating_score") ? "rating_score" : "mixed";
  }

  if (!config.active) {
    const legacy = config.legacy_min_pre_llm_score;
    const filtered =
      legacy > 0 ? universe.filter((r) => r.score >= legacy) : [...universe];
    const sorted = [...filtered].sort((a, b) => b.score - a.score);
    const capped = opts.maxRows != null ? sorted.slice(0, opts.maxRows) : sorted;
    return {
      selected: capped,
      stats: {
        universe_count: universe.length,
        percentile_cap: 0,
        selected_by_percentile: capped.length,
        score_basis: scoreBasis,
        rated_rows_in_import: ratedInImport,
      },
    };
  }

  const sorted = [...universe].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const percentileCap = sorted.length > 0 ? Math.max(1, Math.ceil(sorted.length * config.fraction)) : 0;
  const byPercentile = sorted.slice(0, percentileCap);
  const capped = opts.maxRows != null ? byPercentile.slice(0, opts.maxRows) : byPercentile;

  return {
    selected: capped,
    stats: {
      universe_count: universe.length,
      percentile_cap: percentileCap,
      selected_by_percentile: byPercentile.length,
      score_basis: scoreBasis,
      rated_rows_in_import: ratedInImport,
    },
  };
}
