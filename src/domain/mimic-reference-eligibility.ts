import type { MimicReferenceItem } from "./mimic-payload.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  isTopPerformerMimicImageFlow,
} from "./top-performer-mimic-flow-types.js";

export const MIMIC_IMAGE_MULTI_FRAME_ERROR =
  "Top-performer reference has multiple archived frames — use FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, not FLOW_TOP_PERFORMER_MIMIC_IMAGE.";

/** Image mimic is single-frame only; carousel references with 2+ slides must use mimic carousel. */
export function assertImageMimicSingleReference(referenceItems: MimicReferenceItem[]): void {
  if (referenceItems.length <= 1) return;
  throw new Error(`${MIMIC_IMAGE_MULTI_FRAME_ERROR} (${referenceItems.length} frames archived).`);
}

export function assertMimicReferenceEligibleForFlow(
  flowType: string,
  referenceItems: MimicReferenceItem[]
): void {
  if (!isTopPerformerMimicImageFlow(flowType)) return;
  assertImageMimicSingleReference(referenceItems);
}

export function imageMimicEligibleReferenceCount(referenceItems: MimicReferenceItem[]): boolean {
  return referenceItems.length <= 1;
}

export function flowTypeForReferenceFrameCount(frameCount: number): typeof FLOW_TOP_PERFORMER_MIMIC_IMAGE | "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL" {
  return frameCount > 1 ? "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL" : FLOW_TOP_PERFORMER_MIMIC_IMAGE;
}
