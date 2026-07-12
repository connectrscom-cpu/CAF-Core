/**
 * Per-slide visual direction contract for FLOW_VISUAL_FIRST_CAROUSEL.
 * Copy LLM authors `visual_direction`; Flux prompts consume it (project-agnostic).
 */

export const VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS = 320;
export const VISUAL_FIRST_VISUAL_METAPHOR_MAX_CHARS = 80;
export const VISUAL_FIRST_MUST_AVOID_MAX_CHARS = 140;

export type VisualFirstSlideVisualFields = {
  visual_direction: string | null;
  visual_metaphor: string | null;
  must_avoid: string | null;
};

function truncateField(text: string, maxChars: number): string {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!t || maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  if (maxChars <= 1) return t.slice(0, maxChars);
  const slice = t.slice(0, maxChars - 1).trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars * 0.55)) return `${slice.slice(0, lastSpace).trimEnd()}…`;
  return `${slice}…`;
}

function slideCopyLine(slide: Record<string, unknown>): string {
  return [String(slide.headline ?? slide.title ?? "").trim(), String(slide.body ?? slide.subtitle ?? "").trim()]
    .filter(Boolean)
    .join(" — ");
}

/** Read visual fields from a generated slide row (supports string or string[] must_avoid). */
export function extractVisualFirstSlideVisualFields(
  slide: Record<string, unknown> | null | undefined
): VisualFirstSlideVisualFields {
  if (!slide) {
    return { visual_direction: null, visual_metaphor: null, must_avoid: null };
  }

  const visual_direction = truncateField(String(slide.visual_direction ?? "").trim(), VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS);
  const visual_metaphor = truncateField(String(slide.visual_metaphor ?? "").trim(), VISUAL_FIRST_VISUAL_METAPHOR_MAX_CHARS);

  let must_avoid: string | null = null;
  const rawAvoid = slide.must_avoid;
  if (Array.isArray(rawAvoid)) {
    must_avoid = truncateField(
      rawAvoid.map((x) => String(x ?? "").trim()).filter(Boolean).join("; "),
      VISUAL_FIRST_MUST_AVOID_MAX_CHARS
    );
  } else {
    must_avoid = truncateField(String(rawAvoid ?? "").trim(), VISUAL_FIRST_MUST_AVOID_MAX_CHARS);
  }

  return {
    visual_direction: visual_direction || null,
    visual_metaphor: visual_metaphor || null,
    must_avoid: must_avoid || null,
  };
}

function synthesizeVisualDirectionFallback(
  slide: Record<string, unknown>,
  index0: number,
  total: number
): string {
  const copy = slideCopyLine(slide);
  const snippet = copy.slice(0, 140) || "the deck topic";
  if (index0 === 0) {
    return truncateField(
      `Scroll-stopping hero scene introducing the deck topic: ${snippet}. One bold focal subject, cinematic lighting — not generic stock wallpaper.`,
      VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS
    );
  }
  if (total > 1 && index0 === total - 1) {
    return truncateField(
      `Closing slide visual expressing outcome or relief tied to: ${snippet}. Warm, memorable moment — avoid unrelated props or random animals.`,
      VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS
    );
  }
  return truncateField(
    `Scene illustrating the slide argument (concept-first, not keyword literal): ${snippet}. Prefer process, contrast, or metaphor over generic lifestyle stock.`,
    VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS
  );
}

export function buildVisualFirstCarouselVisualDirectionSystemBlock(): string {
  return [
    "Per-slide visual direction (FLOW_VISUAL_FIRST_CAROUSEL — required on every slide object):",
    `- **visual_direction** (required): 2–3 sentences (~80–${VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS} chars) describing the art-only background plate Flux will render. Concrete subjects, composition, lighting, mood. Illustrate the slide *argument* (problem vs tip vs outcome) — not keyword literals.`,
    `- **visual_metaphor** (optional, max ${VISUAL_FIRST_VISUAL_METAPHOR_MAX_CHARS} chars): one phrase naming the visual idea (e.g. repetition, relief, building blocks, contrast).`,
    `- **must_avoid** (optional, max ${VISUAL_FIRST_MUST_AVOID_MAX_CHARS} chars): semicolon-separated anti-patterns for this slide (e.g. random pets; hero food glamour when slide is about burnout; generic smiling stock crowd).`,
    "- Visual direction is for the image model only — never duplicate headline/body text inside visual_direction.",
    "- **Series cohesion:** all slides share one consistent color grade, lighting family, and editorial tone; vary subject and framing, not random unrelated genres slide-to-slide.",
    "- **No random animals/pets** unless the slide copy explicitly mentions pets or animals.",
    "- Problem/pain slides: show tension or friction visually — not the aspirational opposite (e.g. burnout → sameness/repetition, not a gourmet hero plate).",
    "- How-to/tip slides: show process, hands, tools, ingredients-as-building-blocks — not unrelated decorative subjects.",
  ].join("\n");
}

/** Clamp visual fields and ensure every slide has visual_direction (synthesized fallback if missing). */
export function enforceVisualFirstCarouselVisualDirection(parsed: Record<string, unknown>): Record<string, unknown> {
  const slides = parsed.slides;
  if (!Array.isArray(slides) || slides.length === 0) return parsed;

  const outSlides = slides.map((raw, index0) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const slide = { ...(raw as Record<string, unknown>) };
    const fields = extractVisualFirstSlideVisualFields(slide);

    slide.visual_direction =
      fields.visual_direction ||
      synthesizeVisualDirectionFallback(slide, index0, slides.length);
    if (fields.visual_metaphor) slide.visual_metaphor = fields.visual_metaphor;
    else delete slide.visual_metaphor;
    if (fields.must_avoid) slide.must_avoid = fields.must_avoid;
    else delete slide.must_avoid;

    return slide;
  });

  return { ...parsed, slides: outSlides };
}
