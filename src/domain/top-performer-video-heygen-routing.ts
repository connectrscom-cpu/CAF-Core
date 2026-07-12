/**
 * Route Nemotron top_performer_video insights into existing HeyGen flow families.
 * Video top performers do not use pixel mimic — they use FLOW_VID_SCRIPT / PROMPT / NO_AVATAR.
 */
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import type { VideoPipelineIntent } from "../decision_engine/video-flow-routing.js";
import { normalizeVideoStyle } from "../decision_engine/video-flow-routing.js";

export interface TopPerformerVideoHeygenRoute {
  intent: VideoPipelineIntent;
  flow_type: string;
  reason: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickString(rec: Record<string, unknown> | null, key: string): string {
  if (!rec) return "";
  const v = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Read Nemotron `format_pattern` from a visual-guidelines pack entry. */
export function readTopPerformerVideoFormatPattern(entry: Record<string, unknown> | null): string {
  if (!entry) return "";
  const direct = pickString(entry, "format_pattern");
  if (direct) return direct.toLowerCase();
  const aes = asRecord(entry.aesthetic_analysis_json);
  return pickString(aes, "format_pattern").toLowerCase();
}

function routeFromIntent(intent: VideoPipelineIntent, reason: string): TopPerformerVideoHeygenRoute {
  const flow_type =
    intent === "script_avatar"
      ? CANONICAL_FLOW_TYPES.VID_SCRIPT
      : intent === "no_avatar"
        ? CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR
        : intent === "hook_first"
          ? CANONICAL_FLOW_TYPES.VID_HOOK_FIRST
          : CANONICAL_FLOW_TYPES.VID_PROMPT;
  return { intent, flow_type, reason };
}

export interface TopPerformerVideoHeygenRouteOptions {
  /** Used when format_pattern is unknown or missing. */
  defaultIntent?: VideoPipelineIntent;
  /** Operator override from content cart — wins over format_pattern routing. */
  forceIntent?: VideoPipelineIntent;
}

/**
 * Map Nemotron video format_pattern → HeyGen intent + canonical flow_type.
 * Falls back to `defaultIntent` when pattern is unknown or missing.
 */
export function resolveTopPerformerVideoHeygenRoute(
  entry: Record<string, unknown> | null,
  defaultOrOptions: VideoPipelineIntent | TopPerformerVideoHeygenRouteOptions = "prompt_avatar"
): TopPerformerVideoHeygenRoute {
  const options: TopPerformerVideoHeygenRouteOptions =
    typeof defaultOrOptions === "string" ? { defaultIntent: defaultOrOptions } : defaultOrOptions;
  if (options.forceIntent) {
    return routeFromIntent(options.forceIntent, "operator_video_lane");
  }

  const defaultIntent = options.defaultIntent ?? "prompt_avatar";
  const pattern = readTopPerformerVideoFormatPattern(entry);

  if (pattern === "talking_head" || pattern === "ugc") {
    return {
      intent: "script_avatar",
      flow_type: CANONICAL_FLOW_TYPES.VID_SCRIPT,
      reason: `format_pattern=${pattern}`,
    };
  }
  if (pattern === "product_demo" || pattern === "mixed") {
    return {
      intent: "prompt_avatar",
      flow_type: CANONICAL_FLOW_TYPES.VID_PROMPT,
      reason: `format_pattern=${pattern}`,
    };
  }
  if (pattern === "b_roll" || pattern === "text_on_screen") {
    return {
      intent: "no_avatar",
      flow_type: CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR,
      reason: `format_pattern=${pattern}`,
    };
  }

  const intent = normalizeVideoStyle(defaultIntent) ?? defaultIntent;
  return routeFromIntent(intent, pattern ? `format_pattern=${pattern} (fallback)` : "default_intent");
}

/** Human label for admin mimic picker UI. */
export function heygenLaneLabelForIntent(intent: VideoPipelineIntent): string {
  switch (intent) {
    case "script_avatar":
      return "HeyGen · Script avatar";
    case "prompt_avatar":
      return "HeyGen · Prompt avatar";
    case "no_avatar":
      return "HeyGen · No avatar";
    case "hook_first":
      return "HeyGen · Hook-first hybrid";
  }
}

/** HeyGen flows used when operators pick top_performer_video references (not FLOW_TOP_PERFORMER_MIMIC_VIDEO). */
export const TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS = [
  CANONICAL_FLOW_TYPES.VID_SCRIPT,
  CANONICAL_FLOW_TYPES.VID_PROMPT,
  CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR,
] as const;
