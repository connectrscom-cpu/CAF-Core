/**
 * Mobile carousel copy ceilings for FLOW_VISUAL_FIRST_CAROUSEL (brand-style lane).
 * Applied in addition to mimic reference budgets — never allows paragraph-length body copy.
 */
import {
  buildVisualFirstCarouselVisualDirectionSystemBlock,
  enforceVisualFirstCarouselVisualDirection,
} from "./visual-first-carousel-visual-direction.js";

export const VISUAL_FIRST_HEADLINE_MAX_CHARS = 55;
export const VISUAL_FIRST_BODY_MAX_CHARS = 100;
export const VISUAL_FIRST_CTA_MAX_CHARS = 72;
export const VISUAL_FIRST_INTRO_BODY_MAX_CHARS = 85;

function truncateCopy(text: string, maxChars: number): string {
  const t = String(text ?? "").trim();
  if (!t || maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  if (maxChars <= 1) return t.slice(0, maxChars);
  const slice = t.slice(0, maxChars - 1).trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars * 0.55)) return `${slice.slice(0, lastSpace).trimEnd()}…`;
  return `${slice}…`;
}

function asRec(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function slideRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (Array.isArray(slides)) {
    return slides.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s));
  }
  return [];
}

function isCtaSlide(index0: number, total: number): boolean {
  return total > 1 && index0 === total - 1;
}

function headlineMaxForSlide(index0: number, total: number): number {
  if (index0 === 0) return VISUAL_FIRST_HEADLINE_MAX_CHARS;
  if (isCtaSlide(index0, total)) return 48;
  return 44;
}

function bodyMaxForSlide(index0: number, total: number): number {
  if (index0 === 0) return VISUAL_FIRST_INTRO_BODY_MAX_CHARS;
  if (isCtaSlide(index0, total)) return VISUAL_FIRST_CTA_MAX_CHARS;
  return VISUAL_FIRST_BODY_MAX_CHARS;
}

function clampField(text: unknown, max: number): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return truncateCopy(t.replace(/\s+/g, " "), max);
}

function clampSlideCopy(slide: Record<string, unknown>, index0: number, total: number): Record<string, unknown> {
  const next = { ...slide };
  const hMax = headlineMaxForSlide(index0, total);
  const bMax = bodyMaxForSlide(index0, total);

  for (const key of ["headline", "title", "kicker", "panel_title"] as const) {
    if (next[key] != null) next[key] = clampField(next[key], hMax);
  }
  for (const key of ["body", "subtitle", "panel_body"] as const) {
    if (next[key] != null) next[key] = clampField(next[key], bMax);
  }
  if (isCtaSlide(index0, total)) {
    const cta = clampField(next.cta ?? next.body ?? next.headline, VISUAL_FIRST_CTA_MAX_CHARS);
    if (cta) next.cta = cta;
  }

  const blocks = next.text_blocks;
  if (Array.isArray(blocks)) {
    next.text_blocks = blocks.map((raw, bi) => {
      const rec = asRec(raw);
      if (!rec) return raw;
      const role = String(rec.role ?? "").toLowerCase();
      const max =
        role.includes("headline") || role.includes("title") || role.includes("kicker")
          ? hMax
          : role.includes("cta") || isCtaSlide(index0, total)
            ? VISUAL_FIRST_CTA_MAX_CHARS
            : bMax;
      return { ...rec, text: clampField(rec.text, max) };
    });
  }

  return next;
}

export function buildVisualFirstCarouselCopySystemBlock(slideCount: number): string {
  const n = Math.max(1, slideCount);
  return [
    "Brand-style carousel copy contract (FLOW_VISUAL_FIRST_CAROUSEL — required):",
    "- **One idea per slide.** No paragraphs, no multi-sentence essays, no list dumps on a single slide.",
    `- **Headline:** max ${VISUAL_FIRST_HEADLINE_MAX_CHARS} chars (intro/cover may use full budget; inner slides shorter).`,
    `- **Body:** max ${VISUAL_FIRST_BODY_MAX_CHARS} chars per slide (intro max ${VISUAL_FIRST_INTRO_BODY_MAX_CHARS}). Use short phrases or a single crisp sentence.`,
    `- **Final slide (slide ${n}):** mandatory CTA with imperative verb (Follow, Save, Shop, Discover) + brand/site/handle when known. Max ${VISUAL_FIRST_CTA_MAX_CHARS} chars.`,
    "- **Layout fit:** Copy must fit mobile safe zones without overlap — prefer fewer words over smaller type.",
    "- **Differentiation:** Vary hook angle per slide; zodiac/sign slides should name the sign in the headline, not bury it in body copy.",
    "",
    buildVisualFirstCarouselVisualDirectionSystemBlock(),
  ].join("\n");
}

/** Hard post-LLM clamp for visual-first carousel decks. */
export function enforceVisualFirstCarouselCopyBudget(parsed: Record<string, unknown>): Record<string, unknown> {
  const slides = slideRows(parsed);
  if (slides.length === 0) return parsed;

  const outSlides = slides.map((slide, i) => clampSlideCopy(slide, i, slides.length));
  const last = outSlides[outSlides.length - 1]!;
  if (!String(last.cta ?? "").trim()) {
    const fallback = String(last.body ?? last.headline ?? "").trim();
    if (fallback) last.cta = clampField(fallback, VISUAL_FIRST_CTA_MAX_CHARS);
  }

  return enforceVisualFirstCarouselVisualDirection({ ...parsed, slides: outSlides });
}
