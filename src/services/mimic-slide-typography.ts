import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function slideOnScreenTextChars(slide: Record<string, unknown>): number {
  return String(slide.on_screen_text_transcript ?? slide.on_image_text ?? "").trim().length;
}

export interface MimicTextBlock {
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  align: string | null;
  font_size_px: number | null;
  font_weight: string | null;
  color_hex: string | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickNum(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pickBBoxNorm(rec: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const bboxNorm = asRecord(rec.bbox_norm);
  if (bboxNorm) {
    const x = pickNum(bboxNorm.x ?? bboxNorm.left);
    const y = pickNum(bboxNorm.y ?? bboxNorm.top);
    const w = pickNum(bboxNorm.w ?? bboxNorm.width);
    const h = pickNum(bboxNorm.h ?? bboxNorm.height);
    if (x != null && y != null && w != null && h != null) return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
  }
  const bbox = Array.isArray(rec.bbox) ? rec.bbox : Array.isArray(rec.bounding_box) ? rec.bounding_box : null;
  if (bbox && bbox.length >= 4) {
    const [a, b, c, d] = bbox.map((v) => Number(v));
    if (![a, b, c, d].every((v) => Number.isFinite(v))) return null;
    const maxVal = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    if (maxVal <= 1.05) {
      return { x: clamp01(a), y: clamp01(b), w: clamp01(c), h: clamp01(d) };
    }
    const canvasW = 1080;
    const canvasH = 1350;
    const x2 = Math.max(a, c);
    const y2 = Math.max(b, d);
    const x1 = Math.min(a, c);
    const y1 = Math.min(b, d);
    return {
      x: clamp01(x1 / canvasW),
      y: clamp01(y1 / canvasH),
      w: clamp01((x2 - x1) / canvasW),
      h: clamp01((y2 - y1) / canvasH),
    };
  }
  return null;
}

export function parseMimicTextBlocks(raw: unknown): MimicTextBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MimicTextBlock[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = String(rec.text ?? rec.content ?? "").trim();
    if (!text) continue;
    const box = pickBBoxNorm(rec);
    if (!box) continue;
    const fontPx = pickNum(rec.font_size_px ?? rec.estimated_font_size_px ?? rec.font_size);
    const color = String(rec.color_hex ?? rec.color ?? "").trim();
    out.push({
      text,
      role: String(rec.role ?? rec.semantic_role ?? "").trim().toLowerCase() || null,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      align: String(rec.align ?? rec.alignment ?? rec.text_align ?? "").trim().toLowerCase() || null,
      font_size_px: fontPx != null && fontPx > 0 && fontPx < 400 ? Math.round(fontPx) : null,
      font_weight: String(rec.font_weight ?? rec.weight ?? "").trim().toLowerCase() || null,
      color_hex: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null,
    });
  }
  return out;
}

export function slidePreferHbsTextOverlay(slide: Record<string, unknown>): boolean {
  if (slideOnScreenTextChars(slide) > 0) return true;
  const blocks = parseMimicTextBlocks(slide.text_blocks);
  return blocks.some((b) => b.text.length > 0);
}

export function textPlacementFromSlide(slide: Record<string, unknown> | null): string {
  if (!slide) return "";
  const typography = asRecord(slide.typography);
  const placement = String(typography?.text_placement ?? "").trim().toLowerCase();
  if (placement) return placement;

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  if (blocks.length === 0) return "";

  const centers = blocks.map((b) => b.y + b.h / 2);
  const avg = centers.reduce((a, c) => a + c, 0) / centers.length;
  if (avg >= 0.62) return "bottom band";
  if (avg <= 0.38) return "top band";
  return "center band";
}

export function buildArtOnlySafeZoneHint(slide: Record<string, unknown> | null | undefined): string {
  if (!slide) {
    return "Leave generous clean margins suitable for later HTML text overlay. Do not render any letters, numbers, logos, signs, captions, watermarks, symbols, or handwriting.";
  }

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  const placement = textPlacementFromSlide(slide);

  const parts: string[] = [
    "Do not render any letters, numbers, logos, signs, captions, watermarks, symbols, or handwriting.",
    "Output art/background only — all final copy will be added later via HTML/CSS overlay.",
  ];

  if (blocks.length > 0) {
    const minY = Math.min(...blocks.map((b) => b.y));
    const maxY = Math.max(...blocks.map((b) => b.y + b.h));
    if (maxY >= 0.55) {
      parts.push(
        `Leave the lower ${Math.round(Math.min(45, (1 - minY) * 100))}% of the frame clean, soft, and low-detail for white or light text overlay.`
      );
    } else if (minY <= 0.35) {
      parts.push("Leave the upper third clean and low-detail for headline overlay.");
    } else {
      parts.push("Leave a clear center band with low visual clutter for centered text overlay.");
    }
  } else if (/bottom|lower|footer|caption/.test(placement)) {
    parts.push("Leave the bottom 35% clean, soft gradient, low detail, suitable for text overlay.");
  } else if (/top|upper|header/.test(placement)) {
    parts.push("Leave the top 30% clean and low-detail for headline overlay.");
  } else if (/center|middle|band|stack/.test(placement)) {
    parts.push("Leave a clear center band with low clutter for centered text overlay.");
  } else {
    parts.push("Leave generous clean margins suitable for later HTML text overlay.");
  }

  return parts.join(" ");
}

const CANVAS_HEIGHT = 1350;

const HEADLINE_TIER_PX: Record<string, number> = {
  xs: 44,
  sm: 54,
  md: 68,
  lg: 80,
  xl: 92,
};

function aestheticSlideRecordsFromGuideline(vg: Record<string, unknown>): Record<string, unknown>[] {
  const aes =
    vg.aesthetic_analysis_json && typeof vg.aesthetic_analysis_json === "object" && !Array.isArray(vg.aesthetic_analysis_json)
      ? (vg.aesthetic_analysis_json as Record<string, unknown>)
      : vg;
  const slides = aes.slides;
  if (!Array.isArray(slides)) return [];
  return slides.map((raw) => asRecord(raw)).filter((x): x is Record<string, unknown> => x != null);
}

function slideGuidelineRecord(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): Record<string, unknown> | null {
  const vg = visualGuideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  if (fromPackage.length > 0) {
    const match =
      fromPackage
        .map((raw) => asRecord(raw))
        .find((s) => s && Number(s.slide_index) === slideIndex1Based) ??
      asRecord(fromPackage[slideIndex1Based - 1]);
    if (match) return match;
  }
  const aesSlides = aestheticSlideRecordsFromGuideline(vg);
  if (aesSlides.length === 0) return null;
  return (
    aesSlides.find((s) => Number(s.slide_index) === slideIndex1Based) ??
    aesSlides[slideIndex1Based - 1] ??
    null
  );
}

function deckHaystack(visualGuideline: Record<string, unknown> | null | undefined): string {
  const vg = visualGuideline ?? {};
  const parts: string[] = [];
  const dvs = asRecord(vg.deck_visual_system);
  if (dvs) {
    for (const key of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const t = String(dvs[key] ?? "").trim();
      if (t) parts.push(t.toLowerCase());
    }
  }
  const consistency = String(vg.visual_consistency ?? "").trim();
  if (consistency) parts.push(consistency.toLowerCase());
  const blueprint = asRecord(vg.replication_blueprint);
  const steps = Array.isArray(blueprint?.steps_to_remake) ? blueprint!.steps_to_remake : [];
  for (const step of steps) {
    const t = String(step ?? "").trim();
    if (t) parts.push(t.toLowerCase());
  }
  return parts.join(" ");
}

export function isDarkCelestialDeck(visualGuideline: Record<string, unknown> | null | undefined): boolean {
  return isDarkVisualDeck(visualGuideline);
}

const DARK_DECK_RE =
  /\bdark\b|celestial|moody|noir|night|moon|eclipse|silhouette|monochrom|black\s*and\s*white|\bb&w\b|shadowy|dramatic|mysterious|midnight|low[\s-]?key|high[\s-]?contrast/;

export function hexRelativeLuminance(hex: string): number | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(parseInt(h.slice(0, 2), 16) / 255);
  const g = lin(parseInt(h.slice(2, 4), 16) / 255);
  const b = lin(parseInt(h.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkHexColor(hex: string): boolean {
  const lum = hexRelativeLuminance(hex);
  return lum != null && lum < 0.38;
}

export function isLightHexColor(hex: string): boolean {
  const lum = hexRelativeLuminance(hex);
  return lum != null && lum > 0.62;
}

/** Dark photo / moody decks — zodiac silhouettes, celestial, B&W reference carousels, etc. */
export function isDarkVisualDeck(visualGuideline: Record<string, unknown> | null | undefined): boolean {
  const vg = visualGuideline ?? {};
  if (DARK_DECK_RE.test(deckHaystack(vg))) return true;
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  for (const raw of slides) {
    const slide = asRecord(raw);
    const ct = asRecord(slide?.color_tokens);
    const bg = typeof ct?.background === "string" ? ct.background.trim() : "";
    if (bg && isDarkHexColor(bg)) return true;
  }
  return false;
}

export interface MimicCarouselTheme {
  paper: string;
  ink: string;
  body: string;
  text_shadow_headline: string;
  text_shadow_body: string;
}

export const MIMIC_LIGHT_ON_DARK_THEME: MimicCarouselTheme = {
  paper: "#0c0c0e",
  ink: "#f5f5f7",
  body: "#e8e8ed",
  text_shadow_headline: "0 2px 24px rgba(0,0,0,0.92), 0 0 2px rgba(0,0,0,0.8)",
  text_shadow_body: "0 1px 16px rgba(0,0,0,0.88), 0 0 1px rgba(0,0,0,0.7)",
};

export const MIMIC_DARK_ON_LIGHT_THEME: MimicCarouselTheme = {
  paper: "#fffef9",
  ink: "#1c1c1e",
  body: "#3a3a3c",
  text_shadow_headline: "0 1px 12px rgba(255,254,249,0.85)",
  text_shadow_body: "0 1px 10px rgba(255,254,249,0.8)",
};

function colorTokensFromSlide(slide: Record<string, unknown> | null): {
  background: string | null;
  primary_text: string | null;
  accent: string[] | null;
} | null {
  const ct = asRecord(slide?.color_tokens);
  if (!ct) return null;
  return {
    background: typeof ct.background === "string" ? ct.background : null,
    primary_text: typeof ct.primary_text === "string" ? ct.primary_text : null,
    accent: Array.isArray(ct.accent) ? ct.accent.map(String) : null,
  };
}

/**
 * Readable text palette for mimic `template_bg` compositing.
 * Defaults to light-on-dark when vision is ambiguous — Qwen plates are usually photo/dark frames.
 */
export function inferMimicCarouselTheme(
  visualGuideline: Record<string, unknown> | null | undefined
): MimicCarouselTheme {
  const vg = visualGuideline ?? {};
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const hay = deckHaystack(vg);
  const lightPaperDeck = /cream|pastel|paper|white\s*background|light\s*background|off[\s-]?white|beige|parchment/.test(
    hay
  );

  let bgLum: number | null = null;
  let textLum: number | null = null;
  let paperHex = "";
  let inkHex = "";

  for (const raw of slides) {
    const slide = asRecord(raw);
    const tokens = colorTokensFromSlide(slide);
    if (!tokens) continue;
    const bg = (tokens.background ?? "").trim();
    const ink = (tokens.primary_text ?? "").trim();
    const accent = tokens.accent?.find((c) => /^#[0-9a-fA-F]{6}$/.test(c.trim())) ?? "";
    if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
      paperHex = bg;
      bgLum = hexRelativeLuminance(bg);
    }
    const textCandidate = ink || accent;
    if (textCandidate && /^#[0-9a-fA-F]{6}$/.test(textCandidate)) {
      inkHex = textCandidate;
      textLum = hexRelativeLuminance(textCandidate);
    }
    if (bgLum != null || textLum != null) break;
  }

  const darkDeck =
    isDarkVisualDeck(vg) || (bgLum != null && bgLum < 0.42) || (!lightPaperDeck && bgLum == null);

  if (!darkDeck && lightPaperDeck && bgLum != null && bgLum > 0.62) {
    return {
      ...MIMIC_DARK_ON_LIGHT_THEME,
      paper: paperHex || MIMIC_DARK_ON_LIGHT_THEME.paper,
      ink: inkHex && textLum != null && textLum < 0.45 ? inkHex : MIMIC_DARK_ON_LIGHT_THEME.ink,
      body: inkHex && textLum != null && textLum < 0.45 ? inkHex : MIMIC_DARK_ON_LIGHT_THEME.body,
    };
  }

  if (bgLum != null && textLum != null && bgLum < 0.42 && textLum < 0.42) {
    return { ...MIMIC_LIGHT_ON_DARK_THEME, paper: paperHex || MIMIC_LIGHT_ON_DARK_THEME.paper };
  }

  if (darkDeck) {
    const useVisionLightText = textLum != null && textLum > 0.62;
    return {
      ...MIMIC_LIGHT_ON_DARK_THEME,
      paper: paperHex || MIMIC_LIGHT_ON_DARK_THEME.paper,
      ink: useVisionLightText ? inkHex : MIMIC_LIGHT_ON_DARK_THEME.ink,
      body: useVisionLightText ? inkHex : MIMIC_LIGHT_ON_DARK_THEME.body,
    };
  }

  return MIMIC_DARK_ON_LIGHT_THEME;
}

export interface MimicSlideThemePatch {
  carousel_paper?: string;
  carousel_ink?: string;
  carousel_body?: string;
  carousel_text_shadow_headline?: string;
  carousel_text_shadow_body?: string;
}

/** Runtime palette override — injected by renderer after template compile (fixes contrast on Qwen plates). */
export function mimicSlideThemePatch(
  mimic: Pick<MimicPayloadV1, "visual_guideline">
): MimicSlideThemePatch {
  const theme = inferMimicCarouselTheme(mimic.visual_guideline);
  return {
    carousel_paper: theme.paper,
    carousel_ink: theme.ink,
    carousel_body: theme.body,
    carousel_text_shadow_headline: theme.text_shadow_headline,
    carousel_text_shadow_body: theme.text_shadow_body,
  };
}

export function parseRelativeScaleHeadlinePx(raw: unknown, canvasHeight = CANVAS_HEIGHT): number | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s.trim()) return null;
  const tierMatch = s.match(/\b(xs|sm|md|lg|xl)\b/);
  if (tierMatch) return HEADLINE_TIER_PX[tierMatch[1]!] ?? null;
  const pctMatch = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:slide|frame|canvas)/i);
  if (pctMatch) {
    const pct = Number(pctMatch[1]) / 100;
    if (Number.isFinite(pct) && pct > 0) {
      return Math.round(Math.min(120, Math.max(32, canvasHeight * pct)));
    }
  }
  return null;
}

export function parseBodyFontPxFromTypography(typography: Record<string, unknown>, headlinePx: number): number {
  const bodyGuess = String(typography.body_guess ?? "").toLowerCase();
  const rel = String(typography.relative_scale ?? "").toLowerCase();
  const combined = `${bodyGuess} ${rel}`;
  const tierMatch = combined.match(/\bbody[^a-z]*(xs|sm|md|lg|xl)\b|\b(xs|sm|md|lg|xl)\b[^a-z]*body/);
  if (tierMatch) {
    const tier = tierMatch[1] ?? tierMatch[2];
    const bodyTiers: Record<string, number> = { xs: 28, sm: 32, md: 38, lg: 44, xl: 50 };
    if (tier && bodyTiers[tier]) return bodyTiers[tier]!;
  }
  if (/fine\s*print|caption|small/.test(combined)) return 30;
  return Math.max(28, Math.min(48, Math.round(headlinePx * 0.55)));
}

export interface MimicSlideLayoutPatch {
  mimic_page_justify: string;
  mimic_page_align: string;
  mimic_text_align: string;
}

/** Map vision `text_placement` + deck cues → flex/text alignment for carousel_mimic_bg.hbs. */
export function mimicSlideLayoutPatch(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): MimicSlideLayoutPatch {
  const slide = slideGuidelineRecord(visualGuideline, slideIndex1Based);
  const placement = slide ? textPlacementFromSlide(slide).toLowerCase() : "";
  const deck = deckHaystack(visualGuideline);
  const deckCentered = /centered text|center stack|text centrally|text over/.test(deck);

  if (/bottom|caption|footer|lower/.test(placement)) {
    return {
      mimic_page_justify: "flex-end",
      mimic_page_align: deckCentered ? "center" : "stretch",
      mimic_text_align: deckCentered ? "center" : "left",
    };
  }
  if (/top|upper|header/.test(placement)) {
    return {
      mimic_page_justify: "flex-start",
      mimic_page_align: deckCentered ? "center" : "stretch",
      mimic_text_align: deckCentered ? "center" : "left",
    };
  }
  if (/center|middle|band|stack/.test(placement) || deckCentered) {
    return {
      mimic_page_justify: "center",
      mimic_page_align: "center",
      mimic_text_align: "center",
    };
  }
  return {
    mimic_page_justify: "flex-start",
    mimic_page_align: "stretch",
    mimic_text_align: "left",
  };
}

export interface MimicSlideTypographyPatch {
  carousel_headline_font_px?: number;
  carousel_body_font_px?: number;
  carousel_cta_font_px?: number;
  mimic_page_justify?: string;
  mimic_page_align?: string;
  mimic_text_align?: string;
}

/**
 * Derive reviewer/renderer typography + layout from top-performer vision analysis.
 * Applied per slide at render time (after Qwen background plates, before HBS composite).
 */
export function mimicSlideTypographyPatch(
  mimic: Pick<MimicPayloadV1, "visual_guideline">,
  slideIndex1Based: number,
  totalSlides: number,
  opts?: { skipIfReviewerSet?: Record<string, unknown> }
): MimicSlideTypographyPatch {
  const vg = mimic.visual_guideline ?? {};
  const slide = slideGuidelineRecord(vg, slideIndex1Based);
  const typography = asRecord(slide?.typography);
  const layout = mimicSlideLayoutPatch(vg, slideIndex1Based);
  const isCta = totalSlides > 1 && slideIndex1Based === totalSlides;
  const isCover = slideIndex1Based === 1;

  const blocks = slide ? parseMimicTextBlocks(slide.text_blocks) : [];
  const titleBlock = blocks.find((b) => /title|headline|hook/.test(b.role ?? "")) ?? blocks[0];
  const bodyBlock =
    blocks.find((b) => /body|subtitle|caption|paragraph/.test(b.role ?? "")) ??
    blocks.find((b) => b !== titleBlock);

  const headlineFromPx = Number(typography?.font_size_px_headline);
  const bodyFromPx = Number(typography?.font_size_px_body);

  const headlinePx =
    (titleBlock?.font_size_px != null ? titleBlock.font_size_px : null) ??
    (Number.isFinite(headlineFromPx) && headlineFromPx > 0 ? Math.round(headlineFromPx) : null) ??
    parseRelativeScaleHeadlinePx(typography?.relative_scale) ??
    parseRelativeScaleHeadlinePx(typography?.headline_guess) ??
    (isCta ? 72 : 68);

  const bodyPx =
    (bodyBlock?.font_size_px != null ? bodyBlock.font_size_px : null) ??
    (Number.isFinite(bodyFromPx) && bodyFromPx > 0 ? Math.round(bodyFromPx) : null) ??
    (typography ? parseBodyFontPxFromTypography(typography, headlinePx) : 38);

  const out: MimicSlideTypographyPatch = {
    ...layout,
    carousel_headline_font_px: isCover || !isCta ? headlinePx : undefined,
    carousel_body_font_px: !isCta ? bodyPx : undefined,
    carousel_cta_font_px: isCta ? headlinePx : undefined,
  };

  const skip = opts?.skipIfReviewerSet ?? {};
  for (const key of [
    "carousel_headline_font_px",
    "carousel_body_font_px",
    "carousel_cta_font_px",
    "mimic_page_justify",
    "mimic_page_align",
    "mimic_text_align",
  ] as const) {
    if (skip[key] != null && String(skip[key]).trim() !== "") {
      delete out[key];
    }
  }

  return out;
}
