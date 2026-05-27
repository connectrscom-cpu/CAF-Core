import type { MimicCarouselRenderStrategy } from "./mimic-carousel-package.js";
import {
  requiresCopyBeforeVisualMimic,
  targetSlideCountFromReference,
} from "./mimic-text-heavy.js";
import type { MimicMode, MimicPayloadV1 } from "./mimic-payload.js";

export interface MimicRenderContextForLlm {
  copy_before_visual_mimic: boolean;
  mode: MimicMode;
  strategy: MimicCarouselRenderStrategy;
  reference_frame_count: number;
  target_slide_count: number | null;
  format_pattern: string | null;
  render_sequence: "copy_then_template_overlay" | "per_slide_visual_mimic";
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
  const copyBefore = requiresCopyBeforeVisualMimic(guidelineEntry) || mimic.mode === "template_bg";
  const strategy = renderStrategyForMode(mimic.mode);
  const aes = guidelineEntry.aesthetic_analysis_json as Record<string, unknown> | undefined;
  const formatPattern =
    String(
      (aes && typeof aes === "object" ? aes.format_pattern : null) ??
        guidelineEntry.format_pattern ??
        ""
    ).trim() || null;

  return {
    copy_before_visual_mimic: copyBefore,
    mode: mimic.mode,
    strategy,
    reference_frame_count: mimic.reference_items.length,
    target_slide_count: copyBefore
      ? targetSlideCountFromReference(mimic.reference_items.length, guidelineEntry)
      : null,
    format_pattern: formatPattern,
    render_sequence: copyBefore ? "copy_then_template_overlay" : "per_slide_visual_mimic",
    operator_note: copyBefore
      ? "Template path: background plates (cover/body/CTA) are extracted before this copy step. Finalize all slide copy here; render will burn text onto those plates via Qwen."
      : "Full-bleed path: prioritize caption and hashtags; keep on-slide text minimal (≤120 chars/slide). Render recreates each slide visually from reference frames with text-only consistency hints.",
  };
}
