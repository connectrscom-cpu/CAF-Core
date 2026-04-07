/**
 * Build renderer payload for carousel slides from generation_payload / generated_output.
 *
 * Priority matches Sheets "CREATION - Runtime" shape: real copy often lives in `carousel[]` or
 * `{ type, items: [{ headline, body }] }` while `slides` / `variations` are schema placeholders.
 */

import { randomInt } from "node:crypto";

const HEADLINE_KEYS = ["headline", "title", "heading", "slide_headline", "hook", "slide_hook"];
const BODY_KEYS = ["body", "text", "content", "slide_body", "caption"];

function textFromSlide(o: Record<string, unknown>): { headline: string; body: string } {
  const headline = HEADLINE_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
  const body = BODY_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
  return { headline: String(headline ?? "").trim(), body: String(body ?? "").trim() };
}

/** True if this slide would show meaningful text in the renderer (not just slide_role). */
export function slideHasRenderableContent(s: Record<string, unknown>): boolean {
  const { headline, body } = textFromSlide(s);
  return headline.length > 0 || body.length > 0;
}

function normalizeItemSlide(r: Record<string, unknown>): Record<string, unknown> {
  const headline = String(
    r.headline ?? r.title ?? r.heading ?? r.hook ?? r.slide_hook ?? ""
  ).trim();
  const body = String(r.body ?? r.text ?? r.content ?? r.caption ?? "").trim();
  return {
    ...r,
    ...(headline ? { headline } : {}),
    ...(body ? { body } : {}),
    slide_role: r.slide_role ?? "body",
  };
}

/** Parse Google-Sheets-style carousel: array of slides, or stringified JSON, or `{ items: [...] }`. */
function slidesFromCarouselField(carouselVal: unknown): Record<string, unknown>[] {
  if (carouselVal == null) return [];

  if (Array.isArray(carouselVal)) {
    return carouselVal
      .filter((x) => x && typeof x === "object" && !Array.isArray(x))
      .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  }

  let obj: Record<string, unknown> | null = null;
  if (typeof carouselVal === "string") {
    const t = carouselVal.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return [];
    try {
      const p = JSON.parse(carouselVal) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
      else if (Array.isArray(p)) {
        return p
          .filter((x) => x && typeof x === "object")
          .map((x) => normalizeItemSlide(x as Record<string, unknown>));
      }
    } catch {
      return [];
    }
  } else if (typeof carouselVal === "object" && !Array.isArray(carouselVal)) {
    obj = carouselVal as Record<string, unknown>;
  }

  if (!obj) return [];
  const items = obj.items;
  if (Array.isArray(items)) {
    return items
      .filter((x) => x && typeof x === "object")
      .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  }
  return [];
}

function topLevelItemsSlideArray(gen: Record<string, unknown>): Record<string, unknown>[] {
  const items = gen.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
}

/** Keep slide rows only if at least one has headline or body (skip LLM placeholder shells). */
function usableSlideArray(arr: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = arr.filter(
    (s) =>
      s &&
      typeof s === "object" &&
      !Array.isArray(s) &&
      slideHasRenderableContent(s as Record<string, unknown>)
  ) as Record<string, unknown>[];
  return out.length > 0 ? out : null;
}

function legacyCoverBodyCtaSlides(gen: Record<string, unknown>): Record<string, unknown>[] {
  const slides: Record<string, unknown>[] = [];

  const coverSlide = (gen.cover_slide ?? {}) as Record<string, unknown>;
  const coverHeadline =
    String(gen.cover ?? gen.intro_title ?? coverSlide.headline ?? coverSlide.title ?? coverSlide.heading ?? "").trim();
  const coverBody =
    String(gen.cover_subtitle ?? coverSlide.body ?? coverSlide.text ?? coverSlide.content ?? "").trim();
  slides.push({ headline: coverHeadline, body: coverBody, slide_role: "cover" });

  const bodySlides = gen.body_slides;
  if (Array.isArray(bodySlides)) {
    for (const s of bodySlides) {
      if (s && typeof s === "object") slides.push({ ...(s as Record<string, unknown>), slide_role: "body" });
    }
  }

  const cta = (gen.cta_slide ?? {}) as Record<string, unknown>;
  if (Object.keys(cta).length > 0 || gen.cta_text || gen.cta_handle) {
    slides.push({
      headline: String(gen.cta_text ?? cta.headline ?? "").trim(),
      body: String(gen.cta_handle ?? cta.body ?? "").trim(),
      slide_role: "cta",
    });
  }

  return slides;
}

/**
 * Normalize generated carousel JSON into an ordered list of slide records for Handlebars.
 * Order: `items` → non-empty `slides` / `variations` → `carousel` / stringified `{ items }` (Runtime sheet)
 * → legacy cover/body/cta. Skips placeholder slides that only set slide_role with blank headline/body.
 */
export function slidesFromGeneratedOutput(gen: Record<string, unknown>): Record<string, unknown>[] {
  const fromTopItems = topLevelItemsSlideArray(gen);
  if (fromTopItems.length > 0 && fromTopItems.some(slideHasRenderableContent)) {
    return fromTopItems;
  }

  const fromSlides = usableSlideArray(gen.slides);
  if (fromSlides) return fromSlides;

  const fromVariations = usableSlideArray(gen.variations);
  if (fromVariations) return fromVariations;

  const fromCarousel = slidesFromCarouselField(gen.carousel);
  if (fromCarousel.length > 0 && fromCarousel.some(slideHasRenderableContent)) {
    return fromCarousel;
  }

  return legacyCoverBodyCtaSlides(gen);
}

export function carouselSlideCount(gen: Record<string, unknown>): number {
  const n = slidesFromGeneratedOutput(gen).length;
  if (n > 0) return n;
  const sc = Number(gen.slide_count);
  if (Number.isFinite(sc) && sc >= 1) return Math.min(20, Math.floor(sc));
  return 1;
}

/**
 * Merge base render context with one slide highlighted for multi-slide templates.
 */
export function buildSlideRenderContext(
  base: Record<string, unknown>,
  allSlides: Record<string, unknown>[],
  slideIndex1Based: number
): Record<string, unknown> {
  const idx = Math.max(0, Math.min(allSlides.length - 1, slideIndex1Based - 1));
  const current = allSlides[idx] ?? {};
  const { headline, body } = textFromSlide(current);
  return {
    ...base,
    slides: allSlides,
    slide_index: slideIndex1Based,
    current_slide: current,
    headline,
    body,
    handle: String(current.handle ?? current.cta_handle ?? ""),
  };
}

export function templateNameFromPayload(generationPayload: Record<string, unknown>): string {
  const gen = (generationPayload.generated_output as Record<string, unknown>) ?? {};
  const render = (gen.render as Record<string, unknown>) ?? (generationPayload.render as Record<string, unknown>) ?? {};
  return String(
    render.html_template_name ?? render.template_key ?? generationPayload.template ?? "default"
  );
}

/**
 * Non-empty template name from payload when the author explicitly chose something other than the generic default.
 * (Renderer accepts names with or without `.hbs`.)
 */
export function explicitCarouselTemplateBaseName(generationPayload: Record<string, unknown>): string | null {
  const raw = templateNameFromPayload(generationPayload).trim();
  if (!raw) return null;
  const base = raw.replace(/\.hbs$/i, "").trim();
  if (!base || base.toLowerCase() === "default") return null;
  return base;
}

/**
 * Use the payload template when set; otherwise `GET {renderer}/templates` and pick uniformly at random
 * from available `.hbs` options (local templates folder + optional remote list from the renderer).
 */
export async function pickCarouselTemplateForRender(
  rendererBaseUrl: string,
  generationPayload: Record<string, unknown>
): Promise<string> {
  const explicit = explicitCarouselTemplateBaseName(generationPayload);
  if (explicit) return explicit;

  const base = rendererBaseUrl.replace(/\/$/, "");
  let templates: string[] = [];
  try {
    const res = await fetch(`${base}/templates`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const d = (await res.json()) as { templates?: string[] };
      templates = (d.templates ?? []).filter((t) => typeof t === "string" && t.endsWith(".hbs"));
    }
  } catch {
    // fall through to default
  }

  if (templates.length === 0) return "default";

  const pick = templates[randomInt(templates.length)]!;
  return pick.replace(/\.hbs$/i, "");
}
