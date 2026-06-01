/**
 * Per-job top-performer grounding for mimic flows.
 * Signal packs stay slim (no full entry list in LLM context); each planned job carries only its reference.
 */
import type { Pool } from "pg";
import {
  buildMimicSlideCopyLayoutFromEntry,
  slimMimicVisualGuidelineForLlmCopy,
  type MimicSlideCopyLayoutForLlm,
} from "./mimic-carousel-package.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "./signal-pack-top-performer-knowledge.js";
import { getEvidenceRowInsightByInsightsId } from "../repositories/inputs-evidence-insights.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Insight ids from planner row (`grounding_insight_ids` or legacy fields). */
export function groundingInsightIdsFromCandidate(
  candidateData: Record<string, unknown> | null | undefined
): string[] {
  if (!candidateData) return [];
  const raw = candidateData.grounding_insight_ids;
  if (!Array.isArray(raw)) {
    const single = String(candidateData.source_insights_id ?? "").trim();
    return single ? [single] : [];
  }
  return raw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

/** Resolve the single visual-guidelines pack entry for this job's grounding ids. */
export function findVisualGuidelinePackEntry(
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightIds: string[]
): Record<string, unknown> | null {
  if (insightIds.length === 0) return null;
  const pack = asRecord(derivedGlobals?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  const idSet = new Set(insightIds);
  for (const raw of entries) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const iid = String(rec.insights_id ?? "").trim();
    if (iid && idSet.has(iid)) return rec;
  }
  for (const raw of entries) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const iid = String(rec.insights_id ?? "").trim();
    if (!iid) continue;
    if (insightIds.some((w) => w === iid || iid.startsWith(`${w}_`) || w.startsWith(`${iid}_`))) {
      return rec;
    }
  }
  return null;
}

/** Prefer full insight-row aesthetic JSON over compact pack `aesthetic_analysis_json` slices. */
export function enrichGuidelineEntryFromLineageInsight(
  entry: Record<string, unknown>,
  insightRow: { aesthetic_analysis_json?: unknown; hook_text?: string | null }
): Record<string, unknown> {
  const rowAes = asRecord(insightRow.aesthetic_analysis_json);
  const packAes = asRecord(entry.aesthetic_analysis_json);
  const packSlides = Array.isArray(packAes?.slides) ? packAes!.slides.length : 0;
  const rowSlides = Array.isArray(rowAes?.slides) ? rowAes.slides.length : 0;
  const out: Record<string, unknown> = { ...entry };
  if (rowAes && rowSlides >= packSlides) {
    out.aesthetic_analysis_json = rowAes;
  }
  const hook = String(insightRow.hook_text ?? "").trim();
  if (hook && !String(out.hook_text_preview ?? "").trim()) {
    out.hook_text_preview = hook;
  }
  return out;
}

/** Pack entry merged with DB insight row when available (full transcripts, text_blocks, typography). */
export async function resolveGuidelineEntryForMimicJob(
  db: Pool | null,
  projectId: string,
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightIds: string[]
): Promise<Record<string, unknown> | null> {
  if (insightIds.length === 0) return null;
  let entry = findVisualGuidelinePackEntry(derivedGlobals, insightIds);
  if (!entry) return null;
  const sourceId = String(entry.insights_id ?? insightIds[0]).trim();
  if (db && projectId && sourceId) {
    const row = await getEvidenceRowInsightByInsightsId(db, projectId, sourceId);
    if (row) {
      entry = enrichGuidelineEntryFromLineageInsight(entry, {
        aesthetic_analysis_json: row.aesthetic_analysis_json,
        hook_text: row.hook_text,
      });
    }
  }
  return entry;
}

export interface MimicJobPlanningGrounding {
  grounding_insight_ids: string[];
  source_insights_id: string;
  visual_guideline_for_copy: ReturnType<typeof slimMimicVisualGuidelineForLlmCopy>;
  /** Per-slide: reference text, visual look, typography, and normalized text block placement. */
  slide_copy_layout: MimicSlideCopyLayoutForLlm[];
}

export function buildMimicJobPlanningGroundingFromEntry(
  entry: Record<string, unknown>,
  insightIds: string[]
): MimicJobPlanningGrounding {
  const sourceId = String(entry.insights_id ?? insightIds[0]).trim();
  return {
    grounding_insight_ids: insightIds,
    source_insights_id: sourceId,
    visual_guideline_for_copy: slimMimicVisualGuidelineForLlmCopy(entry),
    slide_copy_layout: buildMimicSlideCopyLayoutFromEntry(entry),
  };
}

/**
 * Slice stored on `generation_payload.mimic_job_grounding` at plan time.
 * Loads full vision row from DB when possible so text_blocks / typography are present.
 */
export async function buildMimicJobPlanningGrounding(
  db: Pool | null,
  projectId: string,
  derivedGlobals: Record<string, unknown> | null | undefined,
  candidateData: Record<string, unknown> | null | undefined
): Promise<MimicJobPlanningGrounding | null> {
  const insightIds = groundingInsightIdsFromCandidate(candidateData);
  if (insightIds.length === 0) return null;
  const entry = await resolveGuidelineEntryForMimicJob(db, projectId, derivedGlobals, insightIds);
  if (!entry) return null;
  return buildMimicJobPlanningGroundingFromEntry(entry, insightIds);
}

export function buildSlideCopyLayoutForLlmFromPayload(payload: {
  mimic_visual_guideline_for_copy?: unknown;
  mimic_job_grounding?: unknown;
  mimic_v1?: unknown;
}): MimicSlideCopyLayoutForLlm[] {
  const fromGrounding = asRecord(payload.mimic_job_grounding);
  if (Array.isArray(fromGrounding?.slide_copy_layout) && fromGrounding!.slide_copy_layout.length > 0) {
    return fromGrounding!.slide_copy_layout as MimicSlideCopyLayoutForLlm[];
  }
  const vg =
    payload.mimic_visual_guideline_for_copy ??
    fromGrounding?.visual_guideline_for_copy ??
    asRecord(payload.mimic_v1)?.visual_guideline;
  if (vg && typeof vg === "object") {
    const layout = buildMimicSlideCopyLayoutFromEntry(vg as Record<string, unknown>);
    if (layout.length > 0) return layout;
  }
  return [];
}

export function appendMimicGroundedReferenceToUserPrompt(
  userPrompt: string,
  blocks: {
    mimic_visual_guideline_for_copy?: unknown;
    mimic_render_context?: unknown;
    mimic_job_grounding?: unknown;
    slide_copy_layout?: MimicSlideCopyLayoutForLlm[];
  }
): string {
  const vg =
    blocks.mimic_visual_guideline_for_copy ??
    asRecord(blocks.mimic_job_grounding)?.visual_guideline_for_copy;
  const ctx = blocks.mimic_render_context;
  const layout =
    blocks.slide_copy_layout && blocks.slide_copy_layout.length > 0
      ? blocks.slide_copy_layout
      : vg
        ? buildMimicSlideCopyLayoutFromEntry(vg as Record<string, unknown>)
        : [];
  if (!vg && !ctx && layout.length === 0) return userPrompt;

  const parts: string[] = [userPrompt.trim(), "", "Grounded top-performer reference (this job only):"];
  if (ctx) {
    parts.push("", "mimic_render_context:", JSON.stringify(ctx));
  }
  if (layout.length > 0) {
    parts.push(
      "",
      "slide_copy_layout (per slide: reference_on_screen_text = what the archived post said; visual_description = how it looks; typography.text_placement + text_blocks[].x/y/w/h = where text sits in normalized 0–1 coordinates; match roles/length/placement with fresh wording):",
      JSON.stringify(layout)
    );
  }
  if (vg) {
    parts.push("", "mimic_visual_guideline_for_copy:", JSON.stringify(vg));
  }
  parts.push(
    "",
    "Write new copy that fits the same slide structure and text placement as slide_copy_layout — do not transcribe reference_on_screen_text verbatim."
  );
  return parts.join("\n").trim();
}
