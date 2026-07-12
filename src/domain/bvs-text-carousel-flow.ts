/**
 * BVS-backed text carousel (`FLOW_CAROUSEL` + `use_brand_visual_system`).
 *
 * Copy stays on the standard carousel LLM path; render/review reuse the TP-grounded
 * overlay engine (`mimic_v1` template_bg + DocAI layer editor + reprint loop).
 */
import { CANONICAL_FLOW_TYPES, resolveCanonicalFlowType } from "./canonical-flow-types.js";
import { parseBvsFromPayload } from "./bvs-v1.js";
import { pickMimicPayload } from "./mimic-payload.js";
import { isTpGroundedCarouselRenderFlow } from "./top-performer-mimic-flow-types.js";

export const BVS_TEXT_CAROUSEL_EXECUTION_MODE = "bvs_text_carousel" as const;
export const BVS_TEXT_CAROUSEL_SOURCE_ID = "bvs_text_carousel" as const;

export function isStandardCarouselFlow(flowType: string): boolean {
  return resolveCanonicalFlowType(flowType) === CANONICAL_FLOW_TYPES.CAROUSEL;
}

/** Planned or post-prep job uses BVS text-carousel overlay lane. */
export function isBvsTextCarouselOverlayRender(
  flowType: string,
  payload: Record<string, unknown> | null | undefined
): boolean {
  if (!isStandardCarouselFlow(flowType)) return false;
  const bvs = parseBvsFromPayload(payload);
  if (!bvs?.enabled) return false;
  const mimic = pickMimicPayload(payload);
  if (!mimic || mimic.mode !== "template_bg" || mimic.bvs_enabled !== true) return false;
  return (
    mimic.execution_mode === BVS_TEXT_CAROUSEL_EXECUTION_MODE ||
    mimic.source_insights_id === BVS_TEXT_CAROUSEL_SOURCE_ID
  );
}

/** TP-grounded mimic flows or BVS text carousel — same overlay render engine. */
export function isCarouselMimicOverlayRenderJob(
  flowType: string,
  payload: Record<string, unknown> | null | undefined
): boolean {
  if (isTpGroundedCarouselRenderFlow(flowType)) return true;
  return isBvsTextCarouselOverlayRender(flowType, payload);
}
