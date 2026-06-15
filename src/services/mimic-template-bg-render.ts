/**
 * Template_bg render helpers (job-pipeline only).
 * Kept separate from mimic-slide-typography to avoid Review webpack importing mimic-template-library
 * (cycle: mimic-slide-typography → mimic-template-library → mimic-text-heavy → mimic-slide-typography).
 */
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  pickMimicEvaluationFromEntry,
  referenceIndexForTemplateSlot,
  templateBgSlotForIndex,
} from "../domain/mimic-template-library.js";
import { deckUsesUnifiedBackgroundPlate } from "../domain/mimic-text-heavy.js";

function mimicGuidelineEntry(mimic: Pick<MimicPayloadV1, "visual_guideline">): Record<string, unknown> {
  const vg = mimic.visual_guideline ?? {};
  return { ...vg, aesthetic_analysis_json: vg };
}

function templateBgUsesSlotGeometry(mimic: Pick<MimicPayloadV1, "mode" | "visual_guideline">): boolean {
  if (mimic.mode !== "template_bg") return false;
  const entry = mimicGuidelineEntry(mimic);
  const mimicEval = pickMimicEvaluationFromEntry(entry);
  const isUniform = String(mimicEval?.template_consistency ?? "").toLowerCase() === "uniform";
  return isUniform || deckUsesUnifiedBackgroundPlate(entry);
}

/** Map template_bg output slide → archived reference slide index for OCR geometry (cover/body/cta). */
export function templateBgGuidelineSlideIndex(
  mimic: Pick<MimicPayloadV1, "mode" | "visual_guideline" | "reference_items">,
  outputSlideIndex1Based: number,
  totalSlides: number
): number | null {
  if (!templateBgUsesSlotGeometry(mimic) || totalSlides < 1) return null;
  const entry = mimicGuidelineEntry(mimic);
  const slot = templateBgSlotForIndex(outputSlideIndex1Based, totalSlides);
  return referenceIndexForTemplateSlot(
    entry,
    slot,
    Math.max(mimic.reference_items?.length ?? 0, totalSlides, 1)
  );
}

/**
 * LLM slide row scoped to cover / body / CTA slot for template_bg DocAI text mapping.
 */
export function templateBgLlmSlideForDocAi(
  slideIndex1Based: number,
  totalSlides: number,
  rawLlmSlide: Record<string, unknown>
): Record<string, unknown> {
  const slot = templateBgSlotForIndex(slideIndex1Based, totalSlides);
  const headline = String(rawLlmSlide.headline ?? rawLlmSlide.title ?? "").trim();
  const body = String(rawLlmSlide.body ?? "").trim();
  const subtitle = String(
    rawLlmSlide.subtitle ?? rawLlmSlide.cover_subtitle ?? rawLlmSlide.kicker ?? ""
  ).trim();
  const cta = String(rawLlmSlide.cta ?? rawLlmSlide.cta_text ?? "").trim();
  const handle = String(rawLlmSlide.handle ?? rawLlmSlide.cta_handle ?? "").trim();

  if (slot === "cover") {
    return {
      ...rawLlmSlide,
      headline,
      title: headline,
      body: subtitle || (body && headline ? "" : body),
      cover_subtitle: subtitle || body,
      subtitle: subtitle || body,
    };
  }
  if (slot === "cta") {
    const ctaHeadline = cta || headline;
    const ctaBody = handle || body || subtitle;
    return {
      ...rawLlmSlide,
      headline: ctaHeadline,
      body: ctaBody,
      cta: ctaHeadline,
      cta_text: ctaHeadline,
      handle: ctaBody,
      cta_handle: ctaBody,
    };
  }
  return {
    ...rawLlmSlide,
    headline,
    body: body || subtitle,
  };
}
