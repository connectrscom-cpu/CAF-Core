"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    <div className="space-y-4 rounded-lg border bg-card p-4 text-card-foreground">
      <h3 className="text-sm font-semibold">Edits for rework</h3>

      <div className="grid gap-2">
        <Label className="text-xs">Final title override</Label>
        <input
          type="text"
          value={finalTitleOverride}
          onChange={(e) => onFinalTitleOverrideChange(e.target.value)}
          placeholder="Override title (saved with decision)"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Hook / opening line (override for next generation)</Label>
        <input
          type="text"
          value={finalHookOverride}
          onChange={(e) => onFinalHookOverrideChange(e.target.value)}
          placeholder="Suggested opening or on-screen hook text"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Caption suggestion (for next generation)</Label>
        <textarea
          value={generatedCaption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="Full post caption you want the next run to aim for"
          className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          rows={3}
        />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Hashtags (for next generation)</Label>
        <textarea
          value={finalHashtagsOverride}
          onChange={(e) => onFinalHashtagsOverrideChange(e.target.value)}
          placeholder="#example #hashtags or space-separated — saved with decision"
          className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          rows={2}
        />
      </div>

      {!exportAtEnd && (
        <>
          <Button type="button" variant="outline" onClick={exportEdited} className="w-full">
            Export edited JSON (for rework flow)
          </Button>
          <p className="text-xs text-muted-foreground">
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
    <div className="space-y-2 rounded-lg border bg-card p-4 text-card-foreground">
      <h3 className="text-sm font-semibold">End of review</h3>
      <Button type="button" variant="outline" onClick={exportEdited} className="w-full">
        Export edited JSON (for rework flow)
      </Button>
      <p className="text-xs text-muted-foreground">
        Download JSON with edited slides, caption, and task id for the rework pipeline.
      </p>
    </div>
  );
}
