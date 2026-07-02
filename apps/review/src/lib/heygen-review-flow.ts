import { isHeyGenVidCanonicalFlow, isProductVideoFlow } from "./flow-kind";

/**
 * Single-take HeyGen flows in the workbench (not multi-scene assembly).
 *
 * Includes FLOW_PRODUCT_* and canonical FLOW_VID_* — those are HeyGen Video Agent renders;
 * reviewers need the same avatar / voice / spoken-script controls as legacy `*_HeyGen_*` names.
 */
export function isHeyGenReviewFlow(flowType: string | undefined): boolean {
  const ft = flowType ?? "";
  if (/scene_assembly|FLOW_SCENE|Video_Scene_Assembly/i.test(ft)) return false;
  if (isProductVideoFlow(ft)) return true;
  if (isHeyGenVidCanonicalFlow(ft)) return true;
  return /heygen|HeyGen|Video_Script_HeyGen|Video_Prompt_HeyGen/i.test(ft);
}
