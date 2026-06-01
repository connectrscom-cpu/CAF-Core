import type { MimicCarouselRenderStrategy } from "./mimic-carousel-package.js";
import {
  aestheticSlideRecords,
  requiresCopyBeforeVisualMimic,
  targetSlideCountFromReference,
} from "./mimic-text-heavy.js";
import type { MimicMode, MimicPayloadV1 } from "./mimic-payload.js";

export type MimicRenderSequence =
  | "copy_then_template_overlay"
  | "visual_plate_then_hbs_overlay"
  | "per_slide_visual_mimic";

export interface MimicRenderContextForLlm {
  copy_before_visual_mimic: boolean;
  mode: MimicMode;
  strategy: MimicCarouselRenderStrategy;
  reference_frame_count: number;
  target_slide_count: number | null;
  format_pattern: string | null;
  render_sequence: MimicRenderSequence;
  operator_note: string;
}

function renderStrategyForMode(mode: MimicMode): MimicCarouselRenderStrategy {
  return mode === "template_bg" ? "template_background" : "per_slide_mimic";
}

/** Injected into LLM creation pack after reference resolve — before copy generation. */
export function buildMimicRenderContextForLlm(
  mimic: MimicPayloadV1,
  guidelineEntry: Record<string, unknown>
): MimicRenderContextForLlm {
  const isTemplate = mimic.mode === "template_bg";
  const isCarouselVisual = mimic.mode === "carousel_visual";
  const copyBefore =
    isTemplate || isCarouselVisual || requiresCopyBeforeVisualMimic(guidelineEntry);
  const strategy = renderStrategyForMode(mimic.mode);
  const aes = guidelineEntry.aesthetic_analysis_json as Record<string, unknown> | undefined;
  const formatPattern =
    String(
      (aes && typeof aes === "object" ? aes.format_pattern : null) ??
        guidelineEntry.format_pattern ??
        ""
    ).trim() || null;

  const target_slide_count = copyBefore
    ? targetSlideCountFromReference(mimic.reference_items.length, guidelineEntry)
    : null;

  let render_sequence: MimicRenderSequence;
  let operator_note: string;
  if (isTemplate) {
    render_sequence = "copy_then_template_overlay";
    operator_note =
      "Template path: background plates (cover/body/CTA) are extracted before this copy step. Finalize all slide copy here; render burns text onto those plates via HBS using Nemotron placement hints.";
  } else if (isCarouselVisual) {
    render_sequence = "visual_plate_then_hbs_overlay";
    operator_note =
      "Visual mimic path: finalize full per-slide copy here (~same structure/length as slide_copy_layout; fresh wording). Render recreates each slide art-only (~80% visual similarity), then composites your copy via HBS at Nemotron text_blocks / typography positions.";
  } else {
    render_sequence = copyBefore ? "copy_then_template_overlay" : "per_slide_visual_mimic";
    operator_note = copyBefore
      ? "Template path: background plates are extracted before copy; render composites text via HBS."
      : "Legacy visual path: finalize copy before render.";
  }

  return {
    copy_before_visual_mimic: copyBefore,
    mode: mimic.mode,
    strategy,
    reference_frame_count: mimic.reference_items.length,
    target_slide_count,
    format_pattern: formatPattern,
    render_sequence,
    operator_note,
  };
}
