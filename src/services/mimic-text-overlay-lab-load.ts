import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import {
  buildSignalPackMimicReferencesForUi,
  type SignalPackMimicReferenceUiRow,
} from "./signal-pack-mimic-ui.js";
import type { MimicTextOverlayLabFixture } from "./mimic-text-overlay-lab.js";
import {
  copyBlocksFromSlideRecord,
  inferMimicReferenceCopySlots,
  llmSlideFromCopySlots,
} from "./mimic-copy-slots.js";
import type { Pool } from "pg";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Starter LLM copy shape for overlay lab (roles preserved, text prefixed for easy spotting). */
export function buildDefaultLlmSlideFromInsightSlide(
  slide: Record<string, unknown> | null
): Record<string, unknown> {
  if (!slide) {
    return { headline: "Sample headline", body: "Sample body copy for overlay lab." };
  }
  const refText = String(slide.on_screen_text_transcript ?? slide.on_image_text ?? "").trim();
  const blocks = copyBlocksFromSlideRecord(slide);
  if (blocks.length > 0) {
    const slots = inferMimicReferenceCopySlots(blocks, refText);
    return llmSlideFromCopySlots(slots);
  }
  const legacyBlocks = Array.isArray(slide.text_blocks) ? slide.text_blocks : [];
  if (legacyBlocks.length > 0) {
    return {
      text_blocks: legacyBlocks.map((b: unknown) => {
        const rec = asRecord(b) ?? {};
        return {
          role: rec.role ?? "body",
          text: String(rec.text ?? "").slice(0, 120),
        };
      }),
    };
  }
  return {
    headline: refText ? refText.slice(0, 80) : "Sample headline",
    body: "Sample body copy for overlay lab.",
  };
}

export function listCarouselMimicReferencesFromSignalPack(
  signalPack: SignalPackRow
): SignalPackMimicReferenceUiRow[] {
  return buildSignalPackMimicReferencesForUi(signalPack).filter((r) => r.mimic_kind === "carousel");
}

export async function loadMimicTextOverlayFixtureFromInsights(
  db: Pool,
  insightsId: string,
  slideIndex: number
): Promise<MimicTextOverlayLabFixture> {
  const vg = await fetchInsightVisualGuideline(db, insightsId);
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const slideRec = slides.find(
    (s: unknown) => s && typeof s === "object" && Number(asRecord(s)?.slide_index) === slideIndex
  );
  const slide = asRecord(slideRec);
  const llm_slide = buildDefaultLlmSlideFromInsightSlide(slide);

  const mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans"> = {
    visual_guideline: vg,
    reference_items: [{ index: slideIndex, role: "carousel_slide", vision_fetch_url: "", source_slide_index: slideIndex }],
    slide_plans: [{ slide_index: slideIndex, reference_index: slideIndex, render_mode: "hbs" }],
  };

  return {
    description: `Insights ${insightsId} · slide ${slideIndex}`,
    slide_index: slideIndex,
    llm_slide,
    mimic,
  };
}

async function fetchInsightVisualGuideline(
  db: Pool,
  insightsId: string
): Promise<Record<string, unknown>> {
  const r = await db.query<{ aesthetic_analysis_json: Record<string, unknown> | null }>(
    `SELECT aesthetic_analysis_json
     FROM caf_core.inputs_evidence_row_insights
     WHERE insights_id = $1
     LIMIT 1`,
    [insightsId]
  );
  const row = r.rows[0];
  if (!row?.aesthetic_analysis_json) {
    throw new Error(`No insights row for insights_id=${insightsId}`);
  }
  return row.aesthetic_analysis_json;
}

export type InsightsSlideSummary = {
  slide_index: number;
  has_document_ai: boolean;
  has_text_blocks: boolean;
  preview_text: string;
};

export async function listInsightSlidesForOverlayLab(
  db: Pool,
  insightsId: string
): Promise<InsightsSlideSummary[]> {
  const r = await db.query<{ aesthetic_analysis_json: Record<string, unknown> | null }>(
    `SELECT aesthetic_analysis_json
     FROM caf_core.inputs_evidence_row_insights
     WHERE insights_id = $1
     LIMIT 1`,
    [insightsId]
  );
  const vg = r.rows[0]?.aesthetic_analysis_json;
  if (!vg) return [];
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const out: InsightsSlideSummary[] = [];
  for (const raw of slides) {
    const slide = asRecord(raw);
    if (!slide) continue;
    const slideIndex = Number(slide.slide_index);
    if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;
    const blocks = Array.isArray(slide.text_blocks) ? slide.text_blocks : [];
    const ocr = asRecord(slide.document_ai_ocr_v1);
    const ocrLayers = Array.isArray(ocr?.text_layers) ? ocr!.text_layers : [];
    const preview = String(slide.on_screen_text_transcript ?? slide.on_image_text ?? "")
      .trim()
      .slice(0, 80);
    out.push({
      slide_index: slideIndex,
      has_document_ai: Boolean(ocr) || blocks.some((b) => asRecord(b)?.source === "document_ai"),
      has_text_blocks: blocks.length > 0 || ocrLayers.length > 0,
      preview_text: preview,
    });
  }
  return out.sort((a, b) => a.slide_index - b.slide_index);
}
