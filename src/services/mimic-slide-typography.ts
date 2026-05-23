import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

const CANVAS_HEIGHT = 1350;

const HEADLINE_TIER_PX: Record<string, number> = {
  xs: 44,
  sm: 54,
  md: 68,
  lg: 80,
  xl: 92,
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

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
  const hay = deckHaystack(visualGuideline);
  return /\bdark\b|celestial|moody|noir|night|moon|eclipse/.test(hay);
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
  const typography = asRecord(slide?.typography);
  const placement = String(typography?.text_placement ?? "").toLowerCase();
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

  const headlinePx =
    parseRelativeScaleHeadlinePx(typography?.relative_scale) ??
    parseRelativeScaleHeadlinePx(typography?.headline_guess) ??
    (isCta ? 72 : 68);

  const bodyPx = typography ? parseBodyFontPxFromTypography(typography, headlinePx) : 38;

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
