"use client";

import { useCallback } from "react";
import { buildSlidesJson, mergeCarouselTypographyIntoPayload } from "@/lib/carousel-slides";
import type { NormalizedSlide, CarouselSlidesPayload } from "@/lib/carousel-slides";

export interface CarouselEditsProps {
  taskId: string;
  runId?: string;
  editedSlides: NormalizedSlide[];
  rawPayload: CarouselSlidesPayload | null;
  fontScale: string;
  onFontScaleChange: (value: string) => void;
  /** Optional px overrides → `generated_output.render` on rework (empty = template default). */
  carouselHeadlineFontPx: string;
  onCarouselHeadlineFontPxChange: (value: string) => void;
  carouselBodyFontPx: string;
  onCarouselBodyFontPxChange: (value: string) => void;
  carouselKickerFontPx: string;
  onCarouselKickerFontPxChange: (value: string) => void;
  carouselCtaFontPx: string;
  onCarouselCtaFontPxChange: (value: string) => void;
  carouselHandleFontPx: string;
  onCarouselHandleFontPxChange: (value: string) => void;
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
  const exportEdited = useCallback(() => {
    const slidesPayload = buildSlidesJson(editedSlides, rawPayload);
    const fs = Number(fontScale);
    if (Number.isFinite(fs) && fs > 0) {
      (slidesPayload as Record<string, unknown>).font_scale = fs;
    } else {
      delete (slidesPayload as Record<string, unknown>).font_scale;
    }
    mergeCarouselTypographyIntoPayload(slidesPayload, {
      carousel_headline_font_px: carouselHeadlineFontPx,
      carousel_body_font_px: carouselBodyFontPx,
      carousel_kicker_font_px: carouselKickerFontPx,
      carousel_cta_font_px: carouselCtaFontPx,
      carousel_handle_font_px: carouselHandleFontPx,
    });
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
    fontScale,
    carouselHeadlineFontPx,
    carouselBodyFontPx,
    carouselKickerFontPx,
    carouselCtaFontPx,
    carouselHandleFontPx,
  ]);

  return (
    <div className="card surface-orange">
      <div className="card-header">Edits for rework</div>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Font scale (renderer) — current: {Number(fontScale || 1).toFixed(2)}×</label>
        <input
          type="range"
          min="0.75"
          max="1.25"
          step="0.01"
          value={fontScale || "1"}
          onChange={(e) => onFontScaleChange(e.target.value)}
        />
        <input
          type="text"
          value={fontScale}
          onChange={(e) => onFontScaleChange(e.target.value)}
          placeholder="1.00"
          style={{ marginTop: 6 }}
        />
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          Applies across the entire carousel (all templates). Lower if text is cramped; increase if too small.
        </p>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="filter-label">Typography (px, optional — saved for next rework)</label>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          Leave blank to use each template’s defaults. Values map to renderer CSS tokens (headline, body, kicker, CTA, handle).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            Headline px
            <input
              type="text"
              inputMode="numeric"
              value={carouselHeadlineFontPx}
              onChange={(e) => onCarouselHeadlineFontPxChange(e.target.value)}
              placeholder="e.g. 72"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Body px
            <input
              type="text"
              inputMode="numeric"
              value={carouselBodyFontPx}
              onChange={(e) => onCarouselBodyFontPxChange(e.target.value)}
              placeholder="e.g. 56"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Kicker px
            <input
              type="text"
              inputMode="numeric"
              value={carouselKickerFontPx}
              onChange={(e) => onCarouselKickerFontPxChange(e.target.value)}
              placeholder="e.g. 18"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            CTA px
            <input
              type="text"
              inputMode="numeric"
              value={carouselCtaFontPx}
              onChange={(e) => onCarouselCtaFontPxChange(e.target.value)}
              placeholder="e.g. 72"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>
            Handle px
            <input
              type="text"
              inputMode="numeric"
              value={carouselHandleFontPx}
              onChange={(e) => onCarouselHandleFontPxChange(e.target.value)}
              placeholder="e.g. 42"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>
      </div>

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
