/**
 * Aggregates aesthetic / replication guidance from top-performer insight tiers into a compact
 * `visual_guidelines_pack_v1` object stored on `signal_packs.derived_globals_json` (alongside hashtag leaderboard).
 */
import type { Pool } from "pg";
import type { EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";
import { listTopPerformerInsightsEnriched } from "../repositories/inputs-evidence-insights.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringish(v: unknown, max = 800): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function stringArray(v: unknown, maxItems: number, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = stringish(x, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function perfRating(ins: EvidenceRowInsightEnrichedRow): number | null {
  const raw = ins.evidence_performance_review_json;
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!rec) return null;
  const n = parseFloat(String(rec.rating_score ?? ""));
  return Number.isNaN(n) ? null : n;
}

function extractCueStringsFromEntry(entry: Record<string, unknown>): string[] {
  const cues: string[] = [];
  const push = (s: string | null) => {
    if (!s) return;
    const t = s.trim();
    if (t.length < 4) return;
    cues.push(t.length > 220 ? `${t.slice(0, 220)}…` : t);
  };
  push(stringish(entry.why_it_worked, 400));
  push(stringish(entry.format_pattern, 120));
  push(stringish(entry.visual_consistency, 400));
  const rb = asRecord(entry.replication_blueprint);
  if (rb) {
    for (const s of stringArray(rb.steps_to_remake, 3, 280)) push(s);
  }
  const dvs = asRecord(entry.deck_visual_system);
  if (dvs) {
    push(stringish(dvs.overall_aesthetic, 200));
    push(stringish(dvs.repeated_template, 200));
  }
  return cues;
}

/**
 * One condensed guideline row per top-performer insight (capped), ordered by evidence rating then pre_llm.
 */
export function buildVisualGuidelineEntriesFromInsights(
  rows: EvidenceRowInsightEnrichedRow[],
  opts?: { max_entries?: number }
): { entries: Record<string, unknown>[]; cue_strings: string[] } {
  const maxEntries = Math.min(Math.max(opts?.max_entries ?? 48, 1), 120);
  const sorted = [...rows].sort((a, b) => {
    const ra = perfRating(a) ?? -1;
    const rb = perfRating(b) ?? -1;
    if (rb !== ra) return rb - ra;
    const pa = parseFloat(String(a.pre_llm_score ?? "")) || 0;
    const pb = parseFloat(String(b.pre_llm_score ?? "")) || 0;
    return pb - pa;
  });

  const entries: Record<string, unknown>[] = [];
  const cueSeen = new Set<string>();
  const cue_strings: string[] = [];

  for (const r of sorted) {
    if (entries.length >= maxEntries) break;
    const aes = asRecord(r.aesthetic_analysis_json);
    if (!aes && !r.why_it_worked?.trim()) continue;

    const blueprint = asRecord(aes?.replication_blueprint);
    const deckVs = asRecord(aes?.deck_visual_system);
    const entry: Record<string, unknown> = {
      insights_id: r.insights_id,
      analysis_tier: r.analysis_tier,
      source_evidence_row_id: r.source_evidence_row_id,
      evidence_kind: r.evidence_kind,
      evidence_rating_score: r.evidence_rating_score ?? null,
      evidence_performance_review: r.evidence_performance_review_json ?? null,
      format_pattern: stringish(aes?.format_pattern, 120) ?? r.hook_type,
      why_it_worked: stringish(r.why_it_worked, 500),
      visual_consistency: stringish(aes?.visual_consistency, 500),
      deck_visual_system: deckVs,
      replication_blueprint: blueprint
        ? {
            steps_to_remake: stringArray(blueprint.steps_to_remake, 8, 320),
            tooling_notes: stringish(blueprint.tooling_notes, 400),
            legal_ethics: stringish(blueprint.legal_ethics, 400),
          }
        : null,
      deck_as_whole_summary: stringish(aes?.deck_as_whole_summary, 600),
    };
    entries.push(entry);
    for (const c of extractCueStringsFromEntry(entry)) {
      const k = c.toLowerCase();
      if (cueSeen.has(k)) continue;
      cueSeen.add(k);
      cue_strings.push(c);
      if (cue_strings.length >= 64) break;
    }
  }

  return { entries, cue_strings };
}

export interface VisualGuidelinesPackV1 {
  version: 1;
  generated_at: string;
  inputs_import_id: string;
  insights_scanned: number;
  entries: Record<string, unknown>[];
  /** Short lines for `signal_pack_publication_hints` (carousel / video styling). */
  visual_guideline_cues: string[];
}

export async function buildVisualGuidelinesPackForImport(
  db: Pool,
  projectId: string,
  importId: string,
  opts?: { max_insights_scan?: number; max_entries?: number }
): Promise<VisualGuidelinesPackV1> {
  const scanCap = Math.min(Math.max(opts?.max_insights_scan ?? 2000, 50), 5000);
  const rows = await listTopPerformerInsightsEnriched(db, projectId, importId, scanCap);
  const built = buildVisualGuidelineEntriesFromInsights(rows, { max_entries: opts?.max_entries });
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    inputs_import_id: importId,
    insights_scanned: rows.length,
    entries: built.entries,
    visual_guideline_cues: built.cue_strings,
  };
}
