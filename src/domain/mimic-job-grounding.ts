/**
 * Per-job top-performer grounding for mimic flows.
 * Signal packs stay slim (no full entry list in LLM context); each planned job carries only its reference.
 */
import type { Pool } from "pg";
import {
  buildMimicSlideCopyLayoutFromEntry,
  serializeSlideCopyLayoutMinimalForCopyGeneration,
  slimMimicVisualGuidelineForLlmCopy,
  type MimicSlideCopyLayoutForLlm,
} from "./mimic-carousel-package.js";
import { buildMimicCopyJobBriefForLlm } from "./mimic-render-context.js";
import { resolveEffectiveContentSlideIndices, shouldExpandThemeSkippedArchiveDeck, pickMimicEvaluationFromGuidelineEntry } from "./mimic-content-slide-indices.js";
import { aestheticSlideRecords } from "./mimic-text-heavy.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "./signal-pack-top-performer-knowledge.js";
import { getEvidenceRowInsightByInsightsId } from "../repositories/inputs-evidence-insights.js";

/** Shared copy contract: rephrase per slide, keep the same subject/claim as the reference. */
export const MIMIC_SEMANTIC_FIDELITY_COPY_RULES = `Semantic fidelity (mimic copy — required):
- **Per slide:** For slide index N, on-slide fields must express the **same idea, subject, and list item** as \`slide_copy_layout[N].reference_on_screen_text\` and \`visual_description\`. Rephrase only — do not swap zodiac signs, products, people, stats, or slide-specific entities.
- **Deck pattern:** Keep the reference format (e.g. "each sign as a food type") across the deck; change surface wording, not the underlying premise per slide.
- **~80% rule:** Applies to phrasing and structure, **not** permission to change what each slide is about. Wrong: reference "taurus as food" → output about Aries or generic "feisty flavors". Right: a fresh line still clearly about Taurus-as-food.`;

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
    if (single) return [single];

    // Fallback: some mimic candidates only carry the insights id inside `candidate_id`.
    // Example: "mimic_ins_3320c73faa_25109_cdeep_FLOW_TOP_PERFORMER_MIMIC_CAROUSEL"
    const cid = String(candidateData.candidate_id ?? candidateData.id ?? "").trim();
    if (cid) {
      const m =
        cid.match(/\bins_[a-zA-Z0-9]+_[0-9]+_cdeep\b/) ??
        cid.match(/\bins_[a-zA-Z0-9]+_[0-9]+\b/) ??
        cid.match(/\bins_[a-zA-Z0-9]+\b/);
      if (m?.[0]) return [m[0]];
    }

    return [];
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

function totalReferenceFramesInEntry(entry: Record<string, unknown>): number {
  const stored = asRecord(entry.stored_inspection_media_json);
  const items = Array.isArray(stored?.items) ? stored!.items : [];
  const slides = aestheticSlideRecords(entry);
  return Math.max(items.length, slides.length, 1);
}

/**
 * Per-slide copy contract aligned to content frames only (skips promo/video indices from mimic_evaluation).
 */
function contentIndicesForCopyLayout(entry: Record<string, unknown>, totalRefs: number): number[] {
  return resolveEffectiveContentSlideIndices(entry, totalRefs);
}

export function buildContentSlideCopyLayoutFromEntry(
  entry: Record<string, unknown>
): MimicSlideCopyLayoutForLlm[] {
  const full = buildMimicSlideCopyLayoutFromEntry(entry);
  if (full.length === 0) return full;

  const totalRefs = totalReferenceFramesInEntry(entry);
  const contentIndices = contentIndicesForCopyLayout(entry, totalRefs);
  const rawEval = pickMimicEvaluationFromGuidelineEntry(entry);
  const fromEval = Array.isArray(rawEval?.content_slide_indices)
    ? rawEval!.content_slide_indices.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= totalRefs
      )
    : [];
  const isThemeArchiveExpansion = shouldExpandThemeSkippedArchiveDeck(entry, fromEval, totalRefs);
  let layout: MimicSlideCopyLayoutForLlm[];
  if (contentIndices.length === 0 || (!isThemeArchiveExpansion && contentIndices.length >= full.length)) {
    layout = full;
  } else {
    const bySlideIndex = new Map(full.map((row) => [row.slide_index, row]));
    layout = contentIndices.map((refIdx, outPos) => {
      const row = bySlideIndex.get(refIdx) ?? full[refIdx - 1];
      if (!row) {
        return {
          slide_index: outPos + 1,
          reference_on_screen_text: null,
          visual_description: null,
          layout_template: null,
          image_or_photo_role: null,
          text_density: null,
          slide_purpose: null,
          graphic_elements: null,
          color_tokens: null,
          typography: null,
          text_blocks: null,
        };
      }
      return { ...row, slide_index: outPos + 1 };
    });
  }

  return layout;
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
    slide_copy_layout: buildContentSlideCopyLayoutFromEntry(entry),
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

function trimMimicGroundingJson(json: string, maxChars: number): string {
  if (json.length <= maxChars) return json;
  return `${json.slice(0, Math.max(0, maxChars - 24))}\n…[grounding truncated]`;
}

export function appendMimicGroundedReferenceToUserPrompt(
  userPrompt: string,
  blocks: {
    mimic_visual_guideline_for_copy?: unknown;
    mimic_render_context?: unknown;
    slide_copy_layout?: MimicSlideCopyLayoutForLlm[];
    hook_text_preview?: string | null;
  },
  opts?: { maxGroundingJsonChars?: number }
): string {
  const maxGroundingJsonChars = opts?.maxGroundingJsonChars ?? 24_000;
  const vgRaw = blocks.mimic_visual_guideline_for_copy;
  const layout =
    blocks.slide_copy_layout && blocks.slide_copy_layout.length > 0
      ? blocks.slide_copy_layout
      : vgRaw
        ? buildMimicSlideCopyLayoutFromEntry(vgRaw as Record<string, unknown>)
        : [];
  const copyBrief = buildMimicCopyJobBriefForLlm(
    blocks.mimic_render_context as Record<string, unknown> | null | undefined
  );
  if (!copyBrief && layout.length === 0) return userPrompt;

  const parts: string[] = [userPrompt.trim(), "", "Grounded top-performer reference (this job only):"];
  if (copyBrief) {
    parts.push("", "mimic_copy_job_brief:", JSON.stringify(copyBrief));
  }
  const hook = String(blocks.hook_text_preview ?? "").trim();
  if (hook) {
    parts.push("", `reference_hook_preview: ${hook.length > 200 ? `${hook.slice(0, 200)}…` : hook}`);
  }
  const slimLayout = serializeSlideCopyLayoutMinimalForCopyGeneration(layout);
  if (slimLayout.length > 0) {
    parts.push(
      "",
      `slide_copy_layout (${slimLayout.length} slides — generate exactly this many slides in the same order; per slide: reference_on_screen_text = meaning/subject to rephrase; visual_description = look; copy_slots_v1 = on-screen placement units for text_blocks[]; rephrase only):`,
      trimMimicGroundingJson(JSON.stringify(slimLayout), maxGroundingJsonChars)
    );
  } else if (vgRaw) {
    const hookOnly = String(asRecord(vgRaw)?.hook_text_preview ?? "").trim();
    if (hookOnly) {
      parts.push("", `reference_hook_preview: ${hookOnly.length > 200 ? `${hookOnly.slice(0, 200)}…` : hookOnly}`);
    }
  }
  parts.push("", MIMIC_SEMANTIC_FIDELITY_COPY_RULES);
  parts.push(
    "",
    "Write new copy that matches slide_copy_layout structure, placement, and **per-slide meaning** — rephrase reference_on_screen_text; never copy it verbatim and never change the subject of a slide.",
    "When copy_slots_v1 is present on a slide, output text_blocks[] with **one entry per OCR box** (one per reference_chars_per_line value, in slot order). The renderer composites each line onto its Document AI box — match reference character count per box."
  );
  return parts.join("\n").trim();
}
