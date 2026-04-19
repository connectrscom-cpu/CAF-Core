import { PRODUCT_VIDEO_FLOW_TYPES } from "../domain/product-flow-types.js";

/**
 * Default per-run generation-plan caps (each planned job / variation counts as 1).
 * Applied unless overridden for the same flow_type key in
 * project_system_constraints.max_jobs_per_flow_type (DB wins per key).
 */
/** Default planned jobs per video-classified flow_type when not in DB (incl. FLOW_VIDEO, Reel_Script, etc.). */
export const DEFAULT_VIDEO_FLOW_PLAN_CAP = 1;
const VIDEO_CAP = DEFAULT_VIDEO_FLOW_PLAN_CAP;

/** Default planned jobs (incl. variations) per carousel-classified flow_type when not overridden in DB. */
export const DEFAULT_CAROUSEL_FLOW_PLAN_CAP = 10;
const CAROUSEL_CAP = DEFAULT_CAROUSEL_FLOW_PLAN_CAP;

/**
 * Video flow_type keys grouped for admin UX: one cap applies to every synonym in `keys`.
 * Keep in sync with `defaultMaxJobsPerFlowType` video entries.
 */
export const VIDEO_PLAN_CAP_GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly keys: readonly string[];
}[] = [
  {
    id: "scene_assembly",
    label: "Scene / assembly (multi-scene)",
    keys: [
      "Video_Scene_Generator",
      "Scene_Assembly",
      "FLOW_SCENE_ASSEMBLY",
      "Flow_Scene_Assembly",
      "scene_assembly",
      "VIDEO_SCENE_ASSEMBLY",
    ],
  },
  {
    id: "script_video",
    label: "Script-led video (HeyGen avatar script)",
    keys: [
      "Video_Script_Generator",
      "HeyGen_Avatar_Script",
      "FLOW_HEYGEN_AVATAR_SCRIPT",
      "Heygen_Avatar_Script",
      "HEYGEN_AVATAR_SCRIPT",
      "Video_Script_HeyGen_Avatar",
    ],
  },
  {
    id: "prompt_video_avatar",
    label: "Prompt-led video (HeyGen avatar)",
    keys: [
      // Canonical Flow Engine row — avatar mode is the default for Video_Prompt_Generator;
      // the no-avatar split below only catches the explicit *NoAvatar* / *NO_AVATAR* synonyms.
      "Video_Prompt_Generator",
      "HeyGen_Avatar_Prompt",
      "FLOW_HEYGEN_AVATAR_PROMPT",
      "Heygen_Avatar_Prompt",
      "HEYGEN_AVATAR_PROMPT",
      "Video_Prompt_HeyGen_Avatar",
    ],
  },
  {
    id: "prompt_video_no_avatar",
    label: "Prompt-led video (HeyGen no-avatar)",
    keys: [
      "Video_Prompt_HeyGen_NoAvatar",
      "HeyGen_NoAvatar_Prompt",
      "FLOW_HEYGEN_NO_AVATAR_PROMPT",
      "HeyGen_No_Avatar_Prompt",
      "Heygen_NoAvatar_Prompt",
      "HEYGEN_NO_AVATAR_PROMPT",
    ],
  },
  {
    id: "heygen_render",
    label: "HeyGen render-only step",
    keys: ["HeyGen_Render_Video"],
  },
  {
    id: "product_video",
    label: "Product marketing video (FLOW_PRODUCT_*)",
    keys: [...PRODUCT_VIDEO_FLOW_TYPES],
  },
] as const;

const DEFAULT_VIDEO_FLOW_GROUPS: readonly (readonly string[])[] = VIDEO_PLAN_CAP_GROUPS.map((g) => g.keys);

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
