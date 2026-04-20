import { slidesFromGeneratedOutput, stripNonRenderableDeckFields } from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";

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
  if (slides.length > 0) return JSON.stringify(slides);
  if (Array.isArray(existingSlides) && existingSlides.length > 0) {
    return JSON.stringify(existingSlides);
  }
  return null;
}
