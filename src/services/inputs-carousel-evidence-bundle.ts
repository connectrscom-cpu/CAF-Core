/**
 * Carousel deep analysis: **multiple slide image URLs** from `payload_json` (no raw bundle upload).
 * Typical keys: `carousel_slide_urls`, `sidecar_image_urls`, `carousel_media_urls`.
 */

function parseUrlArray(raw: unknown, maxSlides: number): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).trim())
      .filter((u) => /^https:\/\//i.test(u))
      .slice(0, maxSlides);
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const a = JSON.parse(raw) as unknown;
      return parseUrlArray(a, maxSlides);
    } catch {
      return [];
    }
  }
  return [];
}

const CAROUSEL_URL_KEYS = [
  "carousel_slide_urls",
  "carousel_media_urls",
  "sidecar_image_urls",
  "sidecar_urls",
  "child_image_urls",
  "carousel_image_urls",
] as const;

/**
 * Ordered HTTPS image URLs for one carousel / sidecar post.
 */
export function parseCarouselSlideUrls(payload: Record<string, unknown>, maxSlides = 12): string[] {
  for (const k of CAROUSEL_URL_KEYS) {
    const arr = parseUrlArray(payload[k], maxSlides);
    if (arr.length > 0) return arr;
  }
  return [];
}

/** Minimum slides to treat as carousel deck (not single-image deep). */
export const MIN_CAROUSEL_SLIDES_FOR_DEEP = 2;

export function isCarouselDeepEligible(payload: Record<string, unknown>, maxSlides = 12): boolean {
  return parseCarouselSlideUrls(payload, maxSlides).length >= MIN_CAROUSEL_SLIDES_FOR_DEEP;
}

export function parseCarouselCaptionContext(payload: Record<string, unknown>, maxChars = 6000): string {
  const parts: string[] = [];
  for (const k of ["caption", "Caption", "body_text", "main_text", "accessibility_caption"]) {
    const v = payload[k];
    if (v != null && String(v).trim()) parts.push(String(v).trim());
  }
  const t = parts.join("\n\n");
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}
