/**
 * Top-performer mimic flow_type keys (image + carousel wired when MIMIC_IMAGE_ENABLED).
 * Video mimic picks route to HeyGen FLOW_VID_* flows; FLOW_TOP_PERFORMER_MIMIC_VIDEO is a planning-cap alias only.
 *
 * Carousel lanes (same **render** engine via `isTpGroundedCarouselRenderFlow`):
 * - FLOW_TOP_PERFORMER_MIMIC_CAROUSEL — manual fidelity mimic picks
 * - FLOW_VISUAL_FIRST_CAROUSEL — ideas-from-insights visual_first bucket
 * - FLOW_WHY_MIMIC_CAROUSEL — manual Why Mimic picks (SIL-driven copy + image prompts)
 */
import {
  FLOW_VISUAL_FIRST_CAROUSEL,
  isVisualFirstCarouselFlow,
} from "./visual-first-carousel-flow-types.js";
import {
  FLOW_WHY_MIMIC_CAROUSEL,
  isWhyMimicCarouselFlow,
} from "./why-mimic-carousel-flow-types.js";

export { FLOW_VISUAL_FIRST_CAROUSEL, isVisualFirstCarouselFlow } from "./visual-first-carousel-flow-types.js";
export { FLOW_WHY_MIMIC_CAROUSEL, isWhyMimicCarouselFlow } from "./why-mimic-carousel-flow-types.js";
export const FLOW_TOP_PERFORMER_MIMIC_VIDEO = "FLOW_TOP_PERFORMER_MIMIC_VIDEO";
export const FLOW_TOP_PERFORMER_MIMIC_CAROUSEL = "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL";
export const FLOW_TOP_PERFORMER_MIMIC_IMAGE = "FLOW_TOP_PERFORMER_MIMIC_IMAGE";

export const TOP_PERFORMER_MIMIC_FLOW_TYPES = [
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
] as const;

export type TopPerformerMimicFlowType = (typeof TOP_PERFORMER_MIMIC_FLOW_TYPES)[number];

export function isTopPerformerMimicFlow(flowType: string): boolean {
  const ft = (flowType ?? "").trim();
  return (TOP_PERFORMER_MIMIC_FLOW_TYPES as readonly string[]).includes(ft);
}

export function isTopPerformerMimicImageFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_IMAGE;
}

export function isTopPerformerMimicCarouselFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_TOP_PERFORMER_MIMIC_CAROUSEL;
}

/** Manual mimic carousel, visual-first, or Why Mimic — same TP-grounded render engine. */
export function isTpGroundedCarouselRenderFlow(flowType: string): boolean {
  return (
    isTopPerformerMimicCarouselFlow(flowType) ||
    isVisualFirstCarouselFlow(flowType) ||
    isWhyMimicCarouselFlow(flowType)
  );
}

/** Image + TP-grounded carousel flows wired to MIMIC_IMAGE_PROVIDER (BFL, DashScope, NVIDIA, or OpenAI). */
export function isTopPerformerMimicRenderableFlow(flowType: string): boolean {
  return isTopPerformerMimicImageFlow(flowType) || isTpGroundedCarouselRenderFlow(flowType);
}

export const TOP_PERFORMER_MIMIC_FLOW_NOT_READY_MESSAGE =
  "Top-performer mimic copy generation requires OPENAI_API_KEY.";

export const TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE =
  "Top-performer mimic render requires MIMIC_IMAGE_ENABLED=1, a configured MIMIC_IMAGE_PROVIDER (BFL_API_KEY, DASHSCOPE_API_KEY, NVIDIA_NIM_API_KEY, or OPENAI_API_KEY), and archived top-performer inspection media on the signal pack.";
