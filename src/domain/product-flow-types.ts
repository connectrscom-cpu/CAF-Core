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

/**
 * HeyGen routing mode for product-flow videos:
 *   - `script_led` → POST /v3/videos: avatar TTS reads spoken_script verbatim.
 *   - `prompt_led` → POST /v3/video-agents: HeyGen agent writes + speaks its own VO from the
 *     visual_direction / video_prompt block.
 *
 * One LLM call per job: script-led skips the video_prompt generator; prompt-led skips the
 * spoken_script generator. This is the root fix for "spoken script doesn't match the visuals" —
 * two uncoordinated LLM calls were previously stapled together and shipped to HeyGen's agent as
 * one blob (see job-pipeline.ensureHeygenPayloadForFlowType fallthrough branch).
 */
export type ProductHeygenMode = "script_led" | "prompt_led";

/**
 * Baked-in default when the project hasn't overridden via allowed_flow_types.heygen_mode.
 * Factual / claim-heavy angles (FEATURE, COMPARISON, OFFER, USECASE) get verbatim copy so
 * numbers / feature names / CTA text are not invented by the agent. Emotional hook angles
 * (PROBLEM, SOCIAL_PROOF) use prompt-led so HeyGen has room to match VO cadence to visuals.
 */
export function defaultProductFlowHeygenMode(flowType: string | null | undefined): ProductHeygenMode | null {
  if (!isProductVideoFlow(flowType)) return null;
  const ft = (flowType ?? "").trim();
  switch (ft) {
    case FLOW_PRODUCT_FEATURE:
    case FLOW_PRODUCT_COMPARISON:
    case FLOW_PRODUCT_OFFER:
    case FLOW_PRODUCT_USECASE:
      return "script_led";
    case FLOW_PRODUCT_PROBLEM:
    case FLOW_PRODUCT_SOCIAL_PROOF:
      return "prompt_led";
    default:
      return "prompt_led";
  }
}

/** Normalize any string / unknown to a valid ProductHeygenMode or null. */
export function coerceProductHeygenMode(v: unknown): ProductHeygenMode | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (t === "script_led") return "script_led";
  if (t === "prompt_led") return "prompt_led";
  return null;
}
