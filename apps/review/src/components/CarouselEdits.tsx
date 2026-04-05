"use client";

import { useCallback } from "react";
import { buildSlidesJson } from "@/lib/carousel-slides";
import type { NormalizedSlide, CarouselSlidesPayload } from "@/lib/carousel-slides";

export interface CarouselEditsProps {
  taskId: string;
  runId?: string;
  editedSlides: NormalizedSlide[];
  rawPayload: CarouselSlidesPayload | null;
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
    <div className="card">
      <div className="card-header">Edits for rework</div>

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
    <div className="card">
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
