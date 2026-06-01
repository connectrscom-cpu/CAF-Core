import type { MimicMode, MimicSlidePlan, MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  aestheticSlideRecords,
  deckUsesUnifiedBackgroundPlate,
  hasVisualLedDeckCues,
  isTextOverlayDeckFromGuideline,
  isVisualLedShortCopyDeck,
  nemotronSuggestsTextOnTemplate,
  requiresCopyBeforeVisualMimic,
} from "../domain/mimic-text-heavy.js";
import { entryReferenceFrameCount } from "./mimic-reference-resolver.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "../domain/top-performer-mimic-flow-types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Read `mimic_evaluation` from the aesthetic_analysis_json or the entry root. */
function pickMimicEvaluation(entry: Record<string, unknown>): Record<string, unknown> | null {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  return asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
}

/** Map Nemotron recommended_mode to our MimicMode enum. */
function nemotronModeToMimicMode(recommended: string): MimicMode | null {
  const m = recommended.trim().toLowerCase().replace(/\s+/g, "_");
  if (m === "full_bleed_visual") return "carousel_visual";
  if (m === "text_on_template") return "template_bg";
  if (m === "not_suitable") return "carousel_visual";
  return null;
}

/**
 * Classify mimic mode for a carousel entry.
 *
 * Priority:
 *  1. Manual `modeOverride` from a reviewer
 *  2. Nemotron `mimic_evaluation.recommended_mode` (when present)
 *  3. Heuristic fallback (text density, format pattern, visual cues)
 */
export function classifyMimicMode(
  flowType: string,
  entry: Record<string, unknown>,
  modeOverride?: MimicMode | null
): { mode: MimicMode; slide_plans?: MimicSlidePlan[] } {
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE) {
    return { mode: "image_full" };
  }
  if (flowType !== FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) {
    return { mode: "carousel_visual" };
  }

  const slides = aestheticSlideRecords(entry);
  const refFrames = entryReferenceFrameCount(entry);
  const slideCount = Math.max(slides.length, refFrames, 1);

  let effectiveMode: MimicMode;
  if (modeOverride) {
    effectiveMode = modeOverride;
  } else {
    const mimicEval = pickMimicEvaluation(entry);
    const nemotronMode = mimicEval?.recommended_mode
      ? nemotronModeToMimicMode(String(mimicEval.recommended_mode))
      : null;
    effectiveMode = nemotronMode ?? determineAutoMode(entry, slides);
    if (
      effectiveMode === "carousel_visual" &&
      slides.length === 0 &&
      requiresCopyBeforeVisualMimic(entry) &&
      !isVisualLedShortCopyDeck(entry) &&
      (deckUsesUnifiedBackgroundPlate(entry) || isTextOverlayDeckFromGuideline(entry))
    ) {
      effectiveMode = "template_bg";
    }
  }

  if (effectiveMode === "template_bg") {
    const mimicEval = pickMimicEvaluation(entry);
    const isUniform = String(mimicEval?.template_consistency ?? "").toLowerCase() === "uniform";
    const unifiedBg = isUniform || deckUsesUnifiedBackgroundPlate(entry);
    const slide_plans: MimicSlidePlan[] = [];
    for (let i = 0; i < slideCount; i++) {
      const refSlot = unifiedBg ? 1 : refFrames > 0 ? (i % refFrames) + 1 : 1;
      slide_plans.push({
        slide_index: i + 1,
        render_mode: "hbs",
        reference_index: refSlot,
      });
    }
    return { mode: "template_bg", slide_plans };
  }

  const slide_plans: MimicSlidePlan[] = [];
  for (let i = 0; i < slideCount; i++) {
    slide_plans.push({
      slide_index: i + 1,
      render_mode: "full_bleed",
      reference_index: Math.min(i + 1, refFrames || slides.length || 1),
    });
  }

  return { mode: "carousel_visual", slide_plans };
}

/** Heuristic fallback when mimic_evaluation is absent (pre-tagging packs). */
function determineAutoMode(
  entry: Record<string, unknown>,
  slides: Record<string, unknown>[]
): MimicMode {
  if (nemotronSuggestsTextOnTemplate(entry)) return "template_bg";
  if (!requiresCopyBeforeVisualMimic(entry)) return "carousel_visual";

  if (hasVisualLedDeckCues(entry) && slides.length > 0 && !deckUsesUnifiedBackgroundPlate(entry)) {
    const heavySlides = slides.filter(
      (s) => String(s.text_density ?? "").toLowerCase() === "high"
    );
    if (heavySlides.length < slides.length / 2) return "carousel_visual";
  }

  return "template_bg";
}

/** Ensure every output slide has a render plan (cycle reference frames for extras). */
export function extendSlidePlansForOutputCount(
  mimic: { mode: MimicMode; reference_items: { index: number }[]; slide_plans?: MimicSlidePlan[] },
  outputSlideCount: number
): MimicSlidePlan[] {
  const refCount = Math.max(mimic.reference_items.length, 1);
  const plans = [...(mimic.slide_plans ?? [])];
  const defaultMode: MimicSlidePlan["render_mode"] =
    mimic.mode === "template_bg" ? "hbs" : plans[plans.length - 1]?.render_mode ?? "hbs";

  for (let slideIndex = plans.length + 1; slideIndex <= outputSlideCount; slideIndex++) {
    const unifiedBg = mimic.mode === "template_bg";
    const refSlot = unifiedBg ? 1 : refCount > 0 ? ((slideIndex - 1) % refCount) + 1 : 1;
    const render_mode = mimic.mode === "template_bg" ? "hbs" : defaultMode;
    plans.push({ slide_index: slideIndex, render_mode, reference_index: refSlot });
  }
  return plans;
}

/** Drop render plans past the output slide count (e.g. 8 plans but only 7 copy slides). */
export function clampSlidePlansToOutputCount(
  slide_plans: MimicSlidePlan[] | undefined,
  outputSlideCount: number
): MimicSlidePlan[] {
  if (outputSlideCount < 1) return [];
  return (slide_plans ?? []).filter(
    (p) => p.slide_index >= 1 && p.slide_index <= outputSlideCount
  );
}

const PROMO_SLIDE_PURPOSES = new Set(["self_promo", "product_pitch"]);

/**
 * Fraction of slides in the deck that are promotional or brand-locked.
 * Uses Nemotron `slide_purpose` + `brand_specificity` tags when available.
 * Returns 0 when tags are absent (backward compat).
 */
export function deckPromotionalDensity(entry: Record<string, unknown>): number {
  const slides = aestheticSlideRecords(entry);
  if (slides.length === 0) return 0;
  let hasTags = false;
  let promoCount = 0;
  for (const s of slides) {
    const purpose = String(s.slide_purpose ?? "").trim().toLowerCase();
    const brand = String(s.brand_specificity ?? "").trim().toLowerCase();
    if (purpose || brand) hasTags = true;
    if (PROMO_SLIDE_PURPOSES.has(purpose) || brand === "high") promoCount++;
  }
  if (!hasTags) return 0;
  return promoCount / slides.length;
}

/**
 * True when more than half the deck is promotional / brand-locked —
 * a signal that this reference is a poor candidate for mimic generation.
 */
export function isDeckMostlyPromotional(entry: Record<string, unknown>): boolean {
  return deckPromotionalDensity(entry) > 0.5;
}

export interface ReconcileMimicPayloadAtRenderOptions {
  /** Stored `MIMIC_BACKGROUND` assets exist for this task — template overlay path was already started. */
  hasStoredBackgroundPlates?: boolean;
  /** `generation_payload.template_backgrounds_prepared_at` is set (pre-copy bg extract ran). */
  templateBackgroundsPrepared?: boolean;
}

/** Re-classify from persisted visual_guideline when prep ran before classifier rules improved. */
export function reconcileMimicPayloadAtRender(
  flowType: string,
  mimic: MimicPayloadV1,
  opts?: ReconcileMimicPayloadAtRenderOptions
): MimicPayloadV1 {
  if (flowType !== FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) return mimic;
  const vg = mimic.visual_guideline ?? {};
  const entry: Record<string, unknown> = {
    ...vg,
    stored_inspection_media_json: {
      items: mimic.reference_items.map((r) => ({
        index: r.index,
        vision_fetch_url: r.vision_fetch_url ?? "",
      })),
    },
  };

  if (mimic.mode_override === "carousel_visual") {
    const classified = classifyMimicMode(flowType, entry, "carousel_visual");
    return { ...mimic, mode: "carousel_visual", slide_plans: classified.slide_plans ?? mimic.slide_plans };
  }

  if (
    mimic.mode === "carousel_visual" &&
    (opts?.hasStoredBackgroundPlates || opts?.templateBackgroundsPrepared)
  ) {
    const classified = classifyMimicMode(flowType, entry);
    if (classified.mode === "template_bg") {
      return { ...mimic, mode: "template_bg", slide_plans: classified.slide_plans ?? mimic.slide_plans };
    }
  }

  const hasBgPlate = Boolean(String(mimic.background_image_url ?? "").trim());
  const shouldForceTemplateBg =
    hasBgPlate &&
    mimic.mode === "carousel_visual" &&
    !isVisualLedShortCopyDeck(entry) &&
    (deckUsesUnifiedBackgroundPlate(entry) || isTextOverlayDeckFromGuideline(entry));
  const modeOverride = shouldForceTemplateBg ? "template_bg" : mimic.mode_override;
  const classified = classifyMimicMode(flowType, entry, modeOverride);
  return { ...mimic, mode: classified.mode, slide_plans: classified.slide_plans ?? mimic.slide_plans };
}
