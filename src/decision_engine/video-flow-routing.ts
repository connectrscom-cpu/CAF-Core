/**
 * Route format=video planner rows to one of three HeyGen families (scene assembly excluded).
 */
import { CANONICAL_FLOW_TYPES, resolveCanonicalFlowType } from "../domain/canonical-flow-types.js";
import {
  defaultProductFlowHeygenMode,
  isProductVideoFlow,
  type ProductHeygenMode,
} from "../domain/product-flow-types.js";
import { isVideoFlow } from "./flow-kind.js";
import { DEFAULT_VIDEO_FLOW_PLAN_CAP } from "./default-plan-caps.js";

export type VideoPipelineIntent = "script_avatar" | "prompt_avatar" | "no_avatar";

export type VideoRouteConfidence = "explicit" | "heuristic" | "platform" | "default";

export interface VideoRouteDecision {
  intent: VideoPipelineIntent;
  reason: string;
  confidence: VideoRouteConfidence;
}

export interface VideoRoutingConfig {
  enabled: boolean;
  default_intent: VideoPipelineIntent;
  platform_overrides: Record<string, VideoPipelineIntent>;
}

export const DEFAULT_VIDEO_ROUTING: VideoRoutingConfig = {
  enabled: true,
  default_intent: "prompt_avatar",
  platform_overrides: {
    Reddit: "no_avatar",
    reddit: "no_avatar",
  },
};

const VALID_INTENTS = new Set<VideoPipelineIntent>(["script_avatar", "prompt_avatar", "no_avatar"]);

/** Canonical + legacy flow_type keys per intent (first match among enabled wins). */
export const FLOW_KEYS_BY_VIDEO_INTENT: Record<VideoPipelineIntent, readonly string[]> = {
  script_avatar: [
    CANONICAL_FLOW_TYPES.VID_SCRIPT,
    "Video_Script_Generator",
    "Video_Script_HeyGen_Avatar",
    "HeyGen_Avatar_Script",
    "FLOW_HEYGEN_AVATAR_SCRIPT",
    "HEYGEN_AVATAR_SCRIPT",
  ],
  prompt_avatar: [
    CANONICAL_FLOW_TYPES.VID_PROMPT,
    "Video_Prompt_Generator",
    "Video_Prompt_HeyGen_Avatar",
    "HeyGen_Avatar_Prompt",
    "FLOW_HEYGEN_AVATAR_PROMPT",
    "HEYGEN_AVATAR_PROMPT",
  ],
  no_avatar: [
    CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR,
    "Video_Prompt_HeyGen_NoAvatar",
    "HeyGen_NoAvatar_Prompt",
    "FLOW_HEYGEN_NO_AVATAR_PROMPT",
    "HeyGen_No_Avatar_Prompt",
    "Heygen_NoAvatar_Prompt",
    "HEYGEN_NO_AVATAR_PROMPT",
  ],
};

const BROLL_HINTS =
  /\b(b[- ]?roll|broll|stock footage|montage|visual only|no (?:talking )?head|no presenter|no avatar|motion graphics|graphics[- ]only|voice[- ]over only)\b/i;
const SCRIPT_HINTS =
  /\b(spoken script|word[- ]for[- ]word|verbatim script|script[- ]led|talking head reads|avatar reads)\b/i;

export function normalizeVideoStyle(raw: unknown): VideoPipelineIntent | null {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/-/g, "_");
  if (!s) return null;
  if (s === "script_avatar" || s === "script" || s === "script_led") return "script_avatar";
  if (s === "prompt_avatar" || s === "prompt" || s === "prompt_led") return "prompt_avatar";
  if (s === "no_avatar" || s === "noavatar" || s === "b_roll" || s === "broll") return "no_avatar";
  if (s === "multi_scene" || s === "multiscene" || s === "scene") return "no_avatar";
  return null;
}

export function parseVideoRoutingConfig(raw: unknown, fallback: VideoRoutingConfig = DEFAULT_VIDEO_ROUTING): VideoRoutingConfig {
  if (raw == null) return { ...fallback };
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ...fallback };
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else {
    return { ...fallback };
  }

  const enabled = obj.enabled === false ? false : obj.enabled === true ? true : fallback.enabled;
  const defRaw = normalizeVideoStyle(obj.default_intent) ?? fallback.default_intent;
  const platform_overrides: Record<string, VideoPipelineIntent> = { ...fallback.platform_overrides };
  const po = obj.platform_overrides;
  if (po && typeof po === "object" && !Array.isArray(po)) {
    for (const [k, v] of Object.entries(po as Record<string, unknown>)) {
      const intent = normalizeVideoStyle(v);
      if (intent && k.trim()) platform_overrides[k.trim()] = intent;
    }
  }
  return { enabled, default_intent: defRaw, platform_overrides };
}

export function resolveVideoIntent(
  row: Record<string, unknown>,
  cfg: VideoRoutingConfig
): VideoRouteDecision {
  const explicit =
    normalizeVideoStyle(row.video_style) ??
    normalizeVideoStyle(row.video_pipeline) ??
    normalizeVideoStyle(row.video_intent);
  if (explicit) {
    return { intent: explicit, confidence: "explicit", reason: "video_style on planner row" };
  }

  const platform = String(row.platform ?? row.target_platform ?? "").trim();
  if (platform && cfg.platform_overrides[platform]) {
    return {
      intent: cfg.platform_overrides[platform]!,
      confidence: "platform",
      reason: `platform override (${platform})`,
    };
  }
  const platformLower = platform.toLowerCase();
  for (const [k, intent] of Object.entries(cfg.platform_overrides)) {
    if (k.toLowerCase() === platformLower) {
      return { intent, confidence: "platform", reason: `platform override (${k})` };
    }
  }

  const text = [
    row.summary,
    row.content_idea,
    row.three_liner,
    row.thesis,
    row.novelty_angle,
  ]
    .filter(Boolean)
    .join(" ");
  if (SCRIPT_HINTS.test(text)) {
    return { intent: "script_avatar", confidence: "heuristic", reason: "script-led language in idea copy" };
  }
  if (BROLL_HINTS.test(text)) {
    return { intent: "no_avatar", confidence: "heuristic", reason: "b-roll / no-presenter language in idea copy" };
  }

  return {
    intent: cfg.default_intent,
    confidence: "default",
    reason: "project default_intent",
  };
}

export function productHeygenModeMatchesIntent(
  mode: ProductHeygenMode | null | undefined,
  intent: VideoPipelineIntent
): boolean {
  if (!mode) return false;
  if (intent === "script_avatar") return mode === "script_led";
  if (intent === "prompt_avatar") return mode === "prompt_led";
  return false;
}

export function flowTypeMatchesVideoIntent(
  flowType: string,
  intent: VideoPipelineIntent,
  productMode: ProductHeygenMode | null | undefined
): boolean {
  const ft = flowType.trim();
  if (!ft || shouldExcludeFlowFromVideoRouting(ft)) return false;

  if (isProductVideoFlow(ft)) {
    const mode = productMode ?? defaultProductFlowHeygenMode(ft);
    return productHeygenModeMatchesIntent(mode, intent);
  }

  const canonical = resolveCanonicalFlowType(ft);
  const keys = FLOW_KEYS_BY_VIDEO_INTENT[intent];
  if (keys.includes(ft) || keys.includes(canonical)) return true;

  if (intent === "script_avatar") {
    return /video_script|script_generator|Script_HeyGen/i.test(ft);
  }
  if (intent === "no_avatar") {
    return /no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft);
  }
  if (intent === "prompt_avatar") {
    return (
      /video_prompt|prompt_generator|Prompt_HeyGen/i.test(ft) &&
      !/no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)
    );
  }
  return false;
}

export function isVideoFormatRow(row: Record<string, unknown>): boolean {
  const f = String(row.format ?? "")
    .toLowerCase()
    .trim();
  return f === "video";
}

export interface EnabledFlowRef {
  flow_type: string;
  priority_weight: number | null;
}

/**
 * Pick one enabled flow_type for a routed video row (highest priority_weight first).
 * Core HeyGen flows (FLOW_VID_*) win over FLOW_PRODUCT_* so organic video ideas are not
 * routed to product marketing flows that may be enabled but plan-capped at 0.
 */
export function pickVideoFlowForIntent(
  enabledFlows: EnabledFlowRef[],
  intent: VideoPipelineIntent,
  productModes: Map<string, ProductHeygenMode | null>
): string | null {
  const sorted = [...enabledFlows].sort(
    (a, b) => Number(b.priority_weight ?? 0) - Number(a.priority_weight ?? 0)
  );
  const core = sorted.filter((f) => !isProductVideoFlow(f.flow_type));
  const product = sorted.filter((f) => isProductVideoFlow(f.flow_type));
  for (const bucket of [core, product]) {
    for (const f of bucket) {
      const mode = productModes.get(f.flow_type) ?? null;
      if (flowTypeMatchesVideoIntent(f.flow_type, intent, mode)) return f.flow_type;
    }
  }
  return null;
}

export function isSceneAssemblyFlowType(flowType: string): boolean {
  const t = flowType.trim();
  if (!t) return false;
  if (t === CANONICAL_FLOW_TYPES.VID_SCENES) return true;
  const compact = t.toUpperCase().replace(/_/g, "");
  if (compact.includes("SCENEASSEMBLY") || compact.includes("VIDEOSCENEASSEMBLY")) return true;
  if (/video_scene_generator/i.test(t)) return true;
  return /scene_assembly/i.test(t);
}

export function shouldExcludeFlowFromVideoRouting(flowType: string): boolean {
  return isSceneAssemblyFlowType(flowType);
}

export const CORE_VIDEO_INTENTS: readonly VideoPipelineIntent[] = [
  "prompt_avatar",
  "script_avatar",
  "no_avatar",
];

export interface VideoPlanningCaps {
  maxVideoPlan: number;
  perFlowCaps: Record<string, number>;
}

/** Tracks remaining per-flow and aggregate video slots while building candidates. */
export class VideoPlanningSlotBudget {
  private aggregateRemaining: number;
  private readonly byFlow = new Map<string, number>();

  constructor(
    enabledFlows: EnabledFlowRef[],
    caps: VideoPlanningCaps,
    defaultFlowCap: number = DEFAULT_VIDEO_FLOW_PLAN_CAP
  ) {
    this.aggregateRemaining = Math.max(0, caps.maxVideoPlan);
    for (const f of enabledFlows) {
      if (!isVideoFlow(f.flow_type) || shouldExcludeFlowFromVideoRouting(f.flow_type)) continue;
      const cap = caps.perFlowCaps[f.flow_type] ?? defaultFlowCap;
      this.byFlow.set(f.flow_type, Math.max(0, cap));
    }
  }

  canAssign(flowType: string): boolean {
    if (this.aggregateRemaining <= 0) return false;
    const rem = this.byFlow.get(flowType);
    return rem !== undefined && rem > 0;
  }

  assign(flowType: string): void {
    if (!this.canAssign(flowType)) return;
    this.aggregateRemaining -= 1;
    this.byFlow.set(flowType, (this.byFlow.get(flowType) ?? 0) - 1);
  }
}

function dedupeIntents(intents: VideoPipelineIntent[]): VideoPipelineIntent[] {
  const seen = new Set<VideoPipelineIntent>();
  const out: VideoPipelineIntent[] = [];
  for (const intent of intents) {
    if (seen.has(intent)) continue;
    seen.add(intent);
    out.push(intent);
  }
  return out;
}

/** Intent try-order: honor explicit/heuristic rows; distribute default rows across open lanes. */
export function buildVideoIntentTryOrder(
  route: VideoRouteDecision,
  platform: string,
  _cfg: VideoRoutingConfig
): VideoPipelineIntent[] {
  const natural = route.intent;
  if (route.confidence === "explicit" || route.confidence === "heuristic") {
    return [natural];
  }

  const platformLower = platform.toLowerCase().trim();
  let fill: VideoPipelineIntent[] = [...CORE_VIDEO_INTENTS];
  if (platformLower === "tiktok" || platformLower === "reddit") {
    fill = ["no_avatar", "prompt_avatar", "script_avatar"];
  }
  return dedupeIntents([natural, ...fill]);
}

export interface VideoFlowAssignment {
  flowType: string;
  route: VideoRouteDecision;
  matchedIntent: VideoPipelineIntent;
  assignment: "natural" | "slot_fill";
}

/**
 * Pick a video flow for one planner row, consuming one planning slot when caps are provided.
 * Without a budget, falls back to natural intent only (legacy behavior).
 */
export function assignVideoFlowForPlanningRow(
  row: Record<string, unknown>,
  cfg: VideoRoutingConfig,
  enabledFlows: EnabledFlowRef[],
  productModes: Map<string, ProductHeygenMode | null>,
  budget?: VideoPlanningSlotBudget
): VideoFlowAssignment | null {
  const platform = String(row.platform ?? row.target_platform ?? "Instagram");
  const route = resolveVideoIntent(row, cfg);
  const tryOrder = budget
    ? buildVideoIntentTryOrder(route, platform, cfg)
    : [route.intent];

  for (const intent of tryOrder) {
    const flowType = pickVideoFlowForIntent(enabledFlows, intent, productModes);
    if (!flowType) continue;
    if (budget && !budget.canAssign(flowType)) continue;

    if (budget) budget.assign(flowType);
    const assignment: VideoFlowAssignment["assignment"] =
      intent === route.intent ? "natural" : "slot_fill";
    return {
      flowType,
      matchedIntent: intent,
      assignment,
      route: {
        intent: route.intent,
        reason: route.reason,
        confidence: route.confidence,
      },
    };
  }

  return null;
}
