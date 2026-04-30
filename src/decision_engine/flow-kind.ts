/**
 * Shared carousel vs video classification for caps and pipeline branching.
 */
import { isProductVideoFlow } from "../domain/product-flow-types.js";
import { CANONICAL_FLOW_TYPES, resolveCanonicalFlowType } from "../domain/canonical-flow-types.js";

export function isCarouselFlow(flowType: string): boolean {
  const ft = resolveCanonicalFlowType(flowType);
  if (ft === CANONICAL_FLOW_TYPES.CAROUSEL) return true;
  // Legacy heuristic fallback (defensive for unmigrated DBs / ad-hoc flows)
  return /carousel/i.test(flowType) || flowType === "Flow_Carousel_Copy";
}

/** Video-class flows: include HeyGen/scene names without the word "video" in flow_type. */
export function isVideoFlow(flowType: string): boolean {
  const raw = flowType ?? "";
  const ft = resolveCanonicalFlowType(raw);
  if (isProductVideoFlow(raw)) return true;
  if (
    ft === CANONICAL_FLOW_TYPES.VID_PROMPT ||
    ft === CANONICAL_FLOW_TYPES.VID_SCRIPT ||
    ft === CANONICAL_FLOW_TYPES.VID_SCENES
  ) {
    return true;
  }
  if (isCarouselFlow(raw) && !/heygen|scene|Video_Script|Video_Prompt|Video_Scene|reel/i.test(raw)) {
    return false;
  }
  return (
    /video|reel/i.test(raw) ||
    /Video_Script|Video_Prompt|Video_Scene|Reel_Script/i.test(raw) ||
    /heygen|HeyGen_Render/i.test(raw) ||
    /scene_assembly|sceneassembly|FLOW_SCENE/i.test(raw)
  );
}
