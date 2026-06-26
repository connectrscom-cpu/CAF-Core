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
import { templateBgLlmSlideForDocAi } from "../domain/mimic-template-bg-copy.js";import { deckUsesUnifiedBackgroundPlate } from "../domain/mimic-text-heavy.js";

export { templateBgLlmSlideForDocAi } from "../domain/mimic-template-bg-copy.js";

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
