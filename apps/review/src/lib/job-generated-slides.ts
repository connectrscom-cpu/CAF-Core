import type { ReviewJobDetail } from "@/lib/caf-core-client";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Single-slide preview for video-script JSON (hook_line / cta / on-screen) when no carousel deck exists. */
function videoScriptCoverJsonFromGeneratedOutput(go: Record<string, unknown>): string {
  const hook = str(go.hook_line) || str(go.hook);
  const bodyParts: string[] = [];
  const cta = str(go.cta_line) || str(go.cta);
  if (cta) bodyParts.push(cta);
  const ost = Array.isArray(go.on_screen_text)
    ? go.on_screen_text.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];
  if (ost.length) bodyParts.push(ost.join("\n"));
  const disc = str(go.disclaimer_line);
  if (disc) bodyParts.push(disc);
  const cap = str(go.caption) || str(go.post_caption);
  const body = cap || bodyParts.join("\n\n");
  if (!hook && !body) return "";
  return JSON.stringify({
    cover_slide: { headline: hook || "—", body: body || "—" },
    cover: hook || undefined,
    cover_subtitle: body || undefined,
  });
}

/**
 * When Core `review_slides_json` is missing (or the workbench fell back to a queue row), derive a slide
 * list from `candidate_data` + `generated_output` — same nesting as Flow_Carousel_Copy / carousel-render-pack
 * (slide_deck, variation, carousel, content.slides, etc.).
 */
export function roughSlidesJsonFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return "";
  const merged = {
    ...(asRec(payload.candidate_data) ?? {}),
    ...(asRec(payload.generated_output) ?? {}),
  };
  const tryDeck = asRec(merged.slide_deck);
  if (tryDeck && Array.isArray(tryDeck.slides) && tryDeck.slides.length > 0) {
    return JSON.stringify(tryDeck.slides);
  }
  const variation = asRec(merged.variation);
  if (variation && Array.isArray(variation.slides) && variation.slides.length > 0) {
    return JSON.stringify(variation.slides);
  }
  if (Array.isArray(merged.slides) && merged.slides.length > 0) {
    return JSON.stringify(merged.slides);
  }
  const car = merged.carousel;
  if (Array.isArray(car) && car.length > 0) return JSON.stringify(car);
  const carRec = asRec(car);
  if (carRec && Array.isArray(carRec.slides) && carRec.slides.length > 0) {
    return JSON.stringify(carRec.slides);
  }
  const content = asRec(merged.content);
  if (content && Array.isArray(content.slides) && content.slides.length > 0) {
    return JSON.stringify(content.slides);
  }
  const vc = asRec(merged.variation_content);
  if (vc) {
    const vcCar = vc.carousel;
    if (Array.isArray(vcCar) && vcCar.length > 0) return JSON.stringify(vcCar);
    const vcSlides = vc.slides;
    if (Array.isArray(vcSlides) && vcSlides.length > 0) return JSON.stringify(vcSlides);
  }
  const topSlides = payload.slides;
  if (Array.isArray(topSlides) && topSlides.length > 0) return JSON.stringify(topSlides);

  const vs = videoScriptCoverJsonFromGeneratedOutput(merged);
  if (vs) return vs;
  return "";
}

/** Prefer server-computed flat slides; fall back to legacy `generation_payload.slides` and carousel shapes. */
export function jobGeneratedSlidesJson(job: ReviewJobDetail): string {
  const fromReview = (job.review_slides_json ?? "").trim();
  if (fromReview) return fromReview;
  const sl = job.generation_payload?.slides;
  if (sl != null && typeof sl === "object") return JSON.stringify(sl);
  const rough = roughSlidesJsonFromGenerationPayload(job.generation_payload as Record<string, unknown>);
  if (rough) return rough;
  return "";
}
