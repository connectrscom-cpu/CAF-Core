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
  font_family: string | null;
  source: string | null;
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
  const directX = pickNum(rec.x);
  const directY = pickNum(rec.y);
  const directW = pickNum(rec.w);
  const directH = pickNum(rec.h);
  if (directX != null && directY != null && directW != null && directH != null) {
    return {
      x: clamp01(directX),
      y: clamp01(directY),
      w: clamp01(directW),
      h: clamp01(directH),
    };
  }

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
    const family = String(rec.font_family ?? rec.font_family_detected ?? "").trim();
    const source = String(rec.source ?? "").trim().toLowerCase() || null;
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
      font_family: family || null,
      source,
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
    return "Leave generous clean margins for later HTML text overlay. Never render text blocks, headlines, paragraphs, or placeholder copy — no letters, numbers, logos, signs, captions, watermarks, symbols, or handwriting.";
  }

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  const placement = textPlacementFromSlide(slide);

  const parts: string[] = [
    "Never render readable text: no words, headlines, paragraphs, lorem ipsum, or placeholder text blocks.",
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

/** Fixed carousel render canvas — must match services/renderer (1080×1350). */
export const CAROUSEL_RENDER_WIDTH_PX = 1080;
export const CAROUSEL_RENDER_HEIGHT_PX = 1350;

const CANVAS_HEIGHT = CAROUSEL_RENDER_HEIGHT_PX;

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

/** Nemotron slide index for vision rows (may differ from 1-based output index after promo/video drops). */
export function guidelineSlideIndexForMimicOutput(
  mimic: Partial<Pick<MimicPayloadV1, "reference_items" | "slide_plans">>,
  outputSlideIndex1Based: number
): number {
  const items = mimic.reference_items ?? [];
  if (items.length === 0) return outputSlideIndex1Based;

  const plan = mimic.slide_plans?.find((p) => p.slide_index === outputSlideIndex1Based);
  const refIdx = plan?.reference_index ?? outputSlideIndex1Based;

  let item = items[outputSlideIndex1Based - 1] ?? null;
  if (plan?.reference_index != null) {
    item =
      items.find((r) => r.index === refIdx) ??
      (refIdx >= 1 && refIdx <= items.length ? items[refIdx - 1] : undefined) ??
      item;
  }

  const src = item?.source_slide_index;
  if (src != null && Number.isFinite(src) && src > 0) return src;
  return outputSlideIndex1Based;
}

function slideGuidelineRecord(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number,
  lookupSlideIndex?: number
): Record<string, unknown> | null {
  const lookupIdx = lookupSlideIndex ?? slideIndex1Based;
  const vg = visualGuideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  if (fromPackage.length > 0) {
    const match =
      fromPackage
        .map((raw) => asRecord(raw))
        .find((s) => s && Number(s.slide_index) === lookupIdx) ??
      asRecord(fromPackage[lookupIdx - 1]);
    if (match) return match;
  }
  const aesSlides = aestheticSlideRecordsFromGuideline(vg);
  if (aesSlides.length === 0) return null;
  return (
    aesSlides.find((s) => Number(s.slide_index) === lookupIdx) ??
    aesSlides[lookupIdx - 1] ??
    null
  );
}

function textBlockRegionForLayout(blocks: MimicTextBlock[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = blocks.map((b) => b.x);
  const ys = blocks.map((b) => b.y);
  const x2 = blocks.map((b) => b.x + b.w);
  const y2 = blocks.map((b) => b.y + b.h);
  const pad = 0.02;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...x2);
  const y1 = Math.max(...y2);
  return {
    x: clamp01(x0 - pad),
    y: clamp01(y0 - pad),
    w: clamp01(x1 - x0 + 2 * pad),
    h: clamp01(y1 - y0 + 2 * pad),
  };
}

/** Map Nemotron normalized text block boxes → flex or absolute overlay region. */
export function layoutAnchorFromTextBlocks(blocks: MimicTextBlock[]): MimicSlideLayoutPatch & {
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
} {
  const region = textBlockRegionForLayout(blocks);
  const title =
    blocks.find((b) => /title|headline|hook|cover/.test(b.role ?? "")) ?? blocks[0] ?? null;
  const anchorY = title ? title.y + title.h / 2 : region.y + region.h / 2;
  const anchorX = title ? title.x + title.w / 2 : region.x + region.w / 2;

  let mimic_page_justify = "flex-start";
  if (anchorY >= 0.58) mimic_page_justify = "flex-end";
  else if (anchorY >= 0.36 && anchorY <= 0.58) mimic_page_justify = "center";

  let mimic_text_align = "left";
  let mimic_page_align = "stretch";
  const alignHint = (title?.align ?? "").toLowerCase();
  if (alignHint === "center" || (anchorX >= 0.38 && anchorX <= 0.62)) {
    mimic_text_align = "center";
    mimic_page_align = "center";
  } else if (alignHint === "right" || anchorX >= 0.64) {
    mimic_text_align = "right";
    mimic_page_align = "flex-end";
  }

  return {
    mimic_page_justify,
    mimic_page_align,
    mimic_text_align,
    mimic_use_block_positioning: true,
    mimic_text_x: region.x,
    mimic_text_y: region.y,
    mimic_text_w: region.w,
  };
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
  slideIndex1Based: number,
  lookupSlideIndex?: number
): MimicSlideLayoutPatch & {
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
} {
  const slide = slideGuidelineRecord(visualGuideline, slideIndex1Based, lookupSlideIndex);
  const blocks = slide ? parseMimicTextBlocks(slide.text_blocks) : [];
  if (blocks.length > 0) {
    return layoutAnchorFromTextBlocks(blocks);
  }

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
  /** When true, HBS places copy at Nemotron text_blocks region (not default top stack). */
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
}

/**
 * Derive reviewer/renderer typography + layout from top-performer vision analysis.
 * Applied per slide at render time (after Qwen background plates, before HBS composite).
 */
export function mimicSlideTypographyPatch(
  mimic: Pick<MimicPayloadV1, "visual_guideline"> &
    Partial<Pick<MimicPayloadV1, "reference_items" | "slide_plans">>,
  slideIndex1Based: number,
  totalSlides: number,
  opts?: { skipIfReviewerSet?: Record<string, unknown> }
): MimicSlideTypographyPatch {
  const vg = mimic.visual_guideline ?? {};
  const lookupIdx = guidelineSlideIndexForMimicOutput(mimic, slideIndex1Based);
  const slide = slideGuidelineRecord(vg, slideIndex1Based, lookupIdx);
  const typography = asRecord(slide?.typography);
  const layout = mimicSlideLayoutPatch(vg, slideIndex1Based, lookupIdx);
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
    "mimic_use_block_positioning",
    "mimic_text_x",
    "mimic_text_y",
    "mimic_text_w",
  ] as const) {
    if (skip[key] != null && String(skip[key]).trim() !== "") {
      delete out[key];
    }
  }

  return out;
}

/** True when reference slides carry Document AI OCR geometry (merged `text_blocks` or `document_ai_ocr_v1`). */
export function mimicPayloadHasDocAiTextLayout(
  mimic: Pick<MimicPayloadV1, "visual_guideline">
): boolean {
  const vg = mimic.visual_guideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  const aesSlides = aestheticSlideRecordsFromGuideline(vg);
  const slides = fromPackage.length > 0 ? fromPackage : aesSlides;
  for (const raw of slides) {
    const slide = asRecord(raw);
    if (!slide) continue;
    if (slide.document_ai_ocr_v1) return true;
    const blocks = slide.text_blocks;
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        const rec = asRecord(b);
        if (rec && String(rec.source ?? "").trim().toLowerCase() === "document_ai") return true;
      }
    }
    if (parseMimicTextBlocks(slide.text_blocks).some((b) => b.source === "document_ai")) return true;
  }
  return false;
}

export interface MimicDocAiRenderTextLayer {
  text: string;
  role: string;
  /** Normalized 0–1 (legacy consumers). */
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  /** Absolute px on 1080×1350 render canvas. */
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  layout_mode: "single_line" | "multi_line";
  layout_class: string;
  font_size_px: number | null;
  font_weight: number | null;
  color_hex: string | null;
  text_align: string;
  css_style: string;
}

function roleBucket(role: string | null): "headline" | "body" | "cta" | "other" {
  const r = (role ?? "").toLowerCase();
  if (/title|headline|hook|cover|kicker/.test(r)) return "headline";
  if (/cta|handle/.test(r)) return "cta";
  if (/body|subtitle|caption|paragraph|sub/.test(r)) return "body";
  return "other";
}

function webFontFamilyFromDetected(detected: string | null): string | null {
  if (!detected?.trim()) return null;
  const d = detected.trim().toUpperCase();
  if (d.includes("MONO")) return "ui-monospace, SFMono-Regular, Menlo, monospace";
  if (d.includes("SERIF") && !d.includes("SANS")) return "Georgia, 'Times New Roman', serif";
  if (d.includes("HAND") || d.includes("SCRIPT")) return "'Segoe Script', 'Brush Script MT', cursive";
  return "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

function cssFontWeight(raw: string | null): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 100 && n <= 900) return Math.round(n / 100) * 100;
  if (s === "bold" || s === "700") return 700;
  if (s === "semibold" || s === "600") return 600;
  if (s === "medium" || s === "500") return 500;
  if (s === "regular" || s === "normal" || s === "400") return 400;
  return null;
}

function pct01(n: number): number {
  return Math.round(clamp01(n) * 10000) / 100;
}

function bboxNormToRenderPx(
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW = CAROUSEL_RENDER_WIDTH_PX,
  canvasH = CAROUSEL_RENDER_HEIGHT_PX
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(clamp01(x) * canvasW),
    y: Math.round(clamp01(y) * canvasH),
    w: Math.max(1, Math.round(clamp01(w) * canvasW)),
    h: Math.max(1, Math.round(clamp01(h) * canvasH)),
  };
}

type DocAiLayoutBlock = MimicTextBlock & { ref_text: string };

/** Prefer OCR `text_layers` geometry merged with Nemotron roles from `text_blocks`. */
function extractDocAiLayoutBlocks(refSlide: Record<string, unknown>): DocAiLayoutBlock[] {
  const parsed = parseMimicTextBlocks(refSlide.text_blocks);
  const docBlocks = parsed.filter((b) => b.source === "document_ai");
  const layoutBlocks = docBlocks.length > 0 ? docBlocks : parsed;
  if (layoutBlocks.length === 0) return [];

  const ocr = asRecord(refSlide.document_ai_ocr_v1);
  const ocrLayers = Array.isArray(ocr?.text_layers) ? ocr.text_layers : [];
  if (ocrLayers.length === 0) {
    return layoutBlocks.map((b) => ({ ...b, ref_text: b.text }));
  }

  const out: DocAiLayoutBlock[] = [];
  const pairCount = Math.max(layoutBlocks.length, ocrLayers.length);
  for (let i = 0; i < pairCount; i++) {
    const block = layoutBlocks[i] ?? layoutBlocks[layoutBlocks.length - 1]!;
    const layer = asRecord(ocrLayers[i]);
    if (!layer) {
      out.push({ ...block, ref_text: block.text });
      continue;
    }
    const text = String(layer.text ?? block.text ?? "").trim();
    if (!text) continue;
    const bbox = asRecord(layer.bbox_pct);
    const font = asRecord(layer.font);
    const box =
      bbox &&
      Number.isFinite(Number(bbox.x)) &&
      Number.isFinite(Number(bbox.y)) &&
      Number.isFinite(Number(bbox.w)) &&
      Number.isFinite(Number(bbox.h))
        ? {
            x: clamp01(Number(bbox.x)),
            y: clamp01(Number(bbox.y)),
            w: clamp01(Number(bbox.w)),
            h: clamp01(Number(bbox.h)),
          }
        : { x: block.x, y: block.y, w: block.w, h: block.h };
    const fontPx = pickNum(font?.size_px);
    out.push({
      ...block,
      text,
      ref_text: text,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      align: String(layer.alignment ?? block.align ?? "").trim().toLowerCase() || block.align,
      font_size_px:
        fontPx != null && fontPx > 0 && fontPx < 400 ? Math.round(fontPx) : block.font_size_px,
      font_weight:
        font?.weight != null ? String(font.weight) : block.font_weight,
      color_hex:
        typeof font?.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(font.color_hex)
          ? font.color_hex
          : block.color_hex,
      font_family:
        typeof font?.family_detected === "string" && font.family_detected.trim()
          ? font.family_detected.trim()
          : block.font_family,
      source: "document_ai",
    });
  }
  return out;
}

function isSingleLineLayoutBlock(refText: string, hNorm: number, wNorm: number): boolean {
  if (refText.includes("\n")) return false;
  if (refText.split(/\s+/).length <= 1 && refText.length <= 24) return true;
  return hNorm < 0.09 || hNorm / Math.max(wNorm, 0.01) < 0.38;
}

/** Estimate initial font size before Puppeteer shrink-to-fit. */
export function estimateDocAiFitFontSizePx(opts: {
  text: string;
  refText: string;
  refFontPx: number | null;
  boxWPx: number;
  boxHPx: number;
}): number {
  const refLen = Math.max(1, opts.refText.trim().length);
  const newLen = Math.max(1, opts.text.trim().length);
  let size =
    opts.refFontPx != null && opts.refFontPx > 0
      ? opts.refFontPx
      : Math.max(12, Math.round(opts.boxHPx * 0.82));

  if (newLen > refLen) {
    size = Math.max(10, Math.round(size * Math.sqrt(refLen / newLen)));
  }

  size = Math.min(size, Math.max(10, Math.round(opts.boxHPx * 0.96)));

  const lineCount = Math.max(1, opts.text.split(/\n/).filter((l) => l.trim()).length);
  const maxByHeight = Math.floor(opts.boxHPx / (lineCount * 1.12));
  if (maxByHeight > 0) size = Math.min(size, maxByHeight);

  const approxCharW = size * 0.52;
  const charsPerLine = Math.max(1, Math.floor(opts.boxWPx / approxCharW));
  const wrappedLines = Math.max(lineCount, Math.ceil(newLen / charsPerLine));
  const maxByWrap = Math.floor(opts.boxHPx / (wrappedLines * 1.12));
  if (maxByWrap > 0) size = Math.min(size, maxByWrap);

  return Math.max(10, Math.min(512, size));
}

export function buildDocAiLayerCssStyle(opts: {
  px: { x: number; y: number; w: number; h: number };
  text: string;
  refText: string;
  refFontPx: number | null;
  fontWeight: number | null;
  color: string | null;
  fontFamily: string | null;
  textAlign: string;
  singleLine: boolean;
}): { css_style: string; font_size_px: number; layout_mode: "single_line" | "multi_line"; layout_class: string } {
  const fontSize = estimateDocAiFitFontSizePx({
    text: opts.text,
    refText: opts.refText,
    refFontPx: opts.refFontPx,
    boxWPx: opts.px.w,
    boxHPx: opts.px.h,
  });
  const lineCount = Math.max(1, opts.text.split(/\n/).filter((l) => l.trim()).length);
  const lineHeight = opts.singleLine
    ? Math.min(1.15, Math.max(0.92, opts.px.h / fontSize))
    : Math.min(1.4, Math.max(1.02, opts.px.h / (fontSize * lineCount)));

  const cssParts = [
    `left:${opts.px.x}px`,
    `top:${opts.px.y}px`,
    `width:${opts.px.w}px`,
    `height:${opts.px.h}px`,
    `font-size:${fontSize}px`,
    `line-height:${lineHeight.toFixed(3)}`,
    `text-align:${opts.textAlign}`,
  ];

  if (opts.singleLine) {
    cssParts.push("white-space:nowrap", "overflow:hidden", "text-overflow:clip");
  } else {
    cssParts.push("white-space:pre-line", "overflow:hidden");
  }

  if (opts.fontWeight) cssParts.push(`font-weight:${opts.fontWeight}`);
  if (opts.color) cssParts.push(`color:${opts.color}`);
  if (opts.fontFamily) cssParts.push(`font-family:${opts.fontFamily}`);

  const layout_mode = opts.singleLine ? "single_line" : "multi_line";
  const layout_class = opts.singleLine ? "mimic-docai-layer--single-line" : "mimic-docai-layer--multi-line";

  return { css_style: cssParts.join(";"), font_size_px: fontSize, layout_mode, layout_class };
}

function llmTextPoolForSlide(slide: Record<string, unknown>): Array<{ bucket: string; text: string }> {
  const pool: Array<{ bucket: string; text: string }> = [];
  if (Array.isArray(slide.text_blocks) && slide.text_blocks.length > 0) {
    for (const item of slide.text_blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = String(rec.text ?? "").trim();
      if (!text) continue;
      pool.push({ bucket: roleBucket(String(rec.role ?? "")), text });
    }
    if (pool.length > 0) return pool;
  }
  const headline = String(slide.headline ?? slide.title ?? "").trim();
  const body = String(slide.body ?? slide.subtitle ?? "").trim();
  const cover = asRecord(slide.cover_slide);
  const cta = asRecord(slide.cta_slide);
  const h = headline || String(cover?.headline ?? slide.cover ?? slide.intro_title ?? "").trim();
  const b = body || String(cover?.body ?? slide.cover_subtitle ?? "").trim();
  const ctaText = String(slide.cta_text ?? cta?.body ?? "").trim();
  const ctaSub = String(cta?.sub ?? slide.cta_handle ?? cta?.handle ?? "").trim();
  if (h) pool.push({ bucket: "headline", text: h });
  if (b) {
    const parts = b.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts.length > 0 ? parts : [b]) {
      pool.push({ bucket: "body", text: part });
    }
  }
  if (ctaText) pool.push({ bucket: "cta", text: ctaText });
  if (ctaSub) pool.push({ bucket: "body", text: ctaSub });
  return pool;
}

function takeLlmTextForRefBlock(
  pool: Array<{ bucket: string; text: string }>,
  refRole: string | null,
  refIndex: number
): { text: string; pool: Array<{ bucket: string; text: string }> } {
  const bucket = roleBucket(refRole);
  const matchIdx = pool.findIndex((p) => p.bucket === bucket);
  if (matchIdx >= 0) {
    const text = pool[matchIdx]!.text;
    const next = [...pool.slice(0, matchIdx), ...pool.slice(matchIdx + 1)];
    return { text, pool: next };
  }
  if (refIndex < pool.length) {
    const text = pool[refIndex]!.text;
    return { text, pool: [...pool.slice(0, refIndex), ...pool.slice(refIndex + 1)] };
  }
  return { text: "", pool };
}

/** Reference OCR/Nemotron layout blocks for a slide (px + normalized bbox). Used by overlay lab + QA. */
export function referenceDocAiLayoutBlocksForMimicSlide(
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">,
  slideIndex1Based: number
): Array<{
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  font_size_px: number | null;
  color_hex: string | null;
}> {
  const lookupIdx = guidelineSlideIndexForMimicOutput(mimic, slideIndex1Based);
  const refSlide = slideGuidelineRecord(mimic.visual_guideline ?? {}, slideIndex1Based, lookupIdx);
  if (!refSlide) return [];
  return extractDocAiLayoutBlocks(refSlide).map((b) => {
    const px = bboxNormToRenderPx(b.x, b.y, b.w, b.h);
    return {
      text: b.ref_text,
      role: b.role,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      x_px: px.x,
      y_px: px.y,
      w_px: px.w,
      h_px: px.h,
      font_size_px: b.font_size_px,
      color_hex: b.color_hex,
    };
  });
}

/**
 * Map Document AI reference geometry to LLM copy as absolute px layers on the 1080×1350 canvas.
 * Puppeteer performs a second shrink-to-fit pass (see services/renderer/server.js).
 */
export function buildMimicDocAiRenderTextLayers(
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">,
  slideIndex1Based: number,
  llmSlide: Record<string, unknown>,
  theme?: { ink: string; body: string }
): MimicDocAiRenderTextLayer[] {
  const lookupIdx = guidelineSlideIndexForMimicOutput(mimic, slideIndex1Based);
  const refSlide = slideGuidelineRecord(mimic.visual_guideline ?? {}, slideIndex1Based, lookupIdx);
  if (!refSlide) return [];

  const layoutBlocks = extractDocAiLayoutBlocks(refSlide);
  if (layoutBlocks.length === 0) return [];

  let pool = llmTextPoolForSlide(llmSlide);
  const sortedRef = [...layoutBlocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const layers: MimicDocAiRenderTextLayer[] = [];

  for (let i = 0; i < sortedRef.length; i++) {
    const ref = sortedRef[i]!;
    const { text, pool: nextPool } = takeLlmTextForRefBlock(pool, ref.role, i);
    pool = nextPool;
    if (!text.trim()) continue;

    const bucket = roleBucket(ref.role);
    const color =
      ref.color_hex ??
      (bucket === "headline" || bucket === "cta" ? theme?.ink : theme?.body) ??
      null;
    const fontWeight = cssFontWeight(ref.font_weight);
    const textAlign =
      ref.align && ref.align !== "unknown" ? ref.align : bucket === "cta" ? "center" : "left";
    const fontFamily = webFontFamilyFromDetected(ref.font_family);
    const px = bboxNormToRenderPx(ref.x, ref.y, ref.w, ref.h);
    const singleLine = isSingleLineLayoutBlock(ref.ref_text, ref.h, ref.w);
    const styled = buildDocAiLayerCssStyle({
      px,
      text,
      refText: ref.ref_text,
      refFontPx: ref.font_size_px,
      fontWeight,
      color,
      fontFamily,
      textAlign,
      singleLine,
    });

    layers.push({
      text,
      role: ref.role ?? bucket,
      x_pct: pct01(ref.x),
      y_pct: pct01(ref.y),
      w_pct: pct01(ref.w),
      h_pct: pct01(ref.h),
      x_px: px.x,
      y_px: px.y,
      w_px: px.w,
      h_px: px.h,
      layout_mode: styled.layout_mode,
      layout_class: styled.layout_class,
      font_size_px: styled.font_size_px,
      font_weight: fontWeight,
      color_hex: color,
      text_align: textAlign,
      css_style: styled.css_style,
    });
  }

  return layers;
}
