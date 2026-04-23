/**
 * Pre-LLM evidence preview: score + filter by adjustable cutoff (Admin / API).
 */
import type { Pool } from "pg";
import { listEvidenceRowsByImportAndKind } from "../repositories/inputs-evidence.js";
import { extractEvidenceDisplayFields } from "./inputs-evidence-display.js";
import { evaluatePreLlmRow, mergePreLlmConfig } from "./inputs-pre-llm-rank.js";

export interface PreLlmEvidencePreviewRow {
  id: string;
  evidence_kind: string;
  pre_llm_score: number;
  profile_min_score: number;
  dropped_reason: string | null;
  passes_text_gate: boolean;
  url: string | null;
  caption: string | null;
  hashtags: string | null;
}

export interface PreLlmEvidencePreviewResult {
  evidence_kind: string;
  min_score_cutoff: number;
  profile_min_score: number;
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

export async function getPreLlmEvidencePreview(
  db: Pool,
  projectId: string,
  importId: string,
  evidenceKind: string,
  criteria: Record<string, unknown>,
  userMinScore: number,
  limit: number,
  offset: number
): Promise<PreLlmEvidencePreviewResult> {
  const cfg = mergePreLlmConfig(criteria);
  const prof = cfg.kinds?.[evidenceKind] ?? cfg.default_kind ?? { min_score: 0, weights: { text_signal: 1 } };
  const profileMinScore = prof.min_score;

  const dbRows = await listEvidenceRowsByImportAndKind(db, projectId, importId, evidenceKind, 15_000);

  let sparseTextDropped = 0;
  let belowProfileMinDropped = 0;

  const evaluated = dbRows.map((r) => {
    const payload = (r.payload_json ?? {}) as Record<string, unknown>;
    const ev = evaluatePreLlmRow(evidenceKind, payload, criteria);
    if (ev.dropped_reason === "sparse_primary_text") sparseTextDropped++;
    else if (ev.dropped_reason === "below_min_pre_llm_score") belowProfileMinDropped++;
    const disp = extractEvidenceDisplayFields(evidenceKind, payload);
    return {
      id: r.id,
      evidence_kind: r.evidence_kind,
      pre_llm_score: ev.pre_llm_score,
      profile_min_score: ev.profile_min_score,
      dropped_reason: ev.dropped_reason,
      passes_text_gate: ev.passes_text_gate,
      url: disp.url,
      caption: disp.caption,
      hashtags: disp.hashtags,
    };
  });

  const passingProfile = evaluated.filter((e) => e.dropped_reason == null);
  const afterUserCutoff = passingProfile.filter((e) => e.pre_llm_score >= userMinScore);
  afterUserCutoff.sort((a, b) => {
    if (b.pre_llm_score !== a.pre_llm_score) return b.pre_llm_score - a.pre_llm_score;
    return a.id.localeCompare(b.id);
  });

  const lim = Math.min(Math.max(limit, 1), 500);
  const off = Math.max(offset, 0);
  const slice = afterUserCutoff.slice(off, off + lim);

  return {
    evidence_kind: evidenceKind,
    min_score_cutoff: userMinScore,
    profile_min_score: profileMinScore,
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
    has_more: afterUserCutoff.length > off + lim,
  };
}
