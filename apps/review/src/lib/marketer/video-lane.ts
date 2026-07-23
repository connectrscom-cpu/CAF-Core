/** HeyGen video lanes for top-performer video references (mirrors Core video-flow-routing). */

export type VideoPipelineIntent = "script_avatar" | "prompt_avatar" | "no_avatar" | "hook_first" | "ugc";

export const VIDEO_LANE_OPTIONS: ReadonlyArray<{
  id: VideoPipelineIntent;
  label: string;
  flowTypeRaw: string;
  description: string;
}> = [
  {
    id: "script_avatar",
    label: "Script avatar",
    flowTypeRaw: "FLOW_VID_SCRIPT",
    description: "Avatar reads a verbatim spoken script (talking head).",
  },
  {
    id: "prompt_avatar",
    label: "Prompt avatar",
    flowTypeRaw: "FLOW_VID_PROMPT",
    description: "HeyGen Video Agent with on-camera avatar (product demo, mixed formats).",
  },
  {
    id: "no_avatar",
    label: "Prompt · no avatar",
    flowTypeRaw: "FLOW_VID_PROMPT_NO_AVATAR",
    description: "Voice-over, b-roll, motion graphics — no on-camera presenter.",
  },
  {
    id: "hook_first",
    label: "Hook-first hybrid",
    flowTypeRaw: "FLOW_VID_HOOK_FIRST",
    description: "Cinematic AI hook (matching presenter voice) + avatar Video Agent body with B-roll.",
  },
  {
    id: "ugc",
    label: "UGC creator",
    flowTypeRaw: "FLOW_VID_UGC",
    description: "Peer-voice UGC script + creator hosts from brand/product bible.",
  },
] as const;

export function flowTypeForVideoIntent(intent: VideoPipelineIntent): string {
  return VIDEO_LANE_OPTIONS.find((o) => o.id === intent)?.flowTypeRaw ?? "FLOW_VID_PROMPT";
}

/** Map a cart / planner FLOW_VID_* selection back to a HeyGen lane intent. */
export function videoIntentFromFlowType(flowTypeRaw: string): VideoPipelineIntent | undefined {
  const flow = String(flowTypeRaw ?? "").trim().toUpperCase();
  return VIDEO_LANE_OPTIONS.find((o) => o.flowTypeRaw === flow)?.id;
}

export function labelForVideoIntent(intent: VideoPipelineIntent): string {
  return VIDEO_LANE_OPTIONS.find((o) => o.id === intent)?.label ?? "Video";
}

/** Lanes that put an on-camera HeyGen presenter in the video. */
export function videoLaneNeedsAvatar(
  intent: VideoPipelineIntent | string | null | undefined
): boolean {
  const id = String(intent ?? "").trim();
  if (!id) return false;
  if (id === "no_avatar") return false;
  if (id === "script_avatar" || id === "prompt_avatar" || id === "hook_first" || id === "ugc") {
    return true;
  }
  const flow = id.toUpperCase();
  if (flow.includes("NO_AVATAR") || flow.includes("HEYGEN_NO")) return false;
  return (
    flow === "FLOW_VID_SCRIPT" ||
    flow === "FLOW_VID_PROMPT" ||
    flow === "FLOW_VID_HOOK_FIRST" ||
    flow === "FLOW_VID_UGC" ||
    /FLOW_PRODUCT_/i.test(flow)
  );
}

/** Prefer UGC host pool in the cart picker for UGC / product-UGC lanes. */
export function videoLaneUsesUgcPresenters(
  intent: VideoPipelineIntent | string | null | undefined
): boolean {
  const id = String(intent ?? "").trim();
  if (id === "ugc") return true;
  const flow = id.toUpperCase();
  return flow === "FLOW_VID_UGC" || /UGC/i.test(flow);
}

/** CAF-recommended lane from Nemotron `format_pattern` (same rules as Core). */
export function resolveRecommendedVideoIntent(formatPattern: string): VideoPipelineIntent {
  const pattern = String(formatPattern ?? "")
    .toLowerCase()
    .trim();

  if (pattern === "talking_head") return "script_avatar";
  if (pattern === "ugc") return "ugc";
  if (pattern === "product_demo" || pattern === "mixed") return "prompt_avatar";
  if (pattern === "b_roll" || pattern === "text_on_screen") return "no_avatar";
  return "prompt_avatar";
}

export function isVideoTopPerformerItem(item: {
  kind?: string;
  videoIntent?: VideoPipelineIntent;
  flowTypeRaw?: string;
  format?: string;
}): boolean {
  if (item.videoIntent) return true;
  const flow = String(item.flowTypeRaw ?? "").toUpperCase();
  if (flow.includes("FLOW_VID_") || flow.includes("FLOW_TOP_PERFORMER_MIMIC_VIDEO")) return true;
  const fmt = String(item.format ?? "").toLowerCase();
  return (
    fmt.includes("video") ||
    /^(talking_head|ugc|product_demo|mixed|b_roll|text_on_screen|story)$/.test(fmt)
  );
}
