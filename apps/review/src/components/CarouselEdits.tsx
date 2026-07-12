"use client";

import { useCallback } from "react";
import { CarouselBrandStylingPanel } from "@/components/CarouselBrandStylingPanel";
import { buildSlidesJson, mergeCarouselThemeIntoPayload, mergeCarouselTypographyIntoPayload } from "@/lib/carousel-slides";
import type { NormalizedSlide, CarouselSlidesPayload } from "@/lib/carousel-slides";
import type { BrandSlideFrameOption } from "@/lib/brand-asset-url";

export interface CarouselBrandStylingState {
  fontScale: string;
  carouselHeadlineFontPx: string;
  carouselBodyFontPx: string;
  carouselKickerFontPx: string;
  carouselCtaFontPx: string;
  carouselHandleFontPx: string;
  paperHex: string;
  inkHex: string;
  logoEnabled: boolean;
  frameEnabled: boolean;
  selectedFrameAssetId: string;
}

export interface CarouselEditsProps extends CarouselBrandStylingState {
  taskId: string;
  runId?: string;
  editedSlides: NormalizedSlide[];
  rawPayload: CarouselSlidesPayload | null;
  onFontScaleChange: (value: string) => void;
  onCarouselHeadlineFontPxChange: (value: string) => void;
  onCarouselBodyFontPxChange: (value: string) => void;
  onCarouselKickerFontPxChange: (value: string) => void;
  onCarouselCtaFontPxChange: (value: string) => void;
  onCarouselHandleFontPxChange: (value: string) => void;
  onPaperHexChange: (value: string) => void;
  onInkHexChange: (value: string) => void;
  onLogoEnabledChange: (enabled: boolean) => void;
  onFrameEnabledChange: (enabled: boolean) => void;
  onSelectedFrameAssetIdChange: (assetId: string) => void;
  brandPalette?: string[];
  brandLogoDisplayUrl?: string;
  brandFrames?: BrandSlideFrameOption[];
  /** When true, typography & brand controls live beside the preview — hide duplicate block here. */
  stylingInPreviewPanel?: boolean;
  finalTitleOverride: string;
  onFinalTitleOverrideChange: (value: string) => void;
  finalHookOverride: string;
  onFinalHookOverrideChange: (value: string) => void;
  generatedCaption: string;
  onCaptionChange: (value: string) => void;
  finalHashtagsOverride: string;
  onFinalHashtagsOverrideChange: (value: string) => void;
  extraFields?: Record<string, string>;
  exportAtEnd?: boolean;
}

function applyCarouselStylingToPayload(
  slidesPayload: CarouselSlidesPayload,
  styling: CarouselBrandStylingState
): void {
  const fs = Number(styling.fontScale);
  if (Number.isFinite(fs) && fs > 0) {
    (slidesPayload as Record<string, unknown>).font_scale = fs;
  } else {
    delete (slidesPayload as Record<string, unknown>).font_scale;
  }
  mergeCarouselTypographyIntoPayload(slidesPayload, {
    carousel_headline_font_px: styling.carouselHeadlineFontPx,
    carousel_body_font_px: styling.carouselBodyFontPx,
    carousel_kicker_font_px: styling.carouselKickerFontPx,
    carousel_cta_font_px: styling.carouselCtaFontPx,
    carousel_handle_font_px: styling.carouselHandleFontPx,
  });
  mergeCarouselThemeIntoPayload(slidesPayload, {
    carousel_paper: styling.paperHex,
    carousel_ink: styling.inkHex,
  });
}

export function CarouselEdits({
  taskId,
  runId,
  editedSlides,
  rawPayload,
  fontScale,
  onFontScaleChange,
  carouselHeadlineFontPx,
  onCarouselHeadlineFontPxChange,
  carouselBodyFontPx,
  onCarouselBodyFontPxChange,
  carouselKickerFontPx,
  onCarouselKickerFontPxChange,
  carouselCtaFontPx,
  onCarouselCtaFontPxChange,
  carouselHandleFontPx,
  onCarouselHandleFontPxChange,
  paperHex,
  onPaperHexChange,
  inkHex,
  onInkHexChange,
  logoEnabled,
  onLogoEnabledChange,
  frameEnabled,
  onFrameEnabledChange,
  selectedFrameAssetId,
  onSelectedFrameAssetIdChange,
  brandPalette = [],
  brandLogoDisplayUrl = "",
  brandFrames = [],
  stylingInPreviewPanel = false,
  finalTitleOverride,
  onFinalTitleOverrideChange,
  finalHookOverride,
  onFinalHookOverrideChange,
  generatedCaption,
  onCaptionChange,
  finalHashtagsOverride,
  onFinalHashtagsOverrideChange,
  extraFields = {},
  exportAtEnd = false,
}: CarouselEditsProps) {
  const styling: CarouselBrandStylingState = {
    fontScale,
    carouselHeadlineFontPx,
    carouselBodyFontPx,
    carouselKickerFontPx,
    carouselCtaFontPx,
    carouselHandleFontPx,
    paperHex,
    inkHex,
    logoEnabled,
    frameEnabled,
    selectedFrameAssetId,
  };

  const exportEdited = useCallback(() => {
    const slidesPayload = buildSlidesJson(editedSlides, rawPayload);
    applyCarouselStylingToPayload(slidesPayload, styling);
    const payload = {
      task_id: taskId,
      run_id: runId || undefined,
      final_title_override: finalTitleOverride.trim() || undefined,
      final_hook_override: finalHookOverride.trim() || undefined,
      final_caption_override: generatedCaption.trim() || undefined,
      final_hashtags_override: finalHashtagsOverride.trim() || undefined,
      final_slides_json_override: slidesPayload,
      ...extraFields,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rework-${taskId}-edited.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    taskId,
    runId,
    editedSlides,
    rawPayload,
    finalTitleOverride,
    finalHookOverride,
    generatedCaption,
    finalHashtagsOverride,
    extraFields,
    styling,
  ]);

  return (
    <div className="card surface-orange">
      <div className="card-header">Edits for rework</div>

      {!stylingInPreviewPanel ? (
        <CarouselBrandStylingPanel
          fontScale={fontScale}
          onFontScaleChange={onFontScaleChange}
          carouselHeadlineFontPx={carouselHeadlineFontPx}
          onCarouselHeadlineFontPxChange={onCarouselHeadlineFontPxChange}
          carouselBodyFontPx={carouselBodyFontPx}
          onCarouselBodyFontPxChange={onCarouselBodyFontPxChange}
          carouselKickerFontPx={carouselKickerFontPx}
          onCarouselKickerFontPxChange={onCarouselKickerFontPxChange}
          carouselCtaFontPx={carouselCtaFontPx}
          onCarouselCtaFontPxChange={onCarouselCtaFontPxChange}
          carouselHandleFontPx={carouselHandleFontPx}
          onCarouselHandleFontPxChange={onCarouselHandleFontPxChange}
          brandPalette={brandPalette}
          brandLogoDisplayUrl={brandLogoDisplayUrl}
          logoEnabled={logoEnabled}
          onLogoEnabledChange={onLogoEnabledChange}
          brandFrames={brandFrames}
          frameEnabled={frameEnabled}
          onFrameEnabledChange={onFrameEnabledChange}
          selectedFrameAssetId={selectedFrameAssetId}
          onSelectedFrameAssetIdChange={onSelectedFrameAssetIdChange}
          paperHex={paperHex}
          onPaperHexChange={onPaperHexChange}
          inkHex={inkHex}
          onInkHexChange={onInkHexChange}
          className="carousel-brand-styling--embedded"
        />
      ) : (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.45 }}>
          Typography, palette, logo, and frame controls are beside the live preview. Rework overrides below are saved
          with your decision.
        </p>
      )}

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Final title override</label>
        <input
          type="text"
          value={finalTitleOverride}
          onChange={(e) => onFinalTitleOverrideChange(e.target.value)}
          placeholder="Override title (saved with decision)"
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Hook / opening line (override for next generation)</label>
        <input
          type="text"
          value={finalHookOverride}
          onChange={(e) => onFinalHookOverrideChange(e.target.value)}
          placeholder="Suggested opening or on-screen hook text"
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Caption suggestion (for next generation)</label>
        <textarea
          value={generatedCaption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="Full post caption you want the next run to aim for"
          rows={3}
          style={{ minHeight: 80 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Hashtags (for next generation)</label>
        <textarea
          value={finalHashtagsOverride}
          onChange={(e) => onFinalHashtagsOverrideChange(e.target.value)}
          placeholder="#example #hashtags or space-separated — saved with decision"
          rows={2}
          style={{ minHeight: 64 }}
        />
      </div>

      {!exportAtEnd && (
        <>
          <button type="button" className="btn-ghost" onClick={exportEdited} style={{ width: "100%" }}>
            Export edited JSON (for rework flow)
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            Downloads a JSON file with edited slides, caption, and task id for the rework pipeline.
          </p>
        </>
      )}
    </div>
  );
}

export interface CarouselEditsExportProps {
  taskId: string;
  runId?: string;
  editedSlides: NormalizedSlide[];
  rawPayload: CarouselSlidesPayload | null;
  finalTitleOverride: string;
  finalHookOverride: string;
  generatedCaption: string;
  finalHashtagsOverride: string;
  extraFields?: Record<string, string>;
}

export function CarouselEditsExport({
  taskId,
  runId,
  editedSlides,
  rawPayload,
  finalTitleOverride,
  finalHookOverride,
  generatedCaption,
  finalHashtagsOverride,
  extraFields = {},
}: CarouselEditsExportProps) {
  const exportEdited = useCallback(() => {
    const slidesPayload = buildSlidesJson(editedSlides, rawPayload);
    const payload = {
      task_id: taskId,
      run_id: runId || undefined,
      final_title_override: finalTitleOverride.trim() || undefined,
      final_hook_override: finalHookOverride.trim() || undefined,
      final_caption_override: generatedCaption.trim() || undefined,
      final_hashtags_override: finalHashtagsOverride.trim() || undefined,
      final_slides_json_override: slidesPayload,
      ...extraFields,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rework-${taskId}-edited.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [taskId, runId, editedSlides, rawPayload, finalTitleOverride, finalHookOverride, generatedCaption, finalHashtagsOverride, extraFields]);

  return (
    <div className="card surface-muted">
      <div className="card-header">End of review</div>
      <button type="button" className="btn-ghost" onClick={exportEdited} style={{ width: "100%" }}>
        Export edited JSON (for rework flow)
      </button>
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        Download JSON with edited slides, caption, and task id for the rework pipeline.
      </p>
    </div>
  );
}
