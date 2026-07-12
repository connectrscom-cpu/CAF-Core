import {
  isMimicFullBleedCarouselRenderBase,
  slidesFromGeneratedOutput,
  splitFlatSlidesToTemplateShape,
  stripNonRenderableDeckFields,
  slideHasRenderableContent,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { isCarouselFlow } from "../decision_engine/flow-kind.js";
import { isTpGroundedCarouselRenderFlow } from "../domain/top-performer-mimic-flow-types.js";
import { isCarouselMimicOverlayRenderJob } from "../domain/bvs-text-carousel-flow.js";

/**
 * Flat slide list for the human review UI — same merge/normalize path as carousel rendering
 * so copy in `generated_output` / `candidate_data` shows up even when `generation_payload.slides` is empty.
 */
export function slidesJsonForReviewUi(
  flowType: string | null | undefined,
  generationPayload: Record<string, unknown> | null | undefined
): string | null {
  if (!generationPayload || typeof generationPayload !== "object") return null;

  const existingSlides = generationPayload.slides;
  const gen = pickGeneratedOutputOrEmpty(generationPayload);
  const candidate = (generationPayload.candidate_data as Record<string, unknown>) ?? {};
  const renderCoerced =
    typeof gen.render === "object" && gen.render && !Array.isArray(gen.render)
      ? (gen.render as Record<string, unknown>)
      : {};
  let baseRender: Record<string, unknown> = {
    ...candidate,
    ...gen,
    ...renderCoerced,
  };
  baseRender = stripNonRenderableDeckFields(baseRender);
  baseRender = normalizeLlmParsedForSchemaValidation(flowType ?? "", baseRender);
  const slides = slidesFromGeneratedOutput(baseRender);
  const renderableSlides = slides.filter((s) =>
    slideHasRenderableContent(s as Record<string, unknown>)
  );
  const deckSlides = renderableSlides.length > 0 ? renderableSlides : slides;
  if (deckSlides.length > 0) {
    // Ensure microcopy slots (panel_title/panel_body/etc.) are visible + editable in Review UI by
    // materializing the template shape (same defaults renderer uses) and flattening back to slides[].
    if (isCarouselFlow(flowType ?? "")) {
      const shaped = splitFlatSlidesToTemplateShape(deckSlides, {
        skipPanelDefaults:
          isCarouselMimicOverlayRenderJob(flowType ?? "", generationPayload) ||
          isMimicFullBleedCarouselRenderBase(generationPayload),
      });
      const flat = [shaped.cover_slide, ...shaped.body_slides, shaped.cta_slide].filter(
        (s) => s && typeof s === "object" && slideHasRenderableContent(s as Record<string, unknown>)
      );
      return JSON.stringify(flat);
    }
    return JSON.stringify(deckSlides);
  }
  if (Array.isArray(existingSlides) && existingSlides.length > 0) {
    return JSON.stringify(existingSlides);
  }
  return null;
}
