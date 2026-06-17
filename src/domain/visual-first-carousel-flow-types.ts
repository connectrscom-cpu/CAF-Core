/**
 * Visual-first carousel lane — ideas from insights (`carousel_style: visual_first`)
 * grounded to top_performer_carousel references.
 *
 * **Planning:** separate from FLOW_TOP_PERFORMER_MIMIC_CAROUSEL (manual mimic picks).
 *
 * **Render/copy:** identical to TP-grounded mimic carousel (`isTpGroundedCarouselRenderFlow`):
 * - `classifyMimicMode()` → `template_bg` (template background + text overlay) OR
 *   `carousel_visual` (full-bleed art-only plate per slide + text overlay)
 * - Payload: `mimic_v1`, review snapshot: `mimic_carousel_package` (not `carousel_package`)
 * - **Text is always HTML/CSS overlay** (Puppeteer HBS / DocAI `docai_layer_positions`) on stored
 *   plates — image models produce art-only plates; never bake LLM copy into Flux (`MIMIC_CAROUSEL_TEXT_VIA_FLUX`
 *   is ignored for all TP-grounded carousel renders; see `job-pipeline.ts`).
 *
 * **Review (apps/review):** `isTpGroundedCarouselReviewFlow` — layer editor, regen, reprint (same as manual mimic).
 * Original-vs-generated compare is **only** `isMimicCarouselFlow` (manual mimic picks).
 */
export const FLOW_VISUAL_FIRST_CAROUSEL = "FLOW_VISUAL_FIRST_CAROUSEL";

export function isVisualFirstCarouselFlow(flowType: string): boolean {
  return (flowType ?? "").trim() === FLOW_VISUAL_FIRST_CAROUSEL;
}

/** Planner row provenance for visual-first ideas (not manual mimic picks). */
export const VISUAL_FIRST_CAROUSEL_PROVENANCE = "signal_pack.ideas_json.visual_first";
