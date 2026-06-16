/**
 * Visual-first carousel lane — ideas from insights (`carousel_style: visual_first`)
 * grounded to top_performer_carousel references. Shares render/copy pipeline with
 * FLOW_TOP_PERFORMER_MIMIC_CAROUSEL but is a separate planning + product lane.
 */
export const FLOW_VISUAL_FIRST_CAROUSEL = "FLOW_VISUAL_FIRST_CAROUSEL";

export function isVisualFirstCarouselFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_VISUAL_FIRST_CAROUSEL;
}

/** Planner row provenance for visual-first ideas (not manual mimic picks). */
export const VISUAL_FIRST_CAROUSEL_PROVENANCE = "signal_pack.ideas_json.visual_first";
