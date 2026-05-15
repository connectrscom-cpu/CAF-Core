/**
 * Pre-LLM evidence preview: score + filter by adjustable cutoff (Admin / API).
 */
import type { Pool } from "pg";
import { listEvidenceRowsByImportAndKind } from "../repositories/inputs-evidence.js";
import { extractEvidenceDisplayFields } from "./inputs-evidence-display.js";
import { deriveEvidenceDisplayKind } from "./inputs-evidence-post-format.js";
import { evaluatePreLlmRow, mergePreLlmConfig } from "./inputs-pre-llm-rank.js";

export interface PreLlmEvidencePreviewRow {
  id: string;
  evidence_kind: string;
  /** Derived from payload (e.g. `instagram_carousel` vs `instagram_post`). */
  evidence_display_kind: string;
  pre_llm_score: number;
  profile_min_score: number;
  /** Normalized 0–1 feature values before weighting. */
  pre_llm_breakdown: Record<string, number>;
  /** Per-feature contribution to the weighted score: `(f_i * w_i) / sum(w)`. */
  pre_llm_contributions: Record<string, number>;
  dropped_reason: string | null;
  passes_text_gate: boolean;
  included_by_cutoff: boolean;
  url: string | null;
  caption: string | null;
  hashtags: string | null;
}

export interface PreLlmEvidencePreviewResult {
  evidence_kind: string;
  min_score_cutoff: number;
  profile_min_score: number;
  /** Effective weights used for this `evidence_kind` (merged profile). */
  active_weights: Record<string, number>;
  totals: {
    rows_in_kind: number;
    sparse_text_dropped: number;
    below_profile_min_dropped: number;
    passing_profile_min: number;
    after_user_cutoff: number;
  };
  rows: PreLlmEvidencePreviewRow[];
  offset: number;
  limit: number;
  has_more: boolean;
}

export type PreLlmEvidencePreviewSort = "score_desc" | "score_asc";

function contributionBreakdown(features: Record<string, number>, weights: Record<string, number>): Record<string, number> {
  let wsum = 0;
  for (const [, wt] of Object.entries(weights)) {
    if (wt > 0) wsum += wt;
  }
  const out: Record<string, number> = {};
  if (wsum <= 0) return out;
  for (const [k, wt] of Object.entries(weights)) {
    if (wt <= 0) continue;
    const f = Math.min(1, Math.max(0, features[k] ?? 0));
    out[k] = Math.round(((f * wt) / wsum) * 10000) / 10000;
  }
  return out;
}

export async function getPreLlmEvidencePreview(
  db: Pool,
  projectId: string,
  importId: string,
  evidenceKind: string,
  criteria: Record<string, unknown>,
  userMinScore: number,
  limit: number,
  offset: number,
  options?: {
    /** When true, return all rows that pass the profile min score, marking which are included by the cutoff. */
    include_below_cutoff?: boolean;
    sort?: PreLlmEvidencePreviewSort;
  }
): Promise<PreLlmEvidencePreviewResult> {
  const cfg = mergePreLlmConfig(criteria);
  const prof = cfg.kinds?.[evidenceKind] ?? cfg.default_kind ?? { min_score: 0, weights: { text_signal: 1 } };
  const profileMinScore = prof.min_score;
  const activeWeights = { ...prof.weights };

  const dbRows = await listEvidenceRowsByImportAndKind(db, projectId, importId, evidenceKind, 15_000);

  let sparseTextDropped = 0;
  let belowProfileMinDropped = 0;

  const evaluated = dbRows.map((r) => {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const ev = evaluatePreLlmRow(evidenceKind, payload, criteria);
    if (ev.dropped_reason === "sparse_primary_text") sparseTextDropped++;
    else if (ev.dropped_reason === "below_min_pre_llm_score") belowProfileMinDropped++;
    const disp = extractEvidenceDisplayFields(evidenceKind, payload);
    const contrib = contributionBreakdown(ev.pre_llm_breakdown, prof.weights);
    return {
      id: r.id,
      evidence_kind: r.evidence_kind,
      evidence_display_kind: deriveEvidenceDisplayKind(r.evidence_kind, payload),
      pre_llm_score: ev.pre_llm_score,
      profile_min_score: ev.profile_min_score,
      pre_llm_breakdown: ev.pre_llm_breakdown,
      pre_llm_contributions: contrib,
      dropped_reason: ev.dropped_reason,
      passes_text_gate: ev.passes_text_gate,
      included_by_cutoff: ev.dropped_reason == null && ev.pre_llm_score >= userMinScore,
      url: disp.url,
      caption: disp.caption,
      hashtags: disp.hashtags,
    };
  });

  const passingProfile = evaluated.filter((e) => e.dropped_reason == null);
  const afterUserCutoff = passingProfile.filter((e) => e.included_by_cutoff);

  const sort: PreLlmEvidencePreviewSort = options?.sort ?? "score_desc";
  const cmp =
    sort === "score_asc"
      ? (a: PreLlmEvidencePreviewRow, b: PreLlmEvidencePreviewRow) => {
          if (a.pre_llm_score !== b.pre_llm_score) return a.pre_llm_score - b.pre_llm_score;
          return a.id.localeCompare(b.id);
        }
      : (a: PreLlmEvidencePreviewRow, b: PreLlmEvidencePreviewRow) => {
          if (b.pre_llm_score !== a.pre_llm_score) return b.pre_llm_score - a.pre_llm_score;
          return a.id.localeCompare(b.id);
        };

  const includeBelow = Boolean(options?.include_below_cutoff);
  const sorted = includeBelow ? passingProfile.slice() : afterUserCutoff.slice();
  sorted.sort(cmp);

  const lim = Math.min(Math.max(limit, 1), 500);
  const off = Math.max(offset, 0);
  const slice = sorted.slice(off, off + lim);

  return {
    evidence_kind: evidenceKind,
    min_score_cutoff: userMinScore,
    profile_min_score: profileMinScore,
    active_weights: activeWeights,
    totals: {
      rows_in_kind: dbRows.length,
      sparse_text_dropped: sparseTextDropped,
      below_profile_min_dropped: belowProfileMinDropped,
      passing_profile_min: passingProfile.length,
      after_user_cutoff: afterUserCutoff.length,
    },
    rows: slice,
    offset: off,
    limit: lim,
    has_more: sorted.length > off + lim,
  };
}
