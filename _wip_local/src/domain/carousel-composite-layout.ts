/**
 * Default listicle layout aligned with `services/renderer/templates/carousel_mimic_bg.hbs`.
 * Padding, font sizes, and role structure match the HBS template so composite output feels the same.
 */

export type CarouselCompositeSlideRole = "cover" | "body" | "cta";

export interface CarouselCompositeTextStyle {
  fontSizePx: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacingEm?: number;
  marginTopPx?: number;
}

export interface CarouselCompositeRoleLayout {
  headline: CarouselCompositeTextStyle;
  body: CarouselCompositeTextStyle;
}

export interface CarouselCompositeLayoutSpec {
  schema_version: 1;
  canvas_width: number;
  canvas_height: number;
  padding_x: number;
  padding_y: number;
  font_family: string;
  /** Soft shadow behind text (matches HBS text-shadow on backgrounds). */
  text_shadow_rgba: string;
  roles: Record<CarouselCompositeSlideRole, CarouselCompositeRoleLayout>;
}

export interface CarouselCompositeTheme {
  paper: string;
  ink: string;
  body: string;
}

export const DEFAULT_CAROUSEL_COMPOSITE_THEME: CarouselCompositeTheme = {
  paper: "#fffef9",
  ink: "#1c1c1e",
  body: "#3a3a3c",
};

/** Mirrors carousel_mimic_bg.hbs :root and .headline / .body / .cta rules. */
export const DEFAULT_CAROUSEL_COMPOSITE_LAYOUT: CarouselCompositeLayoutSpec = {
  schema_version: 1,
  canvas_width: 1080,
  canvas_height: 1350,
  padding_x: 78,
  padding_y: 88,
  font_family: "Inter, Arial, Helvetica, sans-serif",
  text_shadow_rgba: "rgba(255,254,249,0.85)",
  roles: {
    cover: {
      headline: { fontSizePx: 68, fontWeight: 700, lineHeight: 1.06, letterSpacingEm: -0.028 },
      body: { fontSizePx: 38, fontWeight: 400, lineHeight: 1.45, marginTopPx: 28 },
    },
    body: {
      headline: { fontSizePx: 68, fontWeight: 700, lineHeight: 1.12, letterSpacingEm: -0.028 },
      body: { fontSizePx: 38, fontWeight: 400, lineHeight: 1.45, marginTopPx: 28 },
    },
    cta: {
      headline: { fontSizePx: 72, fontWeight: 700, lineHeight: 1.08 },
      body: { fontSizePx: 38, fontWeight: 700, lineHeight: 1.45, marginTopPx: 12 },
    },
  },
};

export function mergeCarouselCompositeLayout(
  overrides: Record<string, unknown> | null | undefined
): CarouselCompositeLayoutSpec {
  if (!overrides || typeof overrides !== "object") return DEFAULT_CAROUSEL_COMPOSITE_LAYOUT;
  const base = DEFAULT_CAROUSEL_COMPOSITE_LAYOUT;
  const padX = Number(overrides.padding_x);
  const padY = Number(overrides.padding_y);
  return {
    ...base,
    ...(Number.isFinite(padX) && padX > 0 ? { padding_x: Math.round(padX) } : {}),
    ...(Number.isFinite(padY) && padY > 0 ? { padding_y: Math.round(padY) } : {}),
    ...(typeof overrides.font_family === "string" && overrides.font_family.trim()
      ? { font_family: overrides.font_family.trim() }
      : {}),
  };
}

export function mergeCarouselCompositeTheme(
  overrides: Record<string, unknown> | null | undefined
): CarouselCompositeTheme {
  if (!overrides || typeof overrides !== "object") return DEFAULT_CAROUSEL_COMPOSITE_THEME;
  return {
    paper:
      typeof overrides.paper === "string" && /^#[0-9a-fA-F]{3,8}$/.test(overrides.paper.trim())
        ? overrides.paper.trim()
        : DEFAULT_CAROUSEL_COMPOSITE_THEME.paper,
    ink:
      typeof overrides.ink === "string" && /^#[0-9a-fA-F]{3,8}$/.test(overrides.ink.trim())
        ? overrides.ink.trim()
        : DEFAULT_CAROUSEL_COMPOSITE_THEME.ink,
    body:
      typeof overrides.body === "string" && /^#[0-9a-fA-F]{3,8}$/.test(overrides.body.trim())
        ? overrides.body.trim()
        : DEFAULT_CAROUSEL_COMPOSITE_THEME.body,
  };
}

/** Map 1-based slide index + total to cover | body | cta (same arc as splitFlatSlidesToTemplateShape). */
export function slideRoleForIndex(slideIndex1Based: number, totalSlides: number): CarouselCompositeSlideRole {
  if (totalSlides <= 1) return slideIndex1Based === 1 ? "cover" : "cta";
  if (slideIndex1Based === 1) return "cover";
  if (slideIndex1Based === totalSlides) return "cta";
  return "body";
}

/** Prefix for composite template keys pinned on projects (distinct from .hbs filenames). */
export const CAROUSEL_COMPOSITE_TEMPLATE_PREFIX = "composite:";

export function isCompositeTemplateKey(raw: string): boolean {
  return raw.trim().toLowerCase().startsWith(CAROUSEL_COMPOSITE_TEMPLATE_PREFIX);
}

export function compositeTemplateKeyFromRef(raw: string): string {
  const t = raw.trim();
  if (isCompositeTemplateKey(t)) return t.slice(CAROUSEL_COMPOSITE_TEMPLATE_PREFIX.length).trim();
  return t;
}
