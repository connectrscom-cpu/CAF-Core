import {
  FLOW_PRODUCT_COMPARISON,
  FLOW_PRODUCT_FEATURE,
  FLOW_PRODUCT_OFFER,
  FLOW_PRODUCT_PROBLEM,
  FLOW_PRODUCT_SOCIAL_PROOF,
  FLOW_PRODUCT_USECASE,
} from "../domain/product-flow-types.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
} from "../domain/top-performer-mimic-flow-types.js";

/**
 * Default per-run generation-plan caps (each planned job / variation counts as 1).
 * Applied unless overridden for the same flow_type key in
 * project_system_constraints.max_jobs_per_flow_type (DB wins per key).
 */
/** Default planned jobs per video-classified flow_type when not in DB (incl. FLOW_VIDEO, Reel_Script, etc.). */
export const DEFAULT_VIDEO_FLOW_PLAN_CAP = 1;
const VIDEO_CAP = DEFAULT_VIDEO_FLOW_PLAN_CAP;

/** Default planned jobs per mimic flow family when not overridden in DB (carousel + image). */
export const DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP = 5;
const TOP_PERFORMER_MIMIC_CAP = DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP;

/** Default planned jobs (incl. variations) per carousel-classified flow_type when not overridden in DB. */
export const DEFAULT_CAROUSEL_FLOW_PLAN_CAP = 10;
const CAROUSEL_CAP = DEFAULT_CAROUSEL_FLOW_PLAN_CAP;

/** Admin Runs → planning caps column groupings. */
export type PlanCapUiCategory = "core_video" | "product_video" | "top_performer_mimic";

export const PLAN_CAP_UI_CATEGORIES: readonly {
  readonly id: PlanCapUiCategory;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    id: "core_video",
    label: "Core video flows",
    hint: "Scene assembly, HeyGen script/prompt paths, render-only step.",
  },
  {
    id: "product_video",
    label: "Product video",
    hint: "Direct-response marketing angles — one cap per hook type.",
  },
  {
    id: "top_performer_mimic",
    label: "Top performer mimic",
    hint: "Carousel + image need MIMIC_IMAGE_ENABLED and archived inspection media. Video not wired yet.",
  },
] as const;

export type PlanCapGroupDef = {
  readonly id: string;
  readonly label: string;
  readonly keys: readonly string[];
  readonly category: PlanCapUiCategory;
  /** Which admin input namespace (`plan-cap-video-*` vs `plan-cap-mimic-*`). */
  readonly uiChannel: "video" | "mimic";
};

/**
 * Video flow_type keys grouped for admin UX: one cap applies to every synonym in `keys`.
 * Keep in sync with `defaultMaxJobsPerFlowType` video entries.
 */
export const VIDEO_PLAN_CAP_GROUPS: readonly PlanCapGroupDef[] = [
  {
    id: "scene_assembly",
    label: "Scene / assembly (multi-scene)",
    category: "core_video",
    uiChannel: "video",
    keys: [
      "FLOW_VID_SCENES",
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
    category: "core_video",
    uiChannel: "video",
    keys: [
      "FLOW_VID_SCRIPT",
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
    category: "core_video",
    uiChannel: "video",
    keys: [
      "FLOW_VID_PROMPT",
      // Avatar prompt path; no-avatar uses FLOW_VID_PROMPT_NO_AVATAR (see prompt_video_no_avatar group).
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
    label: "Video prompt — no avatar (HeyGen Video Agent)",
    category: "core_video",
    uiChannel: "video",
    keys: [
      "FLOW_VID_PROMPT_NO_AVATAR",
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
    category: "core_video",
    uiChannel: "video",
    keys: ["HeyGen_Render_Video"],
  },
  {
    id: "product_video_problem",
    label: "Product video — Problem/Pain hook",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_PROBLEM],
  },
  {
    id: "product_video_feature",
    label: "Product video — Feature highlight",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_FEATURE],
  },
  {
    id: "product_video_comparison",
    label: "Product video — Comparison / vs alternatives",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_COMPARISON],
  },
  {
    id: "product_video_usecase",
    label: "Product video — Use case / scenario",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_USECASE],
  },
  {
    id: "product_video_social_proof",
    label: "Product video — Social proof / testimonial",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_SOCIAL_PROOF],
  },
  {
    id: "product_video_offer",
    label: "Product video — Offer / urgency / CTA",
    category: "product_video",
    uiChannel: "video",
    keys: [FLOW_PRODUCT_OFFER],
  },
] as const;

/**
 * Top-performer mimic flows — carousel + image wired when MIMIC_IMAGE_ENABLED; video placeholder.
 * Shown on Runs → planning caps; uses `max_jobs_per_flow_type` like video families.
 */
export const TOP_PERFORMER_MIMIC_PLAN_CAP_GROUPS: readonly PlanCapGroupDef[] = [
  {
    id: "tp_mimic_video",
    label: "Top performer mimic — video (not wired)",
    category: "top_performer_mimic",
    uiChannel: "mimic",
    keys: [FLOW_TOP_PERFORMER_MIMIC_VIDEO],
  },
  {
    id: "tp_mimic_carousel",
    label: "Top performer mimic — carousel",
    category: "top_performer_mimic",
    uiChannel: "mimic",
    keys: [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL],
  },
  {
    id: "tp_mimic_image",
    label: "Top performer mimic — static image",
    category: "top_performer_mimic",
    uiChannel: "mimic",
    keys: [FLOW_TOP_PERFORMER_MIMIC_IMAGE],
  },
] as const;

/** All per-flow cap rows for admin grid (video + mimic). */
export const ALL_PLAN_CAP_UI_GROUPS: readonly PlanCapGroupDef[] = [
  ...VIDEO_PLAN_CAP_GROUPS,
  ...TOP_PERFORMER_MIMIC_PLAN_CAP_GROUPS,
];

const DEFAULT_VIDEO_FLOW_GROUPS: readonly (readonly string[])[] = VIDEO_PLAN_CAP_GROUPS.map((g) => g.keys);
const DEFAULT_TOP_PERFORMER_MIMIC_FLOW_GROUPS: readonly (readonly string[])[] =
  TOP_PERFORMER_MIMIC_PLAN_CAP_GROUPS.map((g) => g.keys);

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
  for (const group of DEFAULT_TOP_PERFORMER_MIMIC_FLOW_GROUPS) {
    for (const k of group) {
      out[k] = TOP_PERFORMER_MIMIC_CAP;
    }
  }
  return out;
}
