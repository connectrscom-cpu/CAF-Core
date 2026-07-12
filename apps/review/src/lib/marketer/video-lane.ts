/** HeyGen video lanes for top-performer video references (mirrors Core video-flow-routing). */

export type VideoPipelineIntent = "script_avatar" | "prompt_avatar" | "no_avatar" | "hook_first";

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
    description: "Avatar reads a verbatim spoken script (talking head / UGC).",
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
    description: "Cinematic AI hook clip (4–8s) + HeyGen body — stitched in CAF.",
  },
] as const;

export function flowTypeForVideoIntent(intent: VideoPipelineIntent): string {
  return VIDEO_LANE_OPTIONS.find((o) => o.id === intent)?.flowTypeRaw ?? "FLOW_VID_PROMPT";
}

export function labelForVideoIntent(intent: VideoPipelineIntent): string {
  return VIDEO_LANE_OPTIONS.find((o) => o.id === intent)?.label ?? "Video";
}

/** CAF-recommended lane from Nemotron `format_pattern` (same rules as Core). */
export function resolveRecommendedVideoIntent(formatPattern: string): VideoPipelineIntent {
  const pattern = String(formatPattern ?? "")
    .toLowerCase()
    .trim();

  if (pattern === "talking_head" || pattern === "ugc") return "script_avatar";
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
