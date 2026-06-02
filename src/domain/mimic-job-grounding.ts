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
import { contentReferenceIndicesForTemplate } from "./mimic-template-library.js";
import { aestheticSlideRecords, referenceSlideExceedsOnScreenTextLimit } from "./mimic-text-heavy.js";
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
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const raw = asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
  const fromEval = Array.isArray(raw?.content_slide_indices)
    ? raw!.content_slide_indices.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1
      )
    : [];
  if (fromEval.length > 0) {
    const skip = new Set(
      Array.isArray(raw?.skip_slide_indices)
        ? raw!.skip_slide_indices.filter((v: unknown): v is number => typeof v === "number")
        : []
    );
    const filtered = fromEval.filter((i) => i <= totalRefs && !skip.has(i));

    /**
     * Guardrail: sometimes mimic_evaluation undercounts "content" slides in listicle decks
     * (e.g. horoscope/zodiac decks where each frame is a short labeled content slide).
     *
     * If the evaluation yields a tiny subset but many slides clearly have on-screen text,
     * treat those as content for copy generation so we keep the original deck length.
     */
    const slides = aestheticSlideRecords(entry)
      .map((s) => asRecord(s))
      .filter((s): s is Record<string, unknown> => s != null);
    const textful = slides
      .map((s) => {
        const idx = Number(s.slide_index);
        const t = String(s.on_screen_text_transcript ?? "").trim();
        return { idx, hasText: t.length > 0 };
      })
      .filter((x) => Number.isFinite(x.idx) && x.idx >= 1 && x.idx <= totalRefs && x.hasText)
      .map((x) => x.idx);
    const uniqueTextful = Array.from(new Set(textful)).sort((a, b) => a - b);
    const keptTextful = uniqueTextful.filter((i) => !skip.has(i));
    const looksSeverelyUndercounted =
      filtered.length > 0 &&
      keptTextful.length >= 8 &&
      filtered.length <= Math.max(3, Math.floor(keptTextful.length * 0.5));
    if (looksSeverelyUndercounted) {
      return keptTextful;
    }

    return filtered;
  }
  return contentReferenceIndicesForTemplate(entry, totalRefs);
}

function copyLayoutRowWithinTextLimit(row: MimicSlideCopyLayoutForLlm): boolean {
  return !referenceSlideExceedsOnScreenTextLimit({
    on_screen_text_transcript: row.reference_on_screen_text,
    text_blocks: row.text_blocks,
  });
}

export function buildContentSlideCopyLayoutFromEntry(
  entry: Record<string, unknown>
): MimicSlideCopyLayoutForLlm[] {
  const full = buildMimicSlideCopyLayoutFromEntry(entry);
  if (full.length === 0) return full;

  const totalRefs = totalReferenceFramesInEntry(entry);
  const contentIndices = contentIndicesForCopyLayout(entry, totalRefs);
  let layout: MimicSlideCopyLayoutForLlm[];
  if (contentIndices.length === 0 || contentIndices.length >= full.length) {
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

  const withinLimit = layout.filter(copyLayoutRowWithinTextLimit);
  if (withinLimit.length === layout.length) return withinLimit;
  if (withinLimit.length === 0) return layout;
  return withinLimit.map((s, i) => ({ ...s, slide_index: i + 1 }));
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
      `slide_copy_layout (${layout.length} slides — generate exactly this many slides in the same order; per slide: reference_on_screen_text = meaning/subject; visual_description = look; typography.text_placement + text_blocks[].x/y/w/h = placement in 0–1 coords; rephrase only):`,
      JSON.stringify(layout)
    );
  }
  if (vg) {
    parts.push("", "mimic_visual_guideline_for_copy:", JSON.stringify(vg));
  }
  parts.push("", MIMIC_SEMANTIC_FIDELITY_COPY_RULES);
  parts.push(
    "",
    "Write new copy that matches slide_copy_layout structure, placement, and **per-slide meaning** — rephrase reference_on_screen_text; never copy it verbatim and never change the subject of a slide."
  );
  return parts.join("\n").trim();
}
