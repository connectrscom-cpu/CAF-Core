/**
 * Applies human review "final_*" overrides from `editorial_reviews.overrides_json`
 * onto `generated_output` for OVERRIDE_ONLY rework (no LLM).
 * Matches common carousel shapes used by the review UI / roughSlidesJsonFromGenerationPayload.
 */

import {
  extractCarouselSlidesAndTypographyFromOverrideJson,
  mergeCarouselTypographyDefaultsFromPlatformConstraints,
  mergeCarouselTypographyIntoGeneratedOutputRender,
  pickCarouselTypographyPatch,
} from "../domain/carousel-render-typography.js";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseSlidesArray(slidesJson: string): unknown[] | null {
  const t = slidesJson.trim();
  if (!t) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    const o = asRec(parsed);
    if (o && Array.isArray(o.slides)) return o.slides;
  } catch {
    return null;
  }
  return null;
}

export function replaceSlidesInGeneratedOutput(
  generatedOutput: Record<string, unknown>,
  slides: Record<string, unknown>[]
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(generatedOutput)) as Record<string, unknown>;
  if (!setSlidesIfPresent(out, slides) && !Array.isArray(out.slides)) out.slides = slides;
  return out;
}

function setSlidesIfPresent(gen: Record<string, unknown>, slides: unknown[]): boolean {
  const tryDeck = asRec(gen.slide_deck);
  if (tryDeck) {
    tryDeck.slides = slides;
    return true;
  }
  const variation = asRec(gen.variation);
  if (variation) {
    variation.slides = slides;
    return true;
  }
  if (Array.isArray(gen.slides)) {
    gen.slides = slides;
    return true;
  }
  const car = gen.carousel;
  if (Array.isArray(car)) {
    gen.carousel = slides;
    return true;
  }
  const carRec = asRec(car);
  if (carRec) {
    carRec.slides = slides;
    return true;
  }
  const content = asRec(gen.content);
  if (content) {
    content.slides = slides;
    return true;
  }
  const vc = asRec(gen.variation_content);
  if (vc) {
    if (Array.isArray(vc.carousel)) {
      vc.carousel = slides;
      return true;
    }
    if (Array.isArray(vc.slides)) {
      vc.slides = slides;
      return true;
    }
    const vcar = asRec(vc.carousel);
    if (vcar) {
      vcar.slides = slides;
      return true;
    }
  }
  return false;
}

function setCaptionLike(gen: Record<string, unknown>, caption: string): void {
  if (typeof gen.caption === "string" || gen.caption == null) gen.caption = caption;
  const car = asRec(gen.carousel);
  if (car) {
    if (typeof car.caption === "string" || car.caption == null) car.caption = caption;
    if (typeof car.post_caption === "string" || car.post_caption == null) car.post_caption = caption;
  }
  const pub = asRec(gen.publish);
  if (pub && (typeof pub.caption === "string" || pub.caption == null)) pub.caption = caption;
}

export function applyEditorialFlatOverridesToGeneratedOutput(
  generatedOutput: Record<string, unknown>,
  overrides: Record<string, unknown>,
  /** Merged `platform_constraints` slice (e.g. from `resolvePlatformConstraintsForPack`) for carousel typography defaults. */
  platformConstraints?: unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...generatedOutput };
  mergeCarouselTypographyDefaultsFromPlatformConstraints(out, platformConstraints);
  const title = typeof overrides.final_title_override === "string" ? overrides.final_title_override.trim() : "";
  const hook = typeof overrides.final_hook_override === "string" ? overrides.final_hook_override.trim() : "";
  const caption = typeof overrides.final_caption_override === "string" ? overrides.final_caption_override.trim() : "";
  const hashtags = typeof overrides.final_hashtags_override === "string" ? overrides.final_hashtags_override.trim() : "";
  const slidesRaw = typeof overrides.final_slides_json_override === "string" ? overrides.final_slides_json_override : "";

  if (title) {
    if (typeof out.title === "string" || out.title == null) out.title = title;
    if (typeof out.generated_title === "string" || out.generated_title == null) out.generated_title = title;
  }
  if (hook) {
    if (typeof out.hook === "string" || out.hook == null) out.hook = hook;
    if (typeof out.generated_hook === "string" || out.generated_hook == null) out.generated_hook = hook;
  }
  if (caption) setCaptionLike(out, caption);
  if (hashtags) {
    if (typeof out.hashtags === "string" || out.hashtags == null) out.hashtags = hashtags;
    const car = asRec(out.carousel);
    if (car && (typeof car.hashtags === "string" || car.hashtags == null)) car.hashtags = hashtags;
  }
  const spoken =
    typeof overrides.final_spoken_script_override === "string" ? overrides.final_spoken_script_override.trim() : "";
  if (spoken) {
    if (typeof out.spoken_script === "string" || out.spoken_script == null) out.spoken_script = spoken;
    if (typeof out.script === "string" || out.script == null) out.script = spoken;
  }
  const { slides: slidesFromObject, renderPatch } = extractCarouselSlidesAndTypographyFromOverrideJson(slidesRaw);
  const slides = slidesFromObject ?? parseSlidesArray(slidesRaw);
  if (slides && slides.length > 0) {
    if (!setSlidesIfPresent(out, slides) && !out.slides) out.slides = slides;
  }
  mergeCarouselTypographyIntoGeneratedOutputRender(out, renderPatch);
  return out;
}

/**
 * True when NEEDS_EDIT `final_slides_json_override` includes font px and/or `font_scale` (visual re-render, not just copy).
 * Used to run carousel PNGs after OVERRIDE_ONLY so typography edits are not left on stale images.
 */
export function editorialOverrideRequestsCarouselRerender(overrides: Record<string, unknown> | null | undefined): boolean {
  if (!overrides || typeof overrides !== "object") return false;
  const raw = overrides.final_slides_json_override;
  if (raw == null) return false;
  if (typeof raw === "string") {
    const { renderPatch } = extractCarouselSlidesAndTypographyFromOverrideJson(raw);
    return Object.keys(renderPatch).length > 0;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const patch = pickCarouselTypographyPatch(o);
    if (Object.keys(patch).length > 0) return true;
    const fs = o.font_scale;
    if (fs === undefined || fs === null) return false;
    const n = typeof fs === "number" ? fs : Number(String(fs).trim());
    return Number.isFinite(n) && n > 0;
  }
  return false;
}

export function hasEditorialCopyFlatOverrides(overrides: Record<string, unknown> | null | undefined): boolean {
  if (!overrides || typeof overrides !== "object") return false;
  const keys = [
    "final_title_override",
    "final_hook_override",
    "final_caption_override",
    "final_hashtags_override",
    "final_slides_json_override",
    "final_spoken_script_override",
  ] as const;
  for (const k of keys) {
    const v = overrides[k];
    if (typeof v === "string" && v.trim() !== "") {
      if (k === "final_slides_json_override") {
        const { slides, renderPatch } = extractCarouselSlidesAndTypographyFromOverrideJson(v);
        if (Object.keys(renderPatch).length > 0) return true;
        if (slides && slides.length > 0) return true;
        continue;
      }
      return true;
    }
  }
  return false;
}

const EDITORIAL_FLAT_KEYS = [
  "final_title_override",
  "final_hook_override",
  "final_caption_override",
  "final_hashtags_override",
  "final_slides_json_override",
  "final_spoken_script_override",
  "rewrite_copy",
] as const;

/** Not merged into `generated_output`; handled by HeyGen rework merge + orchestrator. */
const HEYGEN_REVIEW_META_KEYS = new Set(["heygen_avatar_id", "heygen_voice_id", "heygen_force_rerender"]);

/** Keys safe to shallow-merge into `generated_output` vs human flat copy fields. */
export function partitionEditorialOverrides(overrides: Record<string, unknown>): {
  structural: Record<string, unknown>;
  flat: Record<string, unknown>;
} {
  const structural: Record<string, unknown> = {};
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (HEYGEN_REVIEW_META_KEYS.has(k)) continue;
    if ((EDITORIAL_FLAT_KEYS as readonly string[]).includes(k)) flat[k] = v;
    else structural[k] = v;
  }
  return { structural, flat };
}
