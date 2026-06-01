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
  /** Original reference indices removed as brand/app promos (carousel_visual). */
  skipped_promotional_slide_indices?: number[];
}

function renderStrategyForMode(mode: MimicMode): MimicCarouselRenderStrategy {
  return mode === "template_bg" ? "template_background" : "per_slide_mimic";
}

/** Injected into LLM creation pack after reference resolve — before copy generation. */
export function buildMimicRenderContextForLlm(
  mimic: MimicPayloadV1,
  guidelineEntry: Record<string, unknown>,
  opts?: { target_slide_count?: number | null }
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

  const explicitTarget =
    opts?.target_slide_count != null &&
    Number.isFinite(opts.target_slide_count) &&
    opts.target_slide_count > 0
      ? Math.floor(opts.target_slide_count)
      : null;
  const target_slide_count = copyBefore
    ? explicitTarget ??
      (isCarouselVisual
        ? Math.max(mimic.reference_items.length, 1)
        : targetSlideCountFromReference(mimic.reference_items.length, guidelineEntry))
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
      "Visual mimic path: produce exactly target_slide_count slides — one per reference frame in slide_copy_layout (promo/video frames already removed). Same per-slide meaning as reference (rephrase only). Render recreates each slide art-only (~80% visual similarity), then composites copy via HBS.";
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
