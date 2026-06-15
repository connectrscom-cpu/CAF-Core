"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {

  MimicDocAiLayerPositionEditor,

  type DocAiLayerBox,

  type DocAiLayerOverride,

} from "@/components/MimicDocAiLayerPositionEditor";



function asRec(v: unknown): Record<string, unknown> | null {

  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

}



function pickCarouselTemplateName(generationPayload: Record<string, unknown>): string {

  const gp = generationPayload ?? {};

  const go = asRec(gp.generated_output);

  const goRender = go ? asRec(go.render) : null;

  const gpRender = asRec(gp.render);

  const v =

    goRender?.html_template_name ??

    goRender?.template_key ??

    gpRender?.html_template_name ??

    gpRender?.template_key ??

    gp.template;

  const s = typeof v === "string" ? v.trim() : "";

  return s ? s.replace(/\.hbs$/i, "") : "";

}



function overridesForPersist(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.map((r) => {
    if (r.hidden) return r;
    if (r.layer_key.startsWith("custom@")) {
      return {
        ...r,
        box_locked: true,
        w_px: r.w_px ?? 280,
        h_px: r.h_px ?? 72,
        text: r.text?.trim() || "New text",
      };
    }
    if (r.box_locked) return r;
    const { w_px: _w, h_px: _h, box_locked: _b, text: _t, ...rest } = r;
    return rest;
  });
}

function mergeDocAiLayerPositionsForReprint(

  mimicV1: Record<string, unknown> | null,

  slideDrafts: Record<number, DocAiLayerOverride[]>,

  editorSlide: number,

  currentDraft: DocAiLayerOverride[]

): Record<string, DocAiLayerOverride[]> | undefined {

  const raw = mimicV1?.docai_layer_positions;

  const merged: Record<string, DocAiLayerOverride[]> = {};

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {

    for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {

      if (!Array.isArray(rows)) continue;

      merged[key] = rows as DocAiLayerOverride[];

    }

  }

  for (const [slideKey, rows] of Object.entries(slideDrafts)) {

    if (rows.length > 0) merged[slideKey] = overridesForPersist(rows);

  }

  if (currentDraft.length > 0) {

    merged[String(editorSlide)] = overridesForPersist(currentDraft);

  }

  return Object.keys(merged).length > 0 ? merged : undefined;

}



function savedLayoutSlideIndices(mimicV1: Record<string, unknown> | null): Set<number> {

  const raw = mimicV1?.docai_layer_positions;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();

  const out = new Set<number>();

  for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {

    if (!Array.isArray(rows) || rows.length === 0) continue;

    const n = Number(key);

    if (Number.isFinite(n) && n >= 1) out.add(n);

  }

  return out;

}



function parseDocAiLayerBoxes(renderInspect: Record<string, unknown> | null): DocAiLayerBox[] {

  const raw = renderInspect?.docai_text_layers;

  if (!Array.isArray(raw)) return [];

  return raw

    .map((row) => {

      const r = asRec(row);

      if (!r) return null;

      const layer_key = String(r.layer_key ?? "").trim();

      const text = String(r.text ?? "").trim();

      if (!layer_key || !text) return null;

      return {

        layer_key,

        text,

        role: String(r.role ?? "body"),

        x_px: Number(r.x_px) || 0,

        y_px: Number(r.y_px) || 0,

        w_px: Math.max(24, Number(r.w_px) || 120),

        h_px: Math.max(20, Number(r.h_px) || 48),

        font_size_px: Number(r.font_size_px) > 0 ? Number(r.font_size_px) : undefined,

        skip_center_avoid: r.skip_center_avoid === true,

      };

    })

    .filter(Boolean) as DocAiLayerBox[];

}



function parseDocAiSavedOverrides(renderInspect: Record<string, unknown> | null): DocAiLayerOverride[] {

  const raw = renderInspect?.docai_layer_positions;

  if (!Array.isArray(raw)) return [];

  return raw

    .map((row) => {

      const r = asRec(row);

      if (!r) return null;

      const layer_key = String(r.layer_key ?? "").trim();

      const x_px = Number(r.x_px);

      const y_px = Number(r.y_px);

      if (!layer_key || !Number.isFinite(x_px) || !Number.isFinite(y_px)) return null;

      const font_size_px = Number(r.font_size_px);

      const w_px = Number(r.w_px);

      const h_px = Number(r.h_px);

      const text = typeof r.text === "string" ? r.text : undefined;
      const box_locked = r.box_locked === true;
      const hidden = r.hidden === true;
      const custom = layer_key.startsWith("custom@");
      const persistBox = box_locked || custom;

      return {

        layer_key,

        x_px,

        y_px,

        ...(Number.isFinite(font_size_px) && font_size_px > 0 ? { font_size_px } : {}),

        ...(persistBox && Number.isFinite(w_px) && w_px > 0 ? { w_px } : {}),

        ...(persistBox && Number.isFinite(h_px) && h_px > 0 ? { h_px } : {}),

        ...(text?.trim() ? { text: text.trim() } : custom ? { text: "New text" } : {}),

        ...(persistBox ? { box_locked: true } : {}),

        ...(hidden ? { hidden: true } : {}),

      };

    })

    .filter(Boolean) as DocAiLayerOverride[];

}



export interface MimicCarouselLayerEditorPanelProps {

  job: Record<string, unknown> | null;

  taskId: string;

  projectSlug: string;

  slideCount: number;

  activeSlideIndex?: number;

  buildInspectPayload?: () => Record<string, unknown>;

  template?: string;

  instagramHandle?: string;

  getBackgroundUrl?: (slideIndex1Based: number) => string | undefined;

  onReprintComplete?: () => void | Promise<void>;

  buildReprintTypographyPatch?: () => Record<string, number>;

  /** Persist saved layout into local job state (avoids stale inspect until refetch). */

  onMimicLayoutSaved?: (slideIndex: number, positions: DocAiLayerOverride[]) => void;

  onSlideSelect?: (slideIndex1Based: number) => void;

}



export function MimicCarouselLayerEditorPanel({

  job,

  taskId,

  projectSlug,

  slideCount,

  activeSlideIndex = 1,

  buildInspectPayload,

  template = "",

  instagramHandle = "",

  getBackgroundUrl,

  onReprintComplete,

  buildReprintTypographyPatch,

  onMimicLayoutSaved,

  onSlideSelect,

}: MimicCarouselLayerEditorPanelProps) {

  const [editorSlide, setEditorSlide] = useState(activeSlideIndex);

  const [renderInspect, setRenderInspect] = useState<Record<string, unknown> | null>(null);

  const [renderInspectLoading, setRenderInspectLoading] = useState(false);

  const inspectRequestGenRef = useRef(0);
  const previewRequestGenRef = useRef(0);

  const [layoutPreviewUrl, setLayoutPreviewUrl] = useState<string | null>(null);

  const [layoutPreviewBusy, setLayoutPreviewBusy] = useState(false);

  const [layoutPreviewError, setLayoutPreviewError] = useState<string | null>(null);

  const [reprintScope, setReprintScope] = useState<"selected" | "all">("all");

  const [reprintTextBacking, setReprintTextBacking] = useState(true);
  const [userTouchedLayout, setUserTouchedLayout] = useState(false);

  const [reprintBusy, setReprintBusy] = useState(false);

  const [reprintMsg, setReprintMsg] = useState<string | null>(null);

  const [reprintError, setReprintError] = useState<string | null>(null);

  const [regenerateBusy, setRegenerateBusy] = useState(false);

  const [regenerateMsg, setRegenerateMsg] = useState<string | null>(null);

  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const [layerPosDraft, setLayerPosDraft] = useState<DocAiLayerOverride[]>([]);

  const [slideDrafts, setSlideDrafts] = useState<Record<number, DocAiLayerOverride[]>>({});

  const [layerPosSaving, setLayerPosSaving] = useState(false);

  const [layerPosMsg, setLayerPosMsg] = useState<string | null>(null);

  const [layerPosError, setLayerPosError] = useState<string | null>(null);

  const [layoutBaseline, setLayoutBaseline] = useState("");

  const [slidesWithSavedLayout, setSlidesWithSavedLayout] = useState<Set<number>>(() => new Set());

  const userTouchedLayoutRef = useRef(false);
  userTouchedLayoutRef.current = userTouchedLayout;



  const buildInspectPayloadRef = useRef(buildInspectPayload);

  const getBackgroundUrlRef = useRef(getBackgroundUrl);

  buildInspectPayloadRef.current = buildInspectPayload;

  getBackgroundUrlRef.current = getBackgroundUrl;



  const prevCarouselSlideRef = useRef(activeSlideIndex);

  const gp = useMemo(() => asRec(job?.generation_payload) ?? {}, [job]);

  const mimicV1 = useMemo(() => asRec(gp.mimic_v1), [gp]);

  const templateUsed = useMemo(() => template || pickCarouselTemplateName(gp), [template, gp]);

  useEffect(() => {

    setSlidesWithSavedLayout(savedLayoutSlideIndices(mimicV1));

    const raw = mimicV1?.docai_layer_positions;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;

    const fromServer: Record<number, DocAiLayerOverride[]> = {};

    for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {

      if (!Array.isArray(rows) || rows.length === 0) continue;

      const slideIndex = Number(key);

      if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;

      fromServer[slideIndex] = rows as DocAiLayerOverride[];

    }

    if (Object.keys(fromServer).length === 0) return;

    setSlideDrafts((prev) => ({ ...fromServer, ...prev }));

  }, [mimicV1, taskId]);



  useEffect(() => {

    setLayoutBaseline("");

    setUserTouchedLayout(false);

    setLayoutPreviewUrl((prev) => {

      if (prev) URL.revokeObjectURL(prev);

      return null;

    });

    setLayoutPreviewError(null);

  }, [editorSlide]);



  const layoutDirty =

    userTouchedLayout &&

    layoutBaseline !== "" &&

    layerPosDraft.length > 0 &&

    JSON.stringify(layerPosDraft) !== layoutBaseline;



  const persistLayerPositions = useCallback(

    async (slideIndex: number, positions: DocAiLayerOverride[]): Promise<void> => {

      if (!taskId.trim() || !projectSlug.trim() || positions.length === 0) return;

      const res = await fetch("/api/task/mimic-docai-layer-positions", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        signal: AbortSignal.timeout(45_000),

        body: JSON.stringify({

          task_id: taskId,

          project: projectSlug.trim(),

          slide_index: slideIndex,

          positions: overridesForPersist(positions),

        }),

      });

      const json = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !json.ok) {

        throw new Error(json.error ?? `Save failed (${res.status})`);

      }

      onMimicLayoutSaved?.(slideIndex, overridesForPersist(positions));

    },

    [taskId, projectSlug, onMimicLayoutSaved]

  );


  const autoReprintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCarouselAfterReprint = useCallback(() => {
    const refreshPreview = () => void onReprintComplete?.();
    refreshPreview();
    for (const delayMs of [20_000, 45_000, 75_000]) {
      window.setTimeout(refreshPreview, delayMs);
    }
  }, [onReprintComplete]);

  const requestTextOverlayReprint = useCallback(
    async (
      slideIndices: number[] | undefined,
      allDrafts: Record<number, DocAiLayerOverride[]>,
      currentSlide: number,
      currentDraft: DocAiLayerOverride[]
    ) => {
      if (!taskId.trim() || !projectSlug.trim()) return;
      const docai_layer_positions = mergeDocAiLayerPositionsForReprint(
        mimicV1,
        allDrafts,
        currentSlide,
        currentDraft
      );
      const render_typography = buildReprintTypographyPatch?.();
      const res = await fetch("/api/task/reprint-text-overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          project: projectSlug.trim(),
          ...(slideIndices && slideIndices.length > 0 ? { slide_indices: slideIndices } : {}),
          ...(render_typography && Object.keys(render_typography).length > 0 ? { render_typography } : {}),
          ...(docai_layer_positions ? { docai_layer_positions } : {}),
          text_backing: reprintTextBacking,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; accepted?: boolean; message?: string; error?: string };
      if ((!res.ok && res.status !== 202) || !json.ok) {
        throw new Error(json.error ?? json.message ?? `Reprint failed (${res.status})`);
      }
      setReprintMsg(json.message ?? "Reprint started — updating carousel preview…");
      refreshCarouselAfterReprint();
    },
    [
      taskId,
      projectSlug,
      mimicV1,
      reprintTextBacking,
      buildReprintTypographyPatch,
      refreshCarouselAfterReprint,
    ]
  );

  const scheduleAutoReprintForSlide = useCallback(
    (slideIndex: number, draft: DocAiLayerOverride[], drafts: Record<number, DocAiLayerOverride[]>) => {
      if (autoReprintTimerRef.current) clearTimeout(autoReprintTimerRef.current);
      autoReprintTimerRef.current = setTimeout(() => {
        void requestTextOverlayReprint([slideIndex], drafts, slideIndex, draft).catch((e) => {
          setReprintError(e instanceof Error ? e.message : "Auto-reprint failed");
        });
      }, 900);
    },
    [requestTextOverlayReprint]
  );


  const flushCurrentSlideLayout = useCallback(async (): Promise<boolean> => {

    if (!taskId.trim() || !projectSlug.trim() || layerPosDraft.length === 0) return true;

    if (!userTouchedLayout || !layoutDirty) return true;

    try {

      await persistLayerPositions(editorSlide, layerPosDraft);

      setSlideDrafts((prev) => ({ ...prev, [editorSlide]: layerPosDraft }));

      setLayoutBaseline(JSON.stringify(layerPosDraft));

      setUserTouchedLayout(false);

      setSlidesWithSavedLayout((prev) => new Set(prev).add(editorSlide));

      const mergedDrafts = { ...slideDrafts, [editorSlide]: layerPosDraft };

      scheduleAutoReprintForSlide(editorSlide, layerPosDraft, mergedDrafts);

      return true;

    } catch (e) {

      setLayerPosError(e instanceof Error ? e.message : "Auto-save failed");

      return false;

    }

  }, [

    taskId,

    projectSlug,

    layerPosDraft,

    userTouchedLayout,

    layoutDirty,

    editorSlide,

    persistLayerPositions,

    slideDrafts,

    scheduleAutoReprintForSlide,

  ]);



  useEffect(() => {

    if (activeSlideIndex === editorSlide) {

      prevCarouselSlideRef.current = activeSlideIndex;

      return;

    }

    let cancelled = false;

    void (async () => {

      if (userTouchedLayout && layoutDirty) {

        const ok = await flushCurrentSlideLayout();

        if (!ok || cancelled) return;

      }

      if (cancelled) return;

      prevCarouselSlideRef.current = activeSlideIndex;

      setEditorSlide(activeSlideIndex);

      setLayerPosMsg(null);

      setLayerPosError(null);

    })();

    return () => {

      cancelled = true;

    };

  }, [activeSlideIndex, editorSlide, userTouchedLayout, layoutDirty, flushCurrentSlideLayout]);



  const trySetEditorSlide = useCallback(

    (nextSlide: number) => {

      const n = Math.max(1, Math.min(slideCount, Math.floor(nextSlide) || 1));

      if (n === editorSlide) return;

      void (async () => {

        if (userTouchedLayout && layoutDirty) {

          const ok = await flushCurrentSlideLayout();

          if (!ok) return;

        }

        setEditorSlide(n);

        setLayerPosMsg(null);

        setLayerPosError(null);

        onSlideSelect?.(n);

      })();

    },

    [editorSlide, userTouchedLayout, layoutDirty, flushCurrentSlideLayout, onSlideSelect, slideCount]

  );



  const handleLayoutInitialized = useCallback((overrides: DocAiLayerOverride[]) => {

    if (userTouchedLayoutRef.current) return;

    setLayerPosDraft(overrides);

    setSlideDrafts((prev) => ({ ...prev, [editorSlide]: overrides }));

    setLayoutBaseline(JSON.stringify(overrides));

    setUserTouchedLayout(false);

  }, [editorSlide]);



  const handleLayerDraftChange = useCallback(

    (overrides: DocAiLayerOverride[]) => {

      setLayerPosDraft(overrides);

      setSlideDrafts((prev) => ({ ...prev, [editorSlide]: overrides }));

      setUserTouchedLayout(true);

    },

    [editorSlide]

  );



  const inspectCopyKey = useMemo(() => {

    const payload = buildInspectPayload?.() ?? {};

    const slides = Array.isArray(payload.slides) ? payload.slides : [];

    const slide = slides[editorSlide - 1];

    return JSON.stringify(slide ?? {});

  }, [buildInspectPayload, editorSlide]);



  const persistedPositionsForInspect = useMemo(

    () =>
      overridesForPersist(
        layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? []
      ),

    [layerPosDraft, slideDrafts, editorSlide]

  );



  useEffect(() => {

    if (!buildInspectPayloadRef.current || !templateUsed || slideCount < 1) {

      setRenderInspect(null);

      setRenderInspectLoading(false);

      return;

    }

    const gen = ++inspectRequestGenRef.current;

    const timer = window.setTimeout(() => {

      void (async () => {

        setRenderInspectLoading(true);

        try {

          const payload = buildInspectPayloadRef.current?.() ?? {};

          const bg = getBackgroundUrlRef.current?.(editorSlide);

          const res = await fetch("/api/renderer/inspect-slide-context", {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            signal: AbortSignal.timeout(30_000),

            body: JSON.stringify({

              template: templateUsed,

              slide_index: editorSlide,

              payload,

              instagram_handle: instagramHandle,

              text_backing: reprintTextBacking,

              ...(persistedPositionsForInspect.length > 0

                ? { docai_layer_positions: persistedPositionsForInspect }

                : {}),

              ...(bg ? { background_image_url: bg } : {}),

            }),

          });

          const json = (await res.json()) as Record<string, unknown>;

          if (inspectRequestGenRef.current !== gen) return;

          setRenderInspect(json.ok ? json : { error: json.error ?? "inspect failed" });

        } catch (e) {

          if (inspectRequestGenRef.current !== gen) return;

          setRenderInspect({ error: e instanceof Error ? e.message : "inspect failed" });

        } finally {

          if (inspectRequestGenRef.current === gen) setRenderInspectLoading(false);

        }

      })();

    }, 700);

    return () => {

      inspectRequestGenRef.current += 1;

      window.clearTimeout(timer);

    };

  }, [templateUsed, editorSlide, slideCount, instagramHandle, reprintTextBacking, inspectCopyKey, persistedPositionsForInspect]);



  const refreshLayoutPreview = useCallback(async () => {

    if (!buildInspectPayloadRef.current || !templateUsed || !taskId.trim() || slideCount < 1) return;

    const gen = ++previewRequestGenRef.current;

    setLayoutPreviewBusy(true);

    setLayoutPreviewError(null);

    try {

      const payload = buildInspectPayloadRef.current?.() ?? {};

      const bg = getBackgroundUrlRef.current?.(editorSlide);

      const gp = asRec(payload);

      const draftPositions = overridesForPersist(

        layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? []

      );

      const res = await fetch("/api/renderer/preview-live-slide", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        signal: AbortSignal.timeout(90_000),

        body: JSON.stringify({

          template: templateUsed,

          slide_index: editorSlide,

          task_id: taskId,

          run_id: String(job?.run_id ?? gp?.run_id ?? "preview"),

          instagram_handle: instagramHandle,

          text_backing: reprintTextBacking,

          ...(draftPositions.length > 0 ? { docai_layer_positions: draftPositions } : {}),

          ...(bg ? { background_image_url: bg } : {}),

          payload,

        }),

      });

      if (!res.ok) {

        throw new Error(await res.text().then((t) => t.slice(0, 160)));

      }

      const blob = await res.blob();

      if (previewRequestGenRef.current !== gen) return;

      const url = URL.createObjectURL(blob);

      setLayoutPreviewUrl((prev) => {

        if (prev) URL.revokeObjectURL(prev);

        return url;

      });

    } catch (e) {

      if (previewRequestGenRef.current !== gen) return;

      setLayoutPreviewUrl((prev) => {

        if (prev) URL.revokeObjectURL(prev);

        return null;

      });

      setLayoutPreviewError(e instanceof Error ? e.message : "Preview failed");

    } finally {

      if (previewRequestGenRef.current === gen) setLayoutPreviewBusy(false);

    }

  }, [

    templateUsed,

    taskId,

    slideCount,

    editorSlide,

    instagramHandle,

    reprintTextBacking,

    layerPosDraft,

    slideDrafts,

    job?.run_id,

  ]);



  useEffect(

    () => () => {

      setLayoutPreviewUrl((prev) => {

        if (prev) URL.revokeObjectURL(prev);

        return null;

      });

    },

    []

  );



  const docAiLayerBoxes = useMemo(() => parseDocAiLayerBoxes(renderInspect), [renderInspect]);

  const docAiSavedOverrides = useMemo(() => parseDocAiSavedOverrides(renderInspect), [renderInspect]);

  const initialOverridesForEditor = useMemo(() => {

    const cached = slideDrafts[editorSlide];

    if (cached?.length) return cached;

    return docAiSavedOverrides;

  }, [slideDrafts, editorSlide, docAiSavedOverrides]);



  async function handleSaveLayerPositions() {

    if (!taskId.trim() || !projectSlug.trim() || layerPosDraft.length === 0) return;

    setLayerPosSaving(true);

    setLayerPosError(null);

    setLayerPosMsg(null);

    try {

      await persistLayerPositions(editorSlide, layerPosDraft);

      setLayoutBaseline(JSON.stringify(layerPosDraft));

      setUserTouchedLayout(false);

      setSlidesWithSavedLayout((prev) => {

        const next = new Set(prev).add(editorSlide);

        const savedList = [...next].sort((a, b) => a - b);

        setLayerPosMsg(`Saved slide ${editorSlide}. Layouts: ${savedList.join(", ")}.`);

        return next;

      });

    } catch (e) {

      setLayerPosError(e instanceof Error ? e.message : "Save failed");

    } finally {

      setLayerPosSaving(false);

    }

  }



  async function handleReprintTextOverlay() {

    if (!taskId.trim() || !projectSlug.trim()) return;

    setReprintBusy(true);

    setReprintError(null);

    setReprintMsg("Saving layout and reprinting…");

    try {

      const slide_indices = reprintScope === "selected" ? [editorSlide] : undefined;

      const allDrafts: Record<number, DocAiLayerOverride[]> = { ...slideDrafts };

      if (layerPosDraft.length > 0) allDrafts[editorSlide] = layerPosDraft;

      for (const [slideKey, positions] of Object.entries(allDrafts)) {

        if (positions.length === 0) continue;

        const slideIndex = Number(slideKey);

        if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;

        await persistLayerPositions(slideIndex, positions);

      }



      await requestTextOverlayReprint(slide_indices, allDrafts, editorSlide, layerPosDraft);

      setSlidesWithSavedLayout((prev) => {

        const next = new Set(prev);

        for (const key of Object.keys(slideDrafts)) {

          const n = Number(key);

          if (Number.isFinite(n) && n >= 1) next.add(n);

        }

        if (layerPosDraft.length > 0) next.add(editorSlide);

        return next;

      });

      if (layerPosDraft.length > 0) setLayoutBaseline(JSON.stringify(layerPosDraft));

    } catch (e) {

      setReprintError(e instanceof Error ? e.message : "Reprint failed");

      setReprintMsg(null);

    } finally {

      setReprintBusy(false);

    }

  }



  async function handleRegenerateSlideImage() {

    if (!taskId.trim() || !projectSlug.trim()) return;

    setRegenerateBusy(true);

    setRegenerateError(null);

    setRegenerateMsg(null);

    try {

      const res = await fetch("/api/task/regenerate-carousel-slides", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          task_id: taskId,

          project: projectSlug.trim(),

          slide_indices: [editorSlide],

        }),

      });

      const json = (await res.json()) as { ok?: boolean; accepted?: boolean; message?: string; error?: string };

      if ((!res.ok && res.status !== 202) || !json.ok) {

        throw new Error(json.error ?? json.message ?? `Regenerate failed (${res.status})`);

      }

      setRegenerateMsg(json.message ?? `Regenerating slide ${editorSlide}…`);

      refreshCarouselAfterReprint();

    } catch (e) {

      setRegenerateError(e instanceof Error ? e.message : "Regenerate failed");

    } finally {

      setRegenerateBusy(false);

    }

  }



  if (!job) return null;



  const showEditor = docAiLayerBoxes.length > 0;



  return (

    <div className="mimic-layer-editor-panel">

      <p className="mimic-layer-editor-panel__title">Text layout</p>

      <p className="mimic-layer-editor-panel__hint">

        Drag boxes on the art-only plate. White highlights match reprint when text backing is on. Save layout,

        then Reprint to update carousel PNGs. Use Preview render to check Puppeteer output (slow).

      </p>



      <div className="mimic-layer-editor-panel__slide-row">

        {Array.from({ length: Math.max(slideCount, 1) }, (_, i) => i + 1).map((n) => {

          const active = editorSlide === n;

          const saved = slidesWithSavedLayout.has(n);

          return (

            <button
              key={n}
              type="button"
              className={`mimic-layer-editor-panel__slide-btn ${active ? "btn-primary" : "btn-ghost"}`}
              onClick={() => trySetEditorSlide(n)}
            >

              {n}

              {saved ? <span className="mimic-layer-editor-panel__saved-dot" title="Layout saved" /> : null}

            </button>

          );

        })}

        {layoutDirty ? (
          <span className="mimic-layer-editor-panel__slide-row-meta mimic-layer-editor-panel__slide-row-meta--warn">
            Unsaved
          </span>
        ) : null}

        {renderInspectLoading ? (
          <span className="mimic-layer-editor-panel__slide-row-meta">Updating…</span>
        ) : null}

        <span className="mimic-layer-editor-panel__slide-row-spacer" aria-hidden />

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={layoutPreviewBusy || docAiLayerBoxes.length === 0}
          onClick={() => void refreshLayoutPreview()}
        >

          {layoutPreviewBusy ? "Preview…" : "Preview render"}

        </button>

      </div>



      {!showEditor && !renderInspectLoading ? (

        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No text layers on this slide.</p>

      ) : !showEditor && renderInspectLoading ? (

        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Loading layout…</p>

      ) : (

        <>

          <MimicDocAiLayerPositionEditor

            slideIndex={editorSlide}

            backgroundUrl={getBackgroundUrl?.(editorSlide)}

            layers={docAiLayerBoxes}

            initialOverrides={initialOverridesForEditor}

            onOverridesChange={handleLayerDraftChange}

            onLayoutInitialized={handleLayoutInitialized}

            textBacking={reprintTextBacking}

            renderPreviewUrl={layoutPreviewUrl}

            renderPreviewBusy={layoutPreviewBusy}

            projectHandle={instagramHandle}

            suppressReseed={userTouchedLayout}

          />

          {layoutPreviewError ? (

            <p className="mimic-layer-editor-panel__error" style={{ marginTop: 6 }}>

              {layoutPreviewError}

            </p>

          ) : null}

          <div className="mimic-layer-editor-panel__actions">
            <button
              type="button"
              className="btn-primary btn-block"
              disabled={layerPosSaving || docAiLayerBoxes.length === 0}
              onClick={() => handleSaveLayerPositions()}
            >
              {layerPosSaving ? "Saving…" : `Save layout — slide ${editorSlide}`}
            </button>
          </div>

          {layerPosMsg ? <p className="mimic-layer-editor-panel__status">{layerPosMsg}</p> : null}

          {layerPosError ? <p className="mimic-layer-editor-panel__error">{layerPosError}</p> : null}

        </>

      )}



      <div className="mimic-layer-editor-panel__reprint">

        <div className="mimic-layer-editor-panel__reprint-options">

          <label className="mimic-layer-editor-panel__option">

            <input type="radio" name="mimic-reprint-scope" checked={reprintScope === "all"} onChange={() => setReprintScope("all")} />

            <span>All slides</span>

          </label>

          <label className="mimic-layer-editor-panel__option">

            <input

              type="radio"

              name="mimic-reprint-scope"

              checked={reprintScope === "selected"}

              onChange={() => setReprintScope("selected")}

            />

            <span>Slide {editorSlide} only</span>

          </label>

          <label className="mimic-layer-editor-panel__option mimic-layer-editor-panel__option--muted">

            <input type="checkbox" checked={reprintTextBacking} onChange={(e) => setReprintTextBacking(e.target.checked)} />

            <span>White highlight boxes</span>

          </label>

        </div>

        <button
          type="button"
          className="btn-secondary btn-block mimic-layer-editor-panel__reprint-btn"
          disabled={reprintBusy}
          onClick={() => handleReprintTextOverlay()}
        >

          {reprintBusy ? "Reprinting…" : "Reprint text"}

        </button>

        {reprintMsg ? <p className="mimic-layer-editor-panel__status">{reprintMsg}</p> : null}

        {reprintError ? <p className="mimic-layer-editor-panel__error">{reprintError}</p> : null}

      </div>



      <div className="mimic-layer-editor-panel__regenerate">

        <p className="mimic-layer-editor-panel__regenerate-hint">

          Runs Flux/Qwen again for slide {editorSlide} only (billed). Use after art or composition issues — not for copy or layout tweaks.

        </p>

        <button
          type="button"
          className="btn-secondary btn-block mimic-layer-editor-panel__regenerate-btn"
          disabled={regenerateBusy || reprintBusy || layerPosSaving}
          onClick={() => void handleRegenerateSlideImage()}
        >

          {regenerateBusy ? "Regenerating…" : `Regenerate image — slide ${editorSlide}`}

        </button>

        {regenerateMsg ? <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p> : null}

        {regenerateError ? <p className="mimic-layer-editor-panel__error">{regenerateError}</p> : null}

      </div>

    </div>

  );

}


