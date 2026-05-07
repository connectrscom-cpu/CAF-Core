/**
 * Carousel render typography: reviewer-tunable pixel sizes merged into `generated_output.render`
 * and exposed on the Handlebars context. Templates use CSS variables:
 *   --caf-carousel-headline-size
 *   --caf-carousel-body-size
 *   --caf-carousel-kicker-size
 *   --caf-carousel-cta-size
 *   --caf-carousel-handle-size
 * Renderer prepends a :root override block when these appear on the context.
 */

export const CAROUSEL_TYPOGRAPHY_CSS_VARS: Record<string, string> = {
  carousel_headline_font_px: "--caf-carousel-headline-size",
  carousel_body_font_px: "--caf-carousel-body-size",
  carousel_kicker_font_px: "--caf-carousel-kicker-size",
  carousel_cta_font_px: "--caf-carousel-cta-size",
  carousel_handle_font_px: "--caf-carousel-handle-size",
};

function normalizePositivePx(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(String(raw).trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 512) return null;
  return Math.round(n);
}

/** Pull typography patch from a flat object (e.g. parsed `final_slides_json_override` or `render`). */
export function pickCarouselTypographyPatch(source: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!source || typeof source !== "object") return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(CAROUSEL_TYPOGRAPHY_CSS_VARS) as Array<keyof typeof CAROUSEL_TYPOGRAPHY_CSS_VARS>) {
    const px = normalizePositivePx(source[k]);
    if (px != null) out[k] = px;
  }
  return out;
}

/**
 * Parse `final_slides_json_override` string: extract `slides` array (if any) and typography keys
 * from the top-level object.
 */
export function extractCarouselSlidesAndTypographyFromOverrideJson(slidesRaw: string): {
  slides: unknown[] | null;
  renderPatch: Record<string, number>;
} {
  const t = slidesRaw.trim();
  if (!t) return { slides: null, renderPatch: {} };
  try {
    const parsed: unknown = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return { slides: parsed, renderPatch: {} };
    }
    const o = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    if (!o) return { slides: null, renderPatch: {} };
    const renderPatch = pickCarouselTypographyPatch(o);
    const fs = o.font_scale;
    if (fs !== undefined && fs !== null) {
      const n = typeof fs === "number" ? fs : Number(String(fs).trim());
      if (Number.isFinite(n) && n > 0) renderPatch.font_scale = Math.min(1.25, Math.max(0.75, n));
    }
    const slides = Array.isArray(o.slides) ? (o.slides as unknown[]) : null;
    return { slides, renderPatch };
  } catch {
    return { slides: null, renderPatch: {} };
  }
}

/** Merge typography (and optional numeric `font_scale`) onto `generated_output.render`. */
export function mergeCarouselTypographyIntoGeneratedOutputRender(
  generatedOutput: Record<string, unknown>,
  patch: Record<string, number>
): void {
  if (Object.keys(patch).length === 0) return;
  const existing =
    generatedOutput.render && typeof generatedOutput.render === "object" && !Array.isArray(generatedOutput.render)
      ? { ...(generatedOutput.render as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    (existing as Record<string, unknown>)[k] = v;
  }
  generatedOutput.render = existing;
}

/** After LLM carousel generation, re-apply reviewer typography from NEEDS_EDIT payload. */
export function mergeCarouselTypographyFromHumanFeedback(
  generatedOutput: Record<string, unknown>,
  generationPayload: Record<string, unknown>
): void {
  const hf = generationPayload.human_feedback as { editorial_overrides_json?: Record<string, unknown> } | undefined;
  const raw = hf?.editorial_overrides_json?.final_slides_json_override;
  if (typeof raw !== "string" || !raw.trim()) return;
  const { renderPatch } = extractCarouselSlidesAndTypographyFromOverrideJson(raw);
  mergeCarouselTypographyIntoGeneratedOutputRender(generatedOutput, renderPatch);
}

/** Read typography + optional `font_scale` from merged `platform_constraints` (DB row or creation_pack slice). */
export function pickCarouselTypographyPatchFromPlatformConstraints(platformConstraints: unknown): Record<string, number> {
  if (!platformConstraints || typeof platformConstraints !== "object") return {};
  const src = platformConstraints as Record<string, unknown>;
  const patch = pickCarouselTypographyPatch(src);
  const fs = src.carousel_font_scale;
  if (fs !== undefined && fs !== null) {
    const n = typeof fs === "number" ? fs : Number(String(fs).trim());
    if (Number.isFinite(n) && n > 0) patch.font_scale = Math.min(1.25, Math.max(0.75, n));
  }
  return patch;
}

/**
 * Fill missing `generated_output.render` typography keys from `platform_constraints`.
 * Does not overwrite values already present (reviewer / prior render / LLM).
 */
export function mergeCarouselTypographyDefaultsFromPlatformConstraints(
  generatedOutput: Record<string, unknown>,
  platformConstraints: unknown
): void {
  const patch = pickCarouselTypographyPatchFromPlatformConstraints(platformConstraints);
  if (Object.keys(patch).length === 0) return;
  const render = generatedOutput.render;
  const existing =
    render && typeof render === "object" && !Array.isArray(render) ? (render as Record<string, unknown>) : {};
  const fill: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch)) {
    const cur = existing[k];
    if (cur == null || cur === "") fill[k] = v;
  }
  if (Object.keys(fill).length === 0) return;
  mergeCarouselTypographyIntoGeneratedOutputRender(generatedOutput, fill);
}
