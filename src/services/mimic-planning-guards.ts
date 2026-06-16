import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_VISUAL_FIRST_CAROUSEL,
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
  isVisualFirstCarouselFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import { mimicCarouselReferenceEligible, mimicImageReferenceEligible } from "./mimic-reference-resolver.js";

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

/**
 * Visual-first / mixed carousel ideas from ideas_json — separate lane from mimic picks.
 */
export function shouldExpandVisualFirstCarouselForRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true) return false;
  if (String(row.target_flow_type ?? "").trim() === FLOW_VISUAL_FIRST_CAROUSEL) {
    return carouselReferenceEligible(row, derivedGlobals);
  }
  const style = normalizeCarouselStyle(row);
  if (style !== "visual_first" && style !== "mixed") return false;
  if (String(row.format ?? "").trim().toLowerCase() !== "carousel") return false;
  return carouselReferenceEligible(row, derivedGlobals);
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
  return false;
}
