/**
 * Shared carousel vs video classification for caps and pipeline branching.
 */
import { isProductVideoFlow } from "../domain/product-flow-types.js";

export function isCarouselFlow(flowType: string): boolean {
  return /carousel/i.test(flowType) || flowType === "Flow_Carousel_Copy";
}

/** Video-class flows: include HeyGen/scene names without the word "video" in flow_type. */
export function isVideoFlow(flowType: string): boolean {
  const ft = flowType ?? "";
  if (isProductVideoFlow(ft)) return true;
  if (isCarouselFlow(ft) && !/heygen|scene|Video_Script|Video_Prompt|Video_Scene|reel/i.test(ft)) {
    return false;
  }
  return (
    /video|reel/i.test(ft) ||
    /Video_Script|Video_Prompt|Video_Scene|Reel_Script/i.test(ft) ||
    /heygen|HeyGen_Render/i.test(ft) ||
    /scene_assembly|sceneassembly|FLOW_SCENE/i.test(ft)
  );
}
