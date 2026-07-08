import type { NormalizedSlide } from "@/lib/carousel-slides";
import { templateBgLlmSlideForDocAi } from "@/lib/mimic-template-bg";

export type MimicReprintSlideCopyOverride = {
  slide_index: number;
  llm_slide: Record<string, unknown>;
};

/** Build per-slide copy patches for text-overlay reprint from the review editor state. */
export function buildMimicReprintSlideCopyOverrides(
  slides: NormalizedSlide[],
  templateBgMode: boolean,
  slideIndices?: number[]
): MimicReprintSlideCopyOverride[] {
  if (slides.length === 0) return [];
  const targets =
    slideIndices && slideIndices.length > 0
      ? new Set(slideIndices.map((n) => Math.floor(n)).filter((n) => n >= 1))
      : null;
  const total = slides.length;
  const out: MimicReprintSlideCopyOverride[] = [];

  for (let i = 0; i < total; i++) {
    const slideIndex = i + 1;
    if (targets && !targets.has(slideIndex)) continue;
    const slide = slides[i];
    if (!slide) continue;

    const raw: Record<string, unknown> = {
      headline: slide.headline,
      body: slide.body,
      handle: slide.handle,
      ...(slide.text_blocks?.length ? { text_blocks: slide.text_blocks } : {}),
      ...(slide.on_slide_lines?.length ? { on_slide_lines: slide.on_slide_lines } : {}),
      ...(slide.extras ?? {}),
    };

    out.push({
      slide_index: slideIndex,
      llm_slide: templateBgMode
        ? templateBgLlmSlideForDocAi(slideIndex, total, raw)
        : {
            headline: slide.headline,
            body: slide.body,
            ...(slide.text_blocks?.length ? { text_blocks: slide.text_blocks } : {}),
            ...(slide.on_slide_lines?.length ? { on_slide_lines: slide.on_slide_lines } : {}),
          },
    });
  }

  return out;
}
