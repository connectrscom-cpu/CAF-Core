/**
 * Top-performer vision selects rows by **top fraction** of a performance score
 * (`rating_score` when present on the import, else `pre_llm_score`).
 *
 * The fraction is applied **per format family** (carousel, video, single_image, …) — e.g. top 5%
 * of carousel-eligible rows and top 5% of video-eligible rows independently, not 5% of the whole import.
 * Does not apply the Evidence-tab `min_pre_llm_score` cutoff unless the percentile gate is explicitly disabled.
 */
import type { TopPerformerRatingGateOverrides } from "./inputs-top-performer-rating-gate.js";
import { deriveEvidencePostFormat } from "./inputs-evidence-post-format.js";

export type TopPerformerPercentileScoreBasis = "rating_score" | "pre_llm_score" | "mixed";

export interface TopPerformerPercentileConfig {
  active: boolean;
  fraction: number;
  disabled: "none" | "criteria" | "request";
  /** Only used when `active` is false (legacy path). */
  legacy_min_pre_llm_score: number;
}

export interface TopPerformerPercentileGroupStat {
  format_family: string;
  universe_count: number;
  percentile_cap: number;
  selected_count: number;
}

export interface TopPerformerPercentileSelectionStats {
  universe_count: number;
  percentile_cap: number;
  selected_by_percentile: number;
  score_basis: TopPerformerPercentileScoreBasis;
  rated_rows_in_import: number;
  /** True when top fraction was computed independently per format family. */
  grouped_by_format_family?: boolean;
  format_groups?: TopPerformerPercentileGroupStat[];
}

export interface ScoredTopPerformerRow {
  id: string;
  score: number;
  score_source: "rating_score" | "pre_llm_score";
}

export function topPerformerFormatFamilyForRow(
  evidenceKind: string,
  payload: Record<string, unknown>
): string {
  return deriveEvidencePostFormat(evidenceKind, payload);
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

function scoreBasisForRows(rows: ScoredTopPerformerRow[]): TopPerformerPercentileScoreBasis {
  if (rows.some((r) => r.score_source === "rating_score")) {
    return rows.every((r) => r.score_source === "rating_score") ? "rating_score" : "mixed";
  }
  return "pre_llm_score";
}

function sortByScoreDesc<T extends ScoredTopPerformerRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function selectTopFractionFromUniverse<T extends ScoredTopPerformerRow>(
  universe: T[],
  fraction: number
): { selected: T[]; percentile_cap: number } {
  const sorted = sortByScoreDesc(universe);
  const percentileCap = sorted.length > 0 ? Math.max(1, Math.ceil(sorted.length * fraction)) : 0;
  return { selected: sorted.slice(0, percentileCap), percentile_cap: percentileCap };
}

/**
 * Narrow eligible media rows to the top `fraction` by score (optionally within `broadIdSet`).
 * When `groupByFormatFamily` is set, the fraction applies independently within each family.
 */
export function applyTopPerformerPercentileSelection<T extends ScoredTopPerformerRow>(
  eligible: T[],
  config: TopPerformerPercentileConfig,
  opts: {
    broadIdSet?: Set<string> | null;
    maxRows?: number;
    ratedRowsInImport?: number;
    groupByFormatFamily?: (row: T) => string;
  } = {}
): { selected: T[]; stats: TopPerformerPercentileSelectionStats } {
  let universe = eligible;
  if (opts.broadIdSet && opts.broadIdSet.size > 0) {
    universe = eligible.filter((r) => opts.broadIdSet!.has(r.id));
  }

  const ratedInImport = opts.ratedRowsInImport ?? 0;
  const scoreBasis = scoreBasisForRows(universe);

  if (!config.active) {
    const legacy = config.legacy_min_pre_llm_score;
    const filtered =
      legacy > 0 ? universe.filter((r) => r.score >= legacy) : [...universe];
    const sorted = sortByScoreDesc(filtered);
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

  if (opts.groupByFormatFamily) {
    const byFamily = new Map<string, T[]>();
    for (const row of universe) {
      const family = opts.groupByFormatFamily(row).trim() || "unknown";
      const list = byFamily.get(family) ?? [];
      list.push(row);
      byFamily.set(family, list);
    }

    const formatGroups: TopPerformerPercentileGroupStat[] = [];
    const merged: T[] = [];
    for (const [formatFamily, rows] of byFamily) {
      const { selected, percentile_cap } = selectTopFractionFromUniverse(rows, config.fraction);
      formatGroups.push({
        format_family: formatFamily,
        universe_count: rows.length,
        percentile_cap,
        selected_count: selected.length,
      });
      merged.push(...selected);
    }

    formatGroups.sort((a, b) => a.format_family.localeCompare(b.format_family));
    const byPercentile = sortByScoreDesc(merged);
    const capped = opts.maxRows != null ? byPercentile.slice(0, opts.maxRows) : byPercentile;
    const totalCap = formatGroups.reduce((n, g) => n + g.percentile_cap, 0);

    return {
      selected: capped,
      stats: {
        universe_count: universe.length,
        percentile_cap: totalCap,
        selected_by_percentile: byPercentile.length,
        score_basis: scoreBasis,
        rated_rows_in_import: ratedInImport,
        grouped_by_format_family: true,
        format_groups: formatGroups,
      },
    };
  }

  const { selected: byPercentile, percentile_cap: percentileCap } = selectTopFractionFromUniverse(
    universe,
    config.fraction
  );
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
