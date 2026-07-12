import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_VISUAL_FIRST_CAROUSEL,
  FLOW_WHY_MIMIC_CAROUSEL,
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
  isVisualFirstCarouselFlow,
  isWhyMimicCarouselFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import { evaluateWhyMimicSilPlanning } from "../domain/mimic-slide-analysis-quality.js";
import { pickOrDeriveSlideIntelligence } from "../domain/slide-intelligence.js";
import { loadConfig } from "../config.js";
import {
  carouselGuidelineEntryForInsightIds,
  mimicCarouselReferenceEligible,
  mimicImageReferenceEligible,
} from "./mimic-reference-resolver.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function normalizeCarouselStyle(row: Record<string, unknown>): string {
  return String(row.carousel_style ?? row.execution_profile ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

function carouselReferenceEligible(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  const insightIds = stringList(row.grounding_insight_ids);
  if (insightIds.length === 0) return false;
  return mimicCarouselReferenceEligible(derivedGlobals ?? null, insightIds);
}

/** Resolve SIL from the visual-guidelines pack entry and audit for Why Mimic planning. */
export function whyMimicSilPlanningEligible(
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightIds: string[]
): boolean {
  const cfg = loadConfig();
  if (!cfg.WHY_MIMIC_REQUIRE_SUBSTANTIVE_SIL) return true;
  if (insightIds.length === 0) return false;

  const entry = carouselGuidelineEntryForInsightIds(derivedGlobals ?? null, insightIds);
  if (!entry) return false;

  const bundle = pickOrDeriveSlideIntelligence(entry.slide_intelligence_v1, {
    aesthetic: asRecord(entry.aesthetic_analysis_json),
    insights_id: String(entry.insights_id ?? "").trim() || null,
    analysis_tier: String(entry.analysis_tier ?? "").trim() || null,
    mediaKind: "carousel",
  });
  if (!bundle) return false;

  const evaluation = evaluateWhyMimicSilPlanning(bundle, {
    whyMinChars: cfg.SIL_WHY_IT_WORKS_MIN_CHARS,
    visualMinChars: cfg.SIL_VISUAL_DESCRIPTION_MIN_CHARS,
    thesisMinChars: cfg.SIL_STRATEGIC_THESIS_MIN_CHARS,
    minSubstantiveSlideRatio: cfg.WHY_MIMIC_MIN_SUBSTANTIVE_SLIDE_RATIO,
    requireSubstantive: true,
  });
  return evaluation?.eligible === true;
}

/**
 * Top-performer image mimic only applies to explicit mimic picks or ideas grounded
 * to a single-frame deep reference — not every post-format pack idea.
 */
export function shouldExpandTopPerformerMimicImageForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "image") {
    return true;
  }
  if (String(row.target_flow_type ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_IMAGE) {
    return true;
  }
  const insightIds = stringList(row.grounding_insight_ids);
  if (insightIds.length === 0) return false;
  return mimicImageReferenceEligible(derivedGlobals ?? null, insightIds);
}

/** Manual top-performer carousel mimic picks only (Mimic · Carousel tab). */
export function shouldExpandMimicCarouselPickForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "carousel") {
    return carouselReferenceEligible(row, derivedGlobals);
  }
  if (String(row.target_flow_type ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) {
    return carouselReferenceEligible(row, derivedGlobals);
  }
  return false;
}

/** Manual Why Mimic carousel picks (Mimic · Why Carousel tab). */
export function shouldExpandWhyMimicCarouselForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  const insightIds = stringList(row.grounding_insight_ids);
  const referenceOk =
    row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "why_carousel"
      ? carouselReferenceEligible(row, derivedGlobals)
      : String(row.target_flow_type ?? "").trim() === FLOW_WHY_MIMIC_CAROUSEL
        ? carouselReferenceEligible(row, derivedGlobals)
        : false;
  if (!referenceOk) return false;
  return whyMimicSilPlanningEligible(derivedGlobals, insightIds);
}

/**
 * New Visual Carousel ideas from ideas_json — separate lane from manual mimic picks.
 * Does not require top_performer_carousel grounding at plan time (BVS + original concept).
 */
export function shouldExpandVisualFirstCarouselForRow(
  row: Record<string, unknown>,
  _derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true) return false;
  if (String(row.target_flow_type ?? "").trim() === FLOW_VISUAL_FIRST_CAROUSEL) {
    return String(row.format ?? "").trim().toLowerCase() === "carousel";
  }
  const style = normalizeCarouselStyle(row);
  if (style !== "visual_first" && style !== "mixed") return false;
  if (String(row.format ?? "").trim().toLowerCase() !== "carousel") return false;
  return true;
}

/** @deprecated Use shouldExpandMimicCarouselPickForRow or shouldExpandVisualFirstCarouselForRow. */
export function shouldExpandTopPerformerMimicCarouselForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  return (
    shouldExpandMimicCarouselPickForRow(row, derivedGlobals) ||
    shouldExpandVisualFirstCarouselForRow(row, derivedGlobals)
  );
}

export function shouldSkipMimicFlowExpansion(
  flowType: string,
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (isTopPerformerMimicImageFlow(flowType)) {
    return !shouldExpandTopPerformerMimicImageForRow(row, derivedGlobals);
  }
  if (isTopPerformerMimicCarouselFlow(flowType)) {
    return !shouldExpandMimicCarouselPickForRow(row, derivedGlobals);
  }
  if (isVisualFirstCarouselFlow(flowType)) {
    return !shouldExpandVisualFirstCarouselForRow(row, derivedGlobals);
  }
  if (isWhyMimicCarouselFlow(flowType)) {
    return !shouldExpandWhyMimicCarouselForRow(row, derivedGlobals);
  }
  return false;
}
