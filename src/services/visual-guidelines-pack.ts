/**
 * Aggregates aesthetic / replication guidance from top-performer insight tiers into a compact
 * `visual_guidelines_pack_v1` object stored on `signal_packs.derived_globals_json` (alongside hashtag leaderboard).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";
import { listTopPerformerInsightsEnriched } from "../repositories/inputs-evidence-insights.js";
import { listEvidenceRowsByIds } from "../repositories/inputs-evidence.js";
import { listEvidenceMediaStorageByRowIds } from "../repositories/inputs-evidence-media.js";
import { postUrlForTopPerformerPreview } from "./inputs-top-performer-qualifying-preview.js";
import {
  compactEvidenceMediaRows,
  compactStoredInspectionMedia,
  mergeInspectionMedia,
  normalizeFormatPattern,
  primaryFormatKey,
  signInspectionMediaForDisplay,
  type VisualGuidelineInspectionMedia,
} from "./visual-guidelines-media.js";
import { compactCueList } from "./visual-guidelines-cues.js";
import { normalizeMimicEvaluation } from "./carousel-insights-llm-normalize.js";

const MAX_CUES_PER_FORMAT = 10;

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

export interface VisualGuidelineCueGroup {
  format_pattern: string;
  format_key: string;
  cues: string[];
  example_insights_ids: string[];
}

export function extractCueStringsFromEntry(entry: Record<string, unknown>): string[] {
  const cues: string[] = [];
  const push = (s: string | null) => {
    if (!s) return;
    const t = s.trim();
    if (t.length < 4) return;
    cues.push(t.length > 220 ? `${t.slice(0, 220)}…` : t);
  };
  const why = stringish(entry.why_it_worked, 220);
  const summary =
    stringish(entry.deck_as_whole_summary, 220) ?? stringish(entry.video_as_whole_summary, 220);
  push(why ?? summary);
  push(stringish(entry.visual_consistency, 200));
  const dvs = asRecord(entry.deck_visual_system) ?? asRecord(entry.video_visual_system);
  if (dvs) {
    push(stringish(dvs.overall_aesthetic, 140));
    const tmpl = stringish(dvs.repeated_template, 140);
    if (tmpl && !isRedundantText(tmpl, cues)) push(tmpl);
  }
  const rb = asRecord(entry.replication_blueprint);
  if (rb) {
    for (const s of stringArray(rb.steps_to_remake, 3, 200)) push(s);
  }
  return compactCueList(cues, 6);
}

function isRedundantText(candidate: string, existing: string[]): boolean {
  const c = candidate.toLowerCase();
  return existing.some((e) => e.toLowerCase().includes(c) || c.includes(e.toLowerCase()));
}

function buildCueGroups(entries: Record<string, unknown>[]): VisualGuidelineCueGroup[] {
  const byKey = new Map<string, VisualGuidelineCueGroup>();
  for (const entry of entries) {
    const formatPattern = normalizeFormatPattern(entry.format_pattern);
    const key = primaryFormatKey(formatPattern);
    const insId = String(entry.insights_id ?? "").trim();
    let g = byKey.get(key);
    if (!g) {
      g = { format_pattern: formatPattern, format_key: key, cues: [], example_insights_ids: [] };
      byKey.set(key, g);
    }
    if (insId && g.example_insights_ids.length < 12 && !g.example_insights_ids.includes(insId)) {
      g.example_insights_ids.push(insId);
    }
    for (const c of extractCueStringsFromEntry(entry)) {
      g.cues.push(c);
    }
  }
  for (const g of byKey.values()) {
    g.cues = compactCueList(g.cues, MAX_CUES_PER_FORMAT);
  }
  return [...byKey.values()].sort((a, b) => b.cues.length - a.cues.length);
}

function flatCueStrings(groups: VisualGuidelineCueGroup[], cap = 64): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const c of g.cues) {
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export type VisualGuidelineBuildOpts = {
  max_entries?: number;
  evidenceMediaByRowId?: Map<string, ReturnType<typeof compactEvidenceMediaRows>>;
  evidencePostUrlByRowId?: Map<string, string>;
};

/** Classifier + mimic prep fields preserved on pack entries (slides capped). */
function compactAestheticAnalysisForPackEntry(aes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fp = aes.format_pattern;
  if (fp != null) out.format_pattern = fp;
  const vc = aes.visual_consistency;
  if (vc != null) out.visual_consistency = vc;
  if (aes.deck_visual_system != null) out.deck_visual_system = aes.deck_visual_system;
  if (aes.replication_blueprint != null) out.replication_blueprint = aes.replication_blueprint;

  const mimicEval = normalizeMimicEvaluation(aes.mimic_evaluation);
  if (mimicEval) out.mimic_evaluation = mimicEval;

  const slidesRaw = Array.isArray(aes.slides) ? aes.slides : [];
  if (slidesRaw.length > 0) {
    const slides: Record<string, unknown>[] = [];
    for (const raw of slidesRaw.slice(0, 24)) {
      const s = asRecord(raw);
      if (!s) continue;
      const typo = asRecord(s.typography);
      const textBlocks = Array.isArray(s.text_blocks) ? s.text_blocks.slice(0, 12) : [];
      slides.push({
        slide_index: s.slide_index,
        on_screen_text_transcript: stringish(s.on_screen_text_transcript, 400),
        visual_description: stringish(s.visual_description, 280),
        layout_template: stringish(s.layout_template, 120),
        text_density: stringish(s.text_density, 40),
        image_or_photo_role: stringish(s.image_or_photo_role, 80),
        slide_purpose: stringish(s.slide_purpose, 40),
        brand_specificity: stringish(s.brand_specificity, 40),
        graphic_elements: stringish(s.graphic_elements, 200),
        ...(typo ? { typography: typo } : {}),
        ...(textBlocks.length > 0 ? { text_blocks: textBlocks } : {}),
      });
    }
    if (slides.length > 0) out.slides = slides;
  }
  return out;
}

async function evidencePostUrlMapForRowIds(
  db: Pool,
  projectId: string,
  importId: string,
  rowIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(rowIds.map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))];
  if (unique.length === 0) return new Map();
  const rows = await listEvidenceRowsByIds(db, projectId, importId, unique);
  const out = new Map<string, string>();
  for (const r of rows) {
    const payload =
      r.payload_json && typeof r.payload_json === "object" && !Array.isArray(r.payload_json)
        ? (r.payload_json as Record<string, unknown>)
        : {};
    const url = postUrlForTopPerformerPreview(r.evidence_kind, payload);
    if (url) out.set(r.id, url);
  }
  return out;
}

/**
 * One condensed guideline row per top-performer insight (capped), ordered by evidence rating then pre_llm.
 */
export function buildVisualGuidelineEntriesFromInsights(
  rows: EvidenceRowInsightEnrichedRow[],
  opts?: VisualGuidelineBuildOpts
): { entries: Record<string, unknown>[]; cue_strings: string[]; cues_by_format: VisualGuidelineCueGroup[] } {
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

  for (const r of sorted) {
    if (entries.length >= maxEntries) break;
    const aes = asRecord(r.aesthetic_analysis_json);
    if (!aes && !r.why_it_worked?.trim()) continue;

    const blueprint = asRecord(aes?.replication_blueprint);
    const deckVs = asRecord(aes?.deck_visual_system);
    const videoVs = asRecord(aes?.video_visual_system);
    const formatPattern = normalizeFormatPattern(aes?.format_pattern ?? r.hook_type);

    const fromInsight = compactStoredInspectionMedia(r.stored_inspection_media_json);
    const fromEvidence = opts?.evidenceMediaByRowId?.get(r.source_evidence_row_id) ?? null;
    const inspection_media = mergeInspectionMedia(fromInsight, fromEvidence);

    const postUrl = opts?.evidencePostUrlByRowId?.get(r.source_evidence_row_id) ?? null;

    const mimicEvaluation = aes ? normalizeMimicEvaluation(aes.mimic_evaluation) : null;
    const aestheticSlice = aes ? compactAestheticAnalysisForPackEntry(aes) : null;

    const entry: Record<string, unknown> = {
      insights_id: r.insights_id,
      analysis_tier: r.analysis_tier,
      source_evidence_row_id: r.source_evidence_row_id,
      evidence_post_url: postUrl,
      evidence_kind: r.evidence_kind,
      evidence_rating_score: r.evidence_rating_score ?? null,
      evidence_performance_review: r.evidence_performance_review_json ?? null,
      format_pattern: formatPattern,
      format_key: primaryFormatKey(formatPattern),
      hook_text_preview: stringish(r.hook_text, 280),
      why_it_worked: stringish(r.why_it_worked, 500),
      visual_consistency: stringish(aes?.visual_consistency, 500),
      deck_visual_system: deckVs,
      video_visual_system: videoVs,
      replication_blueprint: blueprint
        ? {
            steps_to_remake: stringArray(blueprint.steps_to_remake, 8, 320),
            tooling_notes: stringish(blueprint.tooling_notes, 400),
            legal_ethics: stringish(blueprint.legal_ethics, 400),
          }
        : null,
      deck_as_whole_summary: stringish(aes?.deck_as_whole_summary, 600),
      video_as_whole_summary: stringish(aes?.video_as_whole_summary ?? aes?.style_summary, 600),
      inspection_media: inspection_media as unknown as Record<string, unknown>,
      ...(mimicEvaluation ? { mimic_evaluation: mimicEvaluation } : {}),
      ...(aestheticSlice && Object.keys(aestheticSlice).length > 0
        ? { aesthetic_analysis_json: aestheticSlice }
        : {}),
    };
    entries.push(entry);
  }

  const cues_by_format = buildCueGroups(entries);
  const cue_strings = flatCueStrings(cues_by_format, 64);

  return { entries, cue_strings, cues_by_format };
}

export interface VisualGuidelinesPackV1 {
  version: 1;
  generated_at: string;
  inputs_import_id: string;
  insights_scanned: number;
  entries: Record<string, unknown>[];
  /** Flat list (legacy / generation). Prefer `visual_guideline_cues_by_format` in UI. */
  visual_guideline_cues: string[];
  visual_guideline_cues_by_format: VisualGuidelineCueGroup[];
}

export async function buildVisualGuidelinesPackForImport(
  db: Pool,
  projectId: string,
  importId: string,
  opts?: { max_insights_scan?: number; max_entries?: number }
): Promise<VisualGuidelinesPackV1> {
  const scanCap = Math.min(Math.max(opts?.max_insights_scan ?? 2000, 50), 5000);
  const rows = await listTopPerformerInsightsEnriched(db, projectId, importId, scanCap);

  const rowIds = [...new Set(rows.map((r) => r.source_evidence_row_id).filter(Boolean))];
  const mediaRows = await listEvidenceMediaStorageByRowIds(db, projectId, rowIds);
  const evidenceMediaByRowId = new Map<string, ReturnType<typeof compactEvidenceMediaRows>>();
  const byRow = new Map<string, typeof mediaRows>();
  for (const m of mediaRows) {
    const arr = byRow.get(m.evidence_row_id) ?? [];
    arr.push(m);
    byRow.set(m.evidence_row_id, arr);
  }
  for (const [rid, arr] of byRow) {
    evidenceMediaByRowId.set(rid, compactEvidenceMediaRows(arr));
  }

  const evidencePostUrlByRowId = await evidencePostUrlMapForRowIds(db, projectId, importId, rowIds);

  const built = buildVisualGuidelineEntriesFromInsights(rows, {
    max_entries: opts?.max_entries,
    evidenceMediaByRowId,
    evidencePostUrlByRowId,
  });
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    inputs_import_id: importId,
    insights_scanned: rows.length,
    entries: built.entries,
    visual_guideline_cues: built.cue_strings,
    visual_guideline_cues_by_format: built.cues_by_format,
  };
}

/**
 * Re-attach inspection media from current insight rows (for packs saved before media fields existed).
 */
export async function hydrateVisualGuidelinesPackMedia(
  db: Pool,
  projectId: string,
  pack: VisualGuidelinesPackV1,
  config?: AppConfig
): Promise<VisualGuidelinesPackV1> {
  const importId = pack.inputs_import_id;
  if (!importId || !Array.isArray(pack.entries) || pack.entries.length === 0) return pack;

  const rowIds = [
    ...new Set(
      pack.entries
        .map((e) => String(e.source_evidence_row_id ?? "").trim())
        .filter((x) => /^\d+$/.test(x))
    ),
  ];
  if (rowIds.length === 0) return pack;

  const insights = await listTopPerformerInsightsEnriched(db, projectId, importId, 3000);
  const insightByRow = new Map<string, EvidenceRowInsightEnrichedRow[]>();
  for (const ins of insights) {
    const id = ins.source_evidence_row_id;
    if (!id) continue;
    const arr = insightByRow.get(id) ?? [];
    arr.push(ins);
    insightByRow.set(id, arr);
  }

  const mediaRows = await listEvidenceMediaStorageByRowIds(db, projectId, rowIds);
  const evidenceMediaByRowId = new Map<string, ReturnType<typeof compactEvidenceMediaRows>>();
  const byRow = new Map<string, typeof mediaRows>();
  for (const m of mediaRows) {
    const arr = byRow.get(m.evidence_row_id) ?? [];
    arr.push(m);
    byRow.set(m.evidence_row_id, arr);
  }
  for (const [rid, arr] of byRow) {
    evidenceMediaByRowId.set(rid, compactEvidenceMediaRows(arr));
  }

  const evidencePostUrlByRowId = await evidencePostUrlMapForRowIds(db, projectId, importId, rowIds);

  const entries: Record<string, unknown>[] = [];
  for (const entry of pack.entries) {
    const rowId = String(entry.source_evidence_row_id ?? "").trim();
    const tier = String(entry.analysis_tier ?? "");
    const candidates = insightByRow.get(rowId) ?? [];
    const ins =
      candidates.find((c) => c.analysis_tier === tier) ??
      candidates.find((c) => c.insights_id === entry.insights_id) ??
      candidates[0];
    const fromInsight = ins ? compactStoredInspectionMedia(ins.stored_inspection_media_json) : null;
    const fromEvidence = evidenceMediaByRowId.get(rowId) ?? null;
    let inspection_media = mergeInspectionMedia(fromInsight, fromEvidence);
    if (config && inspection_media) {
      inspection_media = await signInspectionMediaForDisplay(config, inspection_media);
    }
    const postUrl =
      (typeof entry.evidence_post_url === "string" && entry.evidence_post_url.trim()) ||
      evidencePostUrlByRowId.get(rowId) ||
      null;
    const hasMedia = !!inspection_media?.items.length || !!asRecord(entry.inspection_media)?.items;
    if (!hasMedia && !postUrl) {
      entries.push(entry);
      continue;
    }
    entries.push({
      ...entry,
      ...(postUrl ? { evidence_post_url: postUrl } : {}),
      ...(inspection_media
        ? { inspection_media: inspection_media as unknown as Record<string, unknown> }
        : {}),
    });
  }

  const cues_by_format = buildCueGroups(entries);
  return {
    ...pack,
    entries,
    visual_guideline_cues: flatCueStrings(cues_by_format, 64),
    visual_guideline_cues_by_format: cues_by_format,
  };
}
