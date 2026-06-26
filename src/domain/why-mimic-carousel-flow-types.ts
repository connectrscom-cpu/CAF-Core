/**
 * Why Mimic carousel lane — strategic reinterpretation of top_performer_carousel references.
 *
 * **Planning:** separate from FLOW_TOP_PERFORMER_MIMIC_CAROUSEL (fidelity mimic) and
 * FLOW_VISUAL_FIRST_CAROUSEL (ideas-from-insights). Manual picks use `mimic_kind: why_carousel`.
 *
 * **Execution:** same TP-grounded render engine (`isTpGroundedCarouselRenderFlow`) but
 * `mimic_v1.execution_mode = why_mimic` — copy + image prompts are driven by Slide
 * Intelligence (paired rationale), not semantic-fidelity rephrase + aesthetic paraphrase.
 */
export const FLOW_WHY_MIMIC_CAROUSEL = "FLOW_WHY_MIMIC_CAROUSEL";

export function isWhyMimicCarouselFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_WHY_MIMIC_CAROUSEL;
}

/** Manual Why Mimic picks (Mimic · Why Carousel tab). */
export const WHY_MIMIC_CAROUSEL_PROVENANCE = "signal_pack.manual_why_mimic_pick";
