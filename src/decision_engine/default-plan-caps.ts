/**
 * Default per-run generation-plan caps (each planned job / variation counts as 1).
 * Applied unless overridden for the same flow_type key in
 * project_system_constraints.max_jobs_per_flow_type (DB wins per key).
 */
/** Default planned jobs per video-classified flow_type when not in DB (incl. FLOW_VIDEO, Reel_Script, etc.). */
export const DEFAULT_VIDEO_FLOW_PLAN_CAP = 1;
const VIDEO_CAP = DEFAULT_VIDEO_FLOW_PLAN_CAP;

/** Default planned jobs (incl. variations) per carousel-classified flow_type when not overridden in DB. */
export const DEFAULT_CAROUSEL_FLOW_PLAN_CAP = 5;
const CAROUSEL_CAP = DEFAULT_CAROUSEL_FLOW_PLAN_CAP;

/** Synonyms per logical video flow — Flow Engine workbook names first; legacy CAF aliases kept for caps. */
const DEFAULT_VIDEO_FLOW_GROUPS: readonly (readonly string[])[] = [
  // Flow Engine + legacy scene / multi-scene
  [
    "Video_Scene_Generator",
    "Scene_Assembly",
    "FLOW_SCENE_ASSEMBLY",
    "Flow_Scene_Assembly",
    "scene_assembly",
    "VIDEO_SCENE_ASSEMBLY",
  ],
  // Script-led single video
  [
    "Video_Script_Generator",
    "HeyGen_Avatar_Script",
    "FLOW_HEYGEN_AVATAR_SCRIPT",
    "Heygen_Avatar_Script",
    "HEYGEN_AVATAR_SCRIPT",
    "Video_Script_HeyGen_Avatar",
  ],
  // Prompt-led single video (avatar vs no-avatar = HeyGen config, not flow_type)
  [
    "Video_Prompt_Generator",
    "HeyGen_Avatar_Prompt",
    "FLOW_HEYGEN_AVATAR_PROMPT",
    "Heygen_Avatar_Prompt",
    "HEYGEN_AVATAR_PROMPT",
    "Video_Prompt_HeyGen_Avatar",
    "Video_Prompt_HeyGen_NoAvatar",
    "HeyGen_NoAvatar_Prompt",
    "FLOW_HEYGEN_NO_AVATAR_PROMPT",
    "HeyGen_No_Avatar_Prompt",
    "Heygen_NoAvatar_Prompt",
    "HEYGEN_NO_AVATAR_PROMPT",
  ],
  // Optional render-only step in workbook (if used as its own job)
  ["HeyGen_Render_Video"],
];

/** Carousel-like flow_type keys (matches decision_engine isCarouselFlow naming). */
const DEFAULT_CAROUSEL_FLOW_GROUPS: readonly (readonly string[])[] = [
  ["FLOW_CAROUSEL", "Flow_Carousel_Copy", "FLOW_CAROUSEL_COPY", "Carousel", "FLOW_CAROUSEL_STANDARD"],
];

export function defaultMaxJobsPerFlowType(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of DEFAULT_VIDEO_FLOW_GROUPS) {
    for (const k of group) {
      out[k] = VIDEO_CAP;
    }
  }
  for (const group of DEFAULT_CAROUSEL_FLOW_GROUPS) {
    for (const k of group) {
      out[k] = CAROUSEL_CAP;
    }
  }
  return out;
}
