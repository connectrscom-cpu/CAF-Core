/** Mirrors Core `decision_engine/flow-kind` for Review UI (carousel vs video publish routing). */

export function isCarouselFlow(flowType: string): boolean {
  return /carousel/i.test(flowType) || flowType === "Flow_Carousel_Copy";
}

export function isVideoFlow(flowType: string): boolean {
  const ft = flowType ?? "";
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

export function inferPublishContentFormat(flowType: string | null | undefined): "carousel" | "video" | "unknown" {
  const ft = String(flowType ?? "");
  if (isCarouselFlow(ft)) return "carousel";
  if (isVideoFlow(ft)) return "video";
  return "unknown";
}
