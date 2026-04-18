/**
 * New marketing-intent flow types (additive; does not replace Flow_Carousel_Copy / Video_*_Generator).
 *
 * - FLOW_PRODUCT_* — video pipeline; brand assets attach to HeyGen Video Agent as `files`.
 * - FLOW_IMG_* — registered for planning/UI; generation is blocked until an image tool is wired.
 */

export const FLOW_PRODUCT_PROBLEM = "FLOW_PRODUCT_PROBLEM";
export const FLOW_PRODUCT_FEATURE = "FLOW_PRODUCT_FEATURE";
export const FLOW_PRODUCT_COMPARISON = "FLOW_PRODUCT_COMPARISON";
export const FLOW_PRODUCT_USECASE = "FLOW_PRODUCT_USECASE";
export const FLOW_PRODUCT_SOCIAL_PROOF = "FLOW_PRODUCT_SOCIAL_PROOF";
export const FLOW_PRODUCT_OFFER = "FLOW_PRODUCT_OFFER";

export const PRODUCT_VIDEO_FLOW_TYPES: readonly string[] = [
  FLOW_PRODUCT_PROBLEM,
  FLOW_PRODUCT_FEATURE,
  FLOW_PRODUCT_COMPARISON,
  FLOW_PRODUCT_USECASE,
  FLOW_PRODUCT_SOCIAL_PROOF,
  FLOW_PRODUCT_OFFER,
] as const;

export const FLOW_IMG_PRODUCT_PROBLEM_HOOK = "FLOW_IMG_PRODUCT_PROBLEM_HOOK";
export const FLOW_IMG_PRODUCT_PROBLEM_BEFORE_AFTER = "FLOW_IMG_PRODUCT_PROBLEM_BEFORE_AFTER";
export const FLOW_IMG_PRODUCT_FEATURE_CALLOUT = "FLOW_IMG_PRODUCT_FEATURE_CALLOUT";
export const FLOW_IMG_PRODUCT_COMPARISON_SPLIT = "FLOW_IMG_PRODUCT_COMPARISON_SPLIT";
export const FLOW_IMG_PRODUCT_SOCIAL_PROOF_REVIEW = "FLOW_IMG_PRODUCT_SOCIAL_PROOF_REVIEW";
export const FLOW_IMG_PRODUCT_OFFER_URGENT = "FLOW_IMG_PRODUCT_OFFER_URGENT";

/** Image ad flows — not wired to LLM/render yet (tool TBD). */
export const PRODUCT_IMAGE_FLOW_TYPES: readonly string[] = [
  FLOW_IMG_PRODUCT_PROBLEM_HOOK,
  FLOW_IMG_PRODUCT_PROBLEM_BEFORE_AFTER,
  FLOW_IMG_PRODUCT_FEATURE_CALLOUT,
  FLOW_IMG_PRODUCT_COMPARISON_SPLIT,
  FLOW_IMG_PRODUCT_SOCIAL_PROOF_REVIEW,
  FLOW_IMG_PRODUCT_OFFER_URGENT,
] as const;

const PRODUCT_VIDEO_SET = new Set(PRODUCT_VIDEO_FLOW_TYPES);
const PRODUCT_IMAGE_SET = new Set(PRODUCT_IMAGE_FLOW_TYPES);

export function isProductVideoFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return PRODUCT_VIDEO_SET.has(ft);
}

export function isProductImageFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return PRODUCT_IMAGE_SET.has(ft);
}

/** User-visible message when someone runs generation on a FLOW_IMG_* job before tooling exists. */
export const PRODUCT_IMAGE_FLOW_NOT_READY_MESSAGE =
  "Image product flows (FLOW_IMG_*) are not enabled yet — image generation tool is not wired. Disable these flow types or wait until integration is added.";

/** Optional extra line for HeyGen Video Agent prompt on product video jobs. */
export function productVideoAgentPromptSuffix(flowType: string | null | undefined): string | null {
  if (!isProductVideoFlow(flowType)) return null;
  const label = (flowType ?? "").replace(/^FLOW_PRODUCT_/, "").replace(/_/g, " ").trim();
  if (!label) return "Content pattern: product marketing (focus from flow_type).";
  return `Content pattern: product marketing — focus: ${label}.`;
}
