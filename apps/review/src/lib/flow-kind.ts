/**
 * Mirrors Core `src/decision_engine/flow-kind.ts` for the Review UI.
 *
 * Three review kinds drive the workbench layout:
 *   - **carousel** — slide grid + per-slide copy editor (`FLOW_CAROUSEL`).
 *   - **tp-grounded carousel** — `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` and `FLOW_VISUAL_FIRST_CAROUSEL`:
 *     layer editor, slide regen, reprint overlay (visual-first skips original-vs-generated compare).
 *   - **mimic compare** — only manual mimic: side-by-side reference vs generated frames.
 *   - **video**    — single media preview + AI-video prompt viewer + prompt-analysis notes.
 *   - **image**    — single media preview + image prompt viewer + caption / hashtag edits
 *                    (no slide grid, no title override — image posts ship as single frame).
 *
 * FLOW_PRODUCT_* are HeyGen-rendered videos; FLOW_IMG_* are (future) image-ad flows — the review
 * surface supports both even though Core generation for FLOW_IMG_* is not wired yet.
 */

const PRODUCT_VIDEO_FLOW_TYPES = [
  "FLOW_PRODUCT_PROBLEM",
  "FLOW_PRODUCT_FEATURE",
  "FLOW_PRODUCT_COMPARISON",
  "FLOW_PRODUCT_USECASE",
  "FLOW_PRODUCT_SOCIAL_PROOF",
  "FLOW_PRODUCT_OFFER",
] as const;

const PRODUCT_IMAGE_FLOW_TYPES = [
  "FLOW_IMG_PRODUCT_PROBLEM_HOOK",
  "FLOW_IMG_PRODUCT_PROBLEM_BEFORE_AFTER",
  "FLOW_IMG_PRODUCT_FEATURE_CALLOUT",
  "FLOW_IMG_PRODUCT_COMPARISON_SPLIT",
  "FLOW_IMG_PRODUCT_SOCIAL_PROOF_REVIEW",
  "FLOW_IMG_PRODUCT_OFFER_URGENT",
] as const;

const PRODUCT_VIDEO_SET = new Set<string>(PRODUCT_VIDEO_FLOW_TYPES);
const PRODUCT_IMAGE_SET = new Set<string>(PRODUCT_IMAGE_FLOW_TYPES);

/** Canonical HeyGen / video flows (mirrors Core `CANONICAL_FLOW_TYPES`). */
const FLOW_VID_PROMPT = "FLOW_VID_PROMPT";
const FLOW_VID_PROMPT_NO_AVATAR = "FLOW_VID_PROMPT_NO_AVATAR";
const FLOW_VID_SCRIPT = "FLOW_VID_SCRIPT";
const FLOW_VID_SCENES = "FLOW_VID_SCENES";
const FLOW_TOP_PERFORMER_MIMIC_VIDEO = "FLOW_TOP_PERFORMER_MIMIC_VIDEO";

const CANONICAL_VIDEO_FLOW_SET = new Set<string>([
  FLOW_VID_PROMPT,
  FLOW_VID_PROMPT_NO_AVATAR,
  FLOW_VID_SCRIPT,
  FLOW_VID_SCENES,
]);

/** Legacy planner aliases → canonical (subset of Core `LEGACY_FLOW_TYPE_TO_CANONICAL`). */
const LEGACY_VIDEO_FLOW_ALIASES: Record<string, string> = {
  Video_Prompt_Generator: FLOW_VID_PROMPT,
  Video_Script_Generator: FLOW_VID_SCRIPT,
  Video_Scene_Generator: FLOW_VID_SCENES,
  FLOW_SCENE_ASSEMBLY: FLOW_VID_SCENES,
  Flow_Scene_Assembly: FLOW_VID_SCENES,
  VIDEO_SCENE_ASSEMBLY: FLOW_VID_SCENES,
  Scene_Assembly: FLOW_VID_SCENES,
  Video_Script_HeyGen_Avatar: FLOW_VID_SCRIPT,
  Video_Prompt_HeyGen_Avatar: FLOW_VID_PROMPT,
  Video_Prompt_HeyGen_NoAvatar: FLOW_VID_PROMPT_NO_AVATAR,
  HeyGen_NoAvatar_Prompt: FLOW_VID_PROMPT_NO_AVATAR,
  FLOW_HEYGEN_NO_AVATAR_PROMPT: FLOW_VID_PROMPT_NO_AVATAR,
  HeyGen_No_Avatar_Prompt: FLOW_VID_PROMPT_NO_AVATAR,
  Heygen_NoAvatar_Prompt: FLOW_VID_PROMPT_NO_AVATAR,
  HEYGEN_NO_AVATAR_PROMPT: FLOW_VID_PROMPT_NO_AVATAR,
};

function resolveReviewVideoFlowType(flowType: string): string {
  const t = (flowType ?? "").trim();
  return LEGACY_VIDEO_FLOW_ALIASES[t] ?? t;
}

export function isProductVideoFlow(flowType: string | null | undefined): boolean {
  return PRODUCT_VIDEO_SET.has((flowType ?? "").trim());
}

export function isProductImageFlow(flowType: string | null | undefined): boolean {
  return PRODUCT_IMAGE_SET.has((flowType ?? "").trim());
}

export function isCarouselFlow(flowType: string): boolean {
  if (
    flowType === "FLOW_CAROUSEL" ||
    flowType === "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL" ||
    flowType === "FLOW_VISUAL_FIRST_CAROUSEL" ||
    flowType === "FLOW_WHY_MIMIC_CAROUSEL"
  ) {
    return true;
  }
  return /carousel/i.test(flowType) || flowType === "Flow_Carousel_Copy";
}

/** TP-grounded carousel render on Core (manual mimic + visual-first ideas). */
export function isTpGroundedCarouselRenderFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return ft === "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL" || ft === "FLOW_VISUAL_FIRST_CAROUSEL" || ft === "FLOW_WHY_MIMIC_CAROUSEL";
}

/** Review workbench for TP-grounded carousels (layer editor, slide regen, reprint overlay). */
export function isTpGroundedCarouselReviewFlow(flowType: string | null | undefined): boolean {
  return isTpGroundedCarouselRenderFlow(flowType);
}

/** Why Mimic carousel — strategic lane; no original-vs-generated compare. */
export function isWhyMimicCarouselFlow(flowType: string | null | undefined): boolean {
  return (flowType ?? "").trim() === "FLOW_WHY_MIMIC_CAROUSEL";
}

/** Ideas-from-insights visual-first lane. */
export function isVisualFirstCarouselFlow(flowType: string | null | undefined): boolean {
  return (flowType ?? "").trim() === "FLOW_VISUAL_FIRST_CAROUSEL";
}

/** Manual top-performer mimic picks — includes original-vs-generated compare in Review. */
export function isMimicCarouselFlow(flowType: string | null | undefined): boolean {
  return (flowType ?? "").trim() === "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL";
}

export function isVideoFlow(flowType: string): boolean {
  const raw = (flowType ?? "").trim();
  if (raw === FLOW_TOP_PERFORMER_MIMIC_VIDEO) return true;
  const ft = resolveReviewVideoFlowType(raw);
  if (isProductVideoFlow(ft)) return true;
  if (CANONICAL_VIDEO_FLOW_SET.has(ft)) return true;
  if (isCarouselFlow(raw) && !/heygen|scene|Video_Script|Video_Prompt|Video_Scene|reel/i.test(raw)) {
    return false;
  }
  return (
    /video|reel/i.test(raw) ||
    /Video_Script|Video_Prompt|Video_Scene|Reel_Script/i.test(raw) ||
    /heygen|HeyGen_Render/i.test(raw) ||
    /scene_assembly|sceneassembly|FLOW_SCENE/i.test(raw)
  );
}

/** HeyGen single-take video flows (for workbench avatar / script controls). */
export function isHeyGenVidCanonicalFlow(flowType: string | null | undefined): boolean {
  const ft = resolveReviewVideoFlowType((flowType ?? "").trim());
  return (
    ft === FLOW_VID_PROMPT ||
    ft === FLOW_VID_PROMPT_NO_AVATAR ||
    ft === FLOW_VID_SCRIPT
  );
}

/**
 * Image-class flows: product image ads + top-performer mimic image posts.
 */
export function isImageFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  if (ft === "FLOW_TOP_PERFORMER_MIMIC_IMAGE") return true;
  return isProductImageFlow(ft);
}

export type ReviewContentKind = "carousel" | "video" | "image" | "unknown";

export function inferPublishContentFormat(flowType: string | null | undefined): ReviewContentKind {
  const ft = String(flowType ?? "");
  if (isImageFlow(ft)) return "image";
  if (isVideoFlow(ft)) return "video";
  if (isCarouselFlow(ft)) return "carousel";
  return "unknown";
}
