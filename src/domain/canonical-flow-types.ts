import { PRODUCT_VIDEO_FLOW_TYPES } from "./product-flow-types.js";

/**
 * Canonical flow_type values for planning — these are the *new* short identifiers used across
 * Flow Engine rows and CAF Core job planning. Legacy flow_type strings are still accepted
 * through the alias resolver below so existing jobs and integrations keep working.
 */
export interface CanonicalAllowedFlowSeed {
  flow_type: string;
  default_variation_count: number;
  requires_signal_pack: boolean;
  priority_weight: number;
  notes: string;
  /** null = all platforms from signal pack */
  allowed_platforms: string | null;
}

export const CANONICAL_FLOW_TYPES = {
  CAROUSEL: "FLOW_CAROUSEL",
  ANGLE: "FLOW_ANGLE",
  STRUCTURE: "FLOW_STRUCTURE",
  CTA: "FLOW_CTA",
  HOOKS: "FLOW_HOOKS",
  TEXT: "FLOW_TEXT",
  VID_PROMPT: "FLOW_VID_PROMPT",
  VID_SCRIPT: "FLOW_VID_SCRIPT",
  VID_SCENES: "FLOW_VID_SCENES",
} as const;

export type CanonicalFlowType = (typeof CANONICAL_FLOW_TYPES)[keyof typeof CANONICAL_FLOW_TYPES];

/** FLOW_PRODUCT_* → canonical video flow (prompt-led by default). */
const PRODUCT_VIDEO_LEGACY_MAP: Record<string, CanonicalFlowType> = Object.fromEntries(
  PRODUCT_VIDEO_FLOW_TYPES.map((ft) => [ft, CANONICAL_FLOW_TYPES.VID_PROMPT])
);

/**
 * Legacy planner / job `flow_type` → canonical flow_type.
 * Keep this map additive; it is the compatibility layer for historical task_ids and external callers.
 */
export const LEGACY_FLOW_TYPE_TO_CANONICAL: Readonly<Record<string, CanonicalFlowType>> = {
  ...PRODUCT_VIDEO_LEGACY_MAP,
  Flow_Carousel_Copy: CANONICAL_FLOW_TYPES.CAROUSEL,
  Carousel_Angle_Extractor: CANONICAL_FLOW_TYPES.ANGLE,
  Carousel_Slide_Architecture: CANONICAL_FLOW_TYPES.STRUCTURE,
  CTA_Generator: CANONICAL_FLOW_TYPES.CTA,
  Hook_Variations: CANONICAL_FLOW_TYPES.HOOKS,
  Text_Post_Generator: CANONICAL_FLOW_TYPES.TEXT,
  Video_Prompt_Generator: CANONICAL_FLOW_TYPES.VID_PROMPT,
  Video_Script_Generator: CANONICAL_FLOW_TYPES.VID_SCRIPT,
  Video_Scene_Generator: CANONICAL_FLOW_TYPES.VID_SCENES,
  // Scene assembly legacy aliases
  FLOW_SCENE_ASSEMBLY: CANONICAL_FLOW_TYPES.VID_SCENES,
  Flow_Scene_Assembly: CANONICAL_FLOW_TYPES.VID_SCENES,
  VIDEO_SCENE_ASSEMBLY: CANONICAL_FLOW_TYPES.VID_SCENES,
  Scene_Assembly: CANONICAL_FLOW_TYPES.VID_SCENES,
  // HeyGen legacy flow aliases
  Video_Script_HeyGen_Avatar: CANONICAL_FLOW_TYPES.VID_SCRIPT,
  Video_Prompt_HeyGen_Avatar: CANONICAL_FLOW_TYPES.VID_PROMPT,
  Video_Prompt_HeyGen_NoAvatar: CANONICAL_FLOW_TYPES.VID_PROMPT,
};

export function resolveCanonicalFlowType(flowType: string): string {
  const t = (flowType ?? "").trim();
  return LEGACY_FLOW_TYPE_TO_CANONICAL[t] ?? t;
}

export function resolveFlowEngineTemplateFlowType(flowType: string): string {
  return resolveCanonicalFlowType(flowType);
}

export const CANONICAL_ALLOWED_FLOW_SEEDS: readonly CanonicalAllowedFlowSeed[] = [
  {
    flow_type: CANONICAL_FLOW_TYPES.CAROUSEL,
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 10,
    allowed_platforms: null,
    notes: "Carousel — publishable carousel copy JSON",
  },
  {
    flow_type: CANONICAL_FLOW_TYPES.VID_SCENES,
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 9,
    allowed_platforms: null,
    notes: "Multi-scene video — scene_bundle; per-scene clips rendered upstream (URLs on scenes) → Core concat/mux",
  },
  {
    flow_type: CANONICAL_FLOW_TYPES.VID_SCRIPT,
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 8,
    allowed_platforms: null,
    notes: "Single video — script JSON → HeyGen (script path)",
  },
  {
    flow_type: CANONICAL_FLOW_TYPES.VID_PROMPT,
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 7,
    allowed_platforms: null,
    notes: "Single video — prompt JSON → HeyGen (prompt path; avatar via heygen_config)",
  },
] as const;
