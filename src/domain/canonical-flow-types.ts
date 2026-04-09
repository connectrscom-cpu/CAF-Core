/**
 * Canonical flow_type values for planning — **must match** `Flow Definitions` in the Flow Engine workbook
 * (same strings as `flow_type` column) so prompt_templates, output_schemas, and QC rows resolve.
 *
 * Video paths align with the workbook: `Video_Script_Generator`, `Video_Prompt_Generator`, `Video_Scene_Generator`.
 * Avatar vs no-avatar is handled by HeyGen config + pipeline, not separate flow_type rows.
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

/** Legacy planner / job `flow_type` → Flow Engine workbook `flow_type` for templates & schemas. */
export const LEGACY_FLOW_TYPE_TO_FLOW_ENGINE: Readonly<Record<string, string>> = {
  FLOW_SCENE_ASSEMBLY: "Video_Scene_Generator",
  Flow_Scene_Assembly: "Video_Scene_Generator",
  VIDEO_SCENE_ASSEMBLY: "Video_Scene_Generator",
  Scene_Assembly: "Video_Scene_Generator",
  Video_Script_HeyGen_Avatar: "Video_Script_Generator",
  Video_Prompt_HeyGen_Avatar: "Video_Prompt_Generator",
  Video_Prompt_HeyGen_NoAvatar: "Video_Prompt_Generator",
};

export function resolveFlowEngineTemplateFlowType(flowType: string): string {
  const t = (flowType ?? "").trim();
  return LEGACY_FLOW_TYPE_TO_FLOW_ENGINE[t] ?? t;
}

export const CANONICAL_ALLOWED_FLOW_SEEDS: readonly CanonicalAllowedFlowSeed[] = [
  {
    flow_type: "Flow_Carousel_Copy",
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 10,
    allowed_platforms: null,
    notes: "Carousel — Flow Engine Flow_Carousel_Copy + Carousel_Insight_Output",
  },
  {
    flow_type: "Video_Scene_Generator",
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 9,
    allowed_platforms: null,
    notes: "Multi-scene video — scene_bundle; per-scene clips rendered upstream (URLs on scenes) → Core concat/mux",
  },
  {
    flow_type: "Video_Script_Generator",
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 8,
    allowed_platforms: null,
    notes: "Single video — script JSON → HeyGen (script path)",
  },
  {
    flow_type: "Video_Prompt_Generator",
    default_variation_count: 1,
    requires_signal_pack: true,
    priority_weight: 7,
    allowed_platforms: null,
    notes: "Single video — prompt JSON → HeyGen (prompt path; avatar via heygen_config)",
  },
] as const;
