import type { MimicPayloadV1 } from "./mimic-payload.js";

/**
 * Map a 1-based **output** carousel slide to the 1-based **source-deck** slide index
 * (Instagram reference frame / Nemotron aesthetic row). After promo/video drops,
 * output slide N is not always reference frame N.
 */
export function sourceSlideIndexForMimicOutput(
  mimic: Partial<Pick<MimicPayloadV1, "reference_items" | "slide_plans">>,
  outputSlideIndex1Based: number
): number {
  const plan = mimic.slide_plans?.find((p) => p.slide_index === outputSlideIndex1Based);
  if (
    plan?.source_slide_index != null &&
    Number.isFinite(plan.source_slide_index) &&
    plan.source_slide_index > 0
  ) {
    return plan.source_slide_index;
  }

  const items = mimic.reference_items ?? [];
  if (items.length === 0) return outputSlideIndex1Based;

  const refIdx = plan?.reference_index ?? outputSlideIndex1Based;

  let item = items[outputSlideIndex1Based - 1] ?? null;
  if (plan?.reference_index != null) {
    item =
      items.find((r) => r.index === refIdx) ??
      (refIdx >= 1 && refIdx <= items.length ? items[refIdx - 1] : undefined) ??
      item;
  }

  const src = item?.source_slide_index;
  if (src != null && Number.isFinite(src) && src > 0) return src;
  return outputSlideIndex1Based;
}

/** @deprecated Alias — prefer `sourceSlideIndexForMimicOutput`. */
export const guidelineSlideIndexForMimicOutput = sourceSlideIndexForMimicOutput;
