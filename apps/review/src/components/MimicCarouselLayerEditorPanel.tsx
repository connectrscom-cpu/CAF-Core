"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {

  MimicDocAiLayerPositionEditor,

  type DocAiLayerBox,

  type DocAiLayerOverride,

} from "@/components/MimicDocAiLayerPositionEditor";

import {
  formatMimicTextBackingBackground,
  mimicTextBackingColorToHex,
} from "@caf-core-carousel/mimic-slide-typography";
import { refKeyFromLayerPositionKey } from "@caf-core-carousel/mimic-docai-layer-positions";



function isDraftHiddenForLayer(
  layerKey: string,
  draftByKey: Map<string, DocAiLayerOverride>
): boolean {
  if (draftByKey.get(layerKey)?.hidden) return true;
  const refKey = refKeyFromLayerPositionKey(layerKey);
  if (draftByKey.get(refKey)?.hidden) return true;
  for (const draft of draftByKey.values()) {
    if (draft.hidden && refKeyFromLayerPositionKey(draft.layer_key) === refKey) return true;
  }
  return false;
}

function looksLikeHandleText(text: string): boolean {
  return /^@[a-z0-9_.]{2,}$/i.test(text.trim());
}

function layoutRoleMatchesField(layerRole: string, fieldRole: string): boolean {
  const lr = layerRole.toLowerCase();
  const fr = fieldRole.toLowerCase();
  if (lr === fr) return true;
  if (fr === "headline" && ["headline", "title", "hook", "subheadline"].includes(lr)) return true;
  if (fr === "body" && ["body", "subtitle", "caption"].includes(lr)) return true;
  if (fr === "handle" && ["handle", "watermark"].includes(lr)) return true;
  return false;
}

function inferDocAiLayerRole(
  layer: DocAiLayerBox,
  row: DocAiLayerOverride | undefined,
  fullBleed: boolean
): string {
  const text = (row?.text ?? layer.text ?? "").trim();
  if (looksLikeHandleText(text)) return "handle";
  if (layer.role === "handle" || layer.layer_key?.includes("handle")) return "handle";
  if (fullBleed) return "body";
  return layer.role || "body";
}

function isPlaceholderCustomLayer(layer: DocAiLayerBox, row: DocAiLayerOverride | undefined): boolean {
  if (!layer.layer_key?.startsWith("custom_")) return false;
  const text = (row?.text ?? layer.text ?? "").trim();
  return !text || text === "New text";
}

function asRec(v: unknown): Record<string, unknown> | null {

  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

}

function readJobTextBackingColorHex(job: Record<string, unknown> | null): string {
  const gp = asRec(job?.generation_payload);
  const gen = asRec(gp?.generated_output);
  const render = asRec(gen?.render);
  const stored = typeof render?.mimic_text_backing_color === "string" ? render.mimic_text_backing_color : null;
  return mimicTextBackingColorToHex(stored);
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



function overridesForPersist(rows: DocAiLayerOverride[], templateBgMode = false): DocAiLayerOverride[] {
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
    if (templateBgMode) {
      const { text: _text, ...rest } = r;
      if (r.box_locked) return rest as DocAiLayerOverride;
      const { w_px: _w, h_px: _h, box_locked: _b, ...posOnly } = rest;
      return posOnly as DocAiLayerOverride;
    }
    if (r.box_locked) return r;
    const { w_px: _w, h_px: _h, box_locked: _b, text: _t, ...rest } = r;
    return rest;
  });
}

/** Inspect must always return full OCR slots — hidden is reprint-only for template_bg. */
function overridesForInspect(rows: DocAiLayerOverride[], templateBgMode = false): DocAiLayerOverride[] {
  const persisted = overridesForPersist(rows, templateBgMode);
  if (!templateBgMode) return persisted;
  return persisted.filter((row) => !row.hidden);
}

function mergeDocAiLayerPositionsForReprint(
  mimicV1: Record<string, unknown> | null,
  slideDrafts: Record<number, DocAiLayerOverride[]>,
  editorSlide: number,
  currentDraft: DocAiLayerOverride[],
  templateBgMode = false
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

    if (rows.length > 0) merged[slideKey] = overridesForPersist(rows, templateBgMode);
  }
  if (currentDraft.length > 0) {
    merged[String(editorSlide)] = overridesForPersist(currentDraft, templateBgMode);

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

    .map((row, blockIndex) => {

      const r = asRec(row);

      if (!r) return null;

      const layer_key = String(r.layer_key ?? "").trim();

      const text = String(r.text ?? "").trim();

      if (!layer_key || !text) return null;

      const font_weight = Number(r.font_weight);

      const color_hex = typeof r.color_hex === "string" ? r.color_hex.trim() : undefined;

      const font_family = typeof r.font_family === "string" ? r.font_family.trim() : undefined;

      return {

        layer_key,

        text,

        role: String(r.role ?? "body"),

        x_px: Number(r.x_px) || 0,

        y_px: Number(r.y_px) || 0,

        w_px: Math.max(24, Number(r.w_px) || 120),

        h_px: Math.max(20, Number(r.h_px) || 48),

        font_size_px: Number(r.font_size_px) > 0 ? Number(r.font_size_px) : undefined,

        ...(Number.isFinite(font_weight) && font_weight >= 100 ? { font_weight } : {}),

        ...(color_hex && /^#[0-9a-fA-F]{3,8}$/.test(color_hex) ? { color_hex } : {}),

        ...(font_family ? { font_family } : {}),

        block_index: blockIndex,

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
      const font_weight = Number(r.font_weight);
      const color_hex =
        typeof r.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color_hex.trim())
          ? r.color_hex.trim()
          : undefined;
      const font_family = typeof r.font_family === "string" ? r.font_family.trim() : undefined;

      return {

        layer_key,

        x_px,

        y_px,

        ...(Number.isFinite(font_size_px) && font_size_px > 0 ? { font_size_px } : {}),

        ...(persistBox && Number.isFinite(w_px) && w_px > 0 ? { w_px } : {}),

        ...(persistBox && Number.isFinite(h_px) && h_px > 0 ? { h_px } : {}),

        ...(text?.trim() ? { text: text.trim() } : custom ? { text: "New text" } : {}),

        ...(Number.isFinite(font_weight) && font_weight >= 100 ? { font_weight } : {}),

        ...(color_hex ? { color_hex } : {}),

        ...(font_family ? { font_family } : {}),

        ...(r.font_style_italic === true ? { font_style_italic: true } : {}),

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

  onDeleteSlide?: (slideIndex1Based: number) => void;

  activeTextBlockIndex?: number | null;

  onActiveTextBlockIndexChange?: (blockIndex: number | null) => void;

  /** Full-bleed mimic (not template_bg): neutral box labels + text-block sync. */
  fullBleedMode?: boolean;

  /** template_bg: map left-column fields to layout layers by OCR role, not array index. */
  templateBgMode?: boolean;

  /** Ordered roles for left-column fields (e.g. ["headline", "body"]). */
  templateBgFieldRoles?: string[];

  /** Changes when template_bg slide copy changes — triggers layout inspect refresh. */
  templateBgCopyFingerprint?: string;

  /** Fired when layout boxes for the active slide change (for left-column text fields). */
  onLayoutTextBlocksChange?: (
    slideIndex: number,
    blocks: Array<{ role: string; text: string; layer_key: string }>
  ) => void;

  /** Register handler so left-column text edits update layout box copy. */
  registerTextBlockUpdater?: (
    fn: ((blockIndex: number, text: string) => void) | null
  ) => void;

  /** Project brand palette (hex) for color quick-pick swatches. */
  brandPalette?: string[];

  /** Project brand logo URL — composited lower-right when the logo toggle is on. */
  brandLogoUrl?: string;

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

  onDeleteSlide,

  activeTextBlockIndex = null,

  onActiveTextBlockIndexChange,

  fullBleedMode = false,

  templateBgMode = false,

  templateBgFieldRoles = [],

  templateBgCopyFingerprint = "",

  onLayoutTextBlocksChange,

  registerTextBlockUpdater,

  brandPalette = [],

  brandLogoUrl = "",

}: MimicCarouselLayerEditorPanelProps) {

  const [logoEnabled, setLogoEnabled] = useState(false);
  const logoOverlayPayload = useMemo(
    () => (logoEnabled && brandLogoUrl.trim() ? { url: brandLogoUrl.trim(), position: "br" } : undefined),
    [logoEnabled, brandLogoUrl]
  );

  // Current slide is controlled by the parent (`activeSlideIndex`) — single source of
  // truth. No local slide state, so carousel arrows and these slide buttons can never
  // ping-pong against each other.
  const editorSlide = Math.max(1, Math.min(Math.max(slideCount, 1), Math.floor(activeSlideIndex) || 1));

  const [renderInspect, setRenderInspect] = useState<Record<string, unknown> | null>(null);

  const [renderInspectLoading, setRenderInspectLoading] = useState(false);

  const inspectRequestGenRef = useRef(0);

  const [reprintScope, setReprintScope] = useState<"selected" | "all">("all");

  const [reprintTextBacking, setReprintTextBacking] = useState(true);
  const [reprintTextBackingHex, setReprintTextBackingHex] = useState(() => readJobTextBackingColorHex(job));
  const [userTouchedLayout, setUserTouchedLayout] = useState(false);

  useEffect(() => {
    setReprintTextBackingHex(readJobTextBackingColorHex(job));
  }, [job]);

  const reprintTextBackingCss = useMemo(
    () => formatMimicTextBackingBackground(reprintTextBackingHex),
    [reprintTextBackingHex]
  );

  const [reprintBusy, setReprintBusy] = useState(false);

  const [reprintMsg, setReprintMsg] = useState<string | null>(null);

  const [reprintError, setReprintError] = useState<string | null>(null);

  const [regenerateBusy, setRegenerateBusy] = useState(false);

  const [regenerateMsg, setRegenerateMsg] = useState<string | null>(null);

  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // Regenerate route picker (1.6): similarity preset + reference on/off.
  const [regenSimilarityPct, setRegenSimilarityPct] = useState<number>(85);
  const [regenUseReference, setRegenUseReference] = useState<boolean>(true);
  const [showRegenRoute, setShowRegenRoute] = useState<boolean>(false);

  const lastEmittedTextBlocksRef = useRef<string>("");
  const [layerPosDraft, setLayerPosDraft] = useState<DocAiLayerOverride[]>([]);

  const [slideDrafts, setSlideDrafts] = useState<Record<number, DocAiLayerOverride[]>>({});

  // Slide change: clear inspect snapshot so the left-column text blocks never
  // render stale copy from the previous slide.
  useEffect(() => {
    lastEmittedTextBlocksRef.current = "";
    setLayoutBaseline("");
    setUserTouchedLayout(false);
    setRenderInspect(null);
    setRenderInspectLoading(true);

    const cached = slideDrafts[editorSlide];
    setLayerPosDraft(cached?.length ? [...cached] : []);
  }, [editorSlide]);

  // Initial load: if slideDrafts arrives after first render, hydrate layerPosDraft
  // only when we currently have no draft.
  useEffect(() => {
    if (layerPosDraft.length > 0) return;
    const cached = slideDrafts[editorSlide];
    if (cached?.length) setLayerPosDraft([...cached]);
  }, [slideDrafts, editorSlide]);

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

          positions: overridesForPersist(positions, templateBgMode),

        }),

      });

      const json = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !json.ok) {

        throw new Error(json.error ?? `Save failed (${res.status})`);

      }

      onMimicLayoutSaved?.(slideIndex, overridesForPersist(positions, templateBgMode));
    },
    [taskId, projectSlug, onMimicLayoutSaved, templateBgMode]
  );


  const autoReprintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCarouselAfterReprint = useCallback(() => {
    void onReprintComplete?.();
    window.setTimeout(() => void onReprintComplete?.(), 35_000);
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
        currentDraft,
        templateBgMode
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
          text_backing_color: reprintTextBackingCss,
          ...(logoOverlayPayload ? { logo_overlay: logoOverlayPayload } : {}),
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
      reprintTextBackingCss,
      logoOverlayPayload,
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



  // Persist any pending layout for the slide we are leaving, then ask the parent to
  // switch. The parent updates `activeSlideIndex`, which flows back as `editorSlide`.
  const goToSlide = useCallback(
    (nextSlide: number) => {
      const n = Math.max(1, Math.min(slideCount, Math.floor(nextSlide) || 1));
      if (n === editorSlide) return;
      if (userTouchedLayout && layoutDirty) {
        void flushCurrentSlideLayout();
      }
      setLayerPosMsg(null);
      setLayerPosError(null);
      onSlideSelect?.(n);
    },
    [editorSlide, slideCount, userTouchedLayout, layoutDirty, flushCurrentSlideLayout, onSlideSelect]
  );

  // Silent debounced auto-save: persist layout positions (cheap, no billed reprint) so
  // box moves/deletes survive slide switches and refetches. Reprint stays explicit.
  useEffect(() => {
    if (!userTouchedLayout || !layoutDirty || layerPosDraft.length === 0) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          await persistLayerPositions(editorSlide, layerPosDraft);
          setSlideDrafts((prev) => ({ ...prev, [editorSlide]: layerPosDraft }));
          setLayoutBaseline(JSON.stringify(layerPosDraft));
          if (!templateBgMode) setUserTouchedLayout(false);
          setSlidesWithSavedLayout((prev) => new Set(prev).add(editorSlide));
        } catch (e) {
          setLayerPosError(e instanceof Error ? e.message : "Auto-save failed");
        }
      })();
    }, 1200);
    return () => clearTimeout(t);
  }, [layerPosDraft, userTouchedLayout, layoutDirty, editorSlide, persistLayerPositions, templateBgMode]);



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



  const persistedPositionsForInspect = useMemo(
    () =>
      overridesForInspect(
        layerPosDraft.length > 0 ? layerPosDraft : slideDrafts[editorSlide] ?? [],
        templateBgMode
      ),
    [layerPosDraft, slideDrafts, editorSlide, templateBgMode]
  );

  // Inspect only needs the *base* OCR layer geometry, which changes per slide — not on
  // every keystroke. We read the current copy/positions from refs so typing never
  // retriggers the fetch (this is what caused the flicker between text blocks).
  const persistedPositionsForInspectRef = useRef(persistedPositionsForInspect);
  persistedPositionsForInspectRef.current = persistedPositionsForInspect;



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

              text_backing_color: reprintTextBackingCss,

              ...(persistedPositionsForInspectRef.current.length > 0

                ? { docai_layer_positions: persistedPositionsForInspectRef.current }

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

  }, [templateUsed, editorSlide, slideCount, instagramHandle, reprintTextBacking, reprintTextBackingCss, templateBgCopyFingerprint]);

  const docAiLayerBoxes = useMemo(() => {
    const boxes = parseDocAiLayerBoxes(renderInspect);
    if (templateBgMode) {
      let blockIndex = 0;
      return boxes.map((layer) => {
        const withIdx = { ...layer, block_index: blockIndex };
        blockIndex += 1;
        return withIdx;
      });
    }
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    const filtered = boxes.filter((layer) => {
      if (isDraftHiddenForLayer(layer.layer_key, draftByKey)) return false;
      if (isPlaceholderCustomLayer(layer, draftByKey.get(layer.layer_key))) return false;
      return true;
    });
    let blockIndex = 0;
    return filtered.map((layer) => {
      const withIdx = { ...layer, block_index: blockIndex };
      blockIndex += 1;
      return withIdx;
    });
  }, [renderInspect, layerPosDraft, templateBgMode]);

  const layoutTextBlocks = useMemo(() => {
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    return docAiLayerBoxes.map((layer) => {
      const row = draftByKey.get(layer.layer_key);
      const role = inferDocAiLayerRole(layer, row, fullBleedMode);
      return {
        role,
        text: row?.text?.trim() || layer.text,
        layer_key: layer.layer_key,
        block_index: layer.block_index ?? 0,
      };
    });
  }, [docAiLayerBoxes, layerPosDraft, fullBleedMode]);

  useEffect(() => {
    if (!onLayoutTextBlocksChange) return;
    const next = layoutTextBlocks.map(({ role, text, layer_key }) => ({ role, text, layer_key }));
    const fingerprint = `${editorSlide}:${JSON.stringify(next)}`;
    if (fingerprint === lastEmittedTextBlocksRef.current) return;
    lastEmittedTextBlocksRef.current = fingerprint;
    onLayoutTextBlocksChange(editorSlide, next);
  }, [layoutTextBlocks, editorSlide, onLayoutTextBlocksChange]);

  const activeLayoutBlockIndex = useMemo(() => {
    if (activeTextBlockIndex == null) return null;
    if (!templateBgMode || templateBgFieldRoles.length === 0) return activeTextBlockIndex;
    const fieldRole = templateBgFieldRoles[activeTextBlockIndex];
    if (!fieldRole) return activeTextBlockIndex;
    const match = layoutTextBlocks.find((layer) => layoutRoleMatchesField(layer.role, fieldRole));
    return match?.block_index ?? activeTextBlockIndex;
  }, [activeTextBlockIndex, templateBgMode, templateBgFieldRoles, layoutTextBlocks]);

  const handleActiveLayoutBlockChange = useCallback(
    (blockIndex: number | null) => {
      if (!onActiveTextBlockIndexChange) return;
      if (!templateBgMode || blockIndex == null) {
        onActiveTextBlockIndexChange(blockIndex);
        return;
      }
      const layer = layoutTextBlocks.find((l) => l.block_index === blockIndex);
      if (!layer) {
        onActiveTextBlockIndexChange(blockIndex);
        return;
      }
      const fieldIdx = templateBgFieldRoles.findIndex((role) => layoutRoleMatchesField(layer.role, role));
      onActiveTextBlockIndexChange(fieldIdx >= 0 ? fieldIdx : blockIndex);
    },
    [onActiveTextBlockIndexChange, templateBgMode, templateBgFieldRoles, layoutTextBlocks]
  );

  useEffect(() => {
    if (!registerTextBlockUpdater) return;
    registerTextBlockUpdater((blockIndex, text) => {
      const fieldRole = templateBgMode ? templateBgFieldRoles[blockIndex] : undefined;
      const inspectBoxes = parseDocAiLayerBoxes(renderInspect);
      const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
      const roleForBox = (layer: DocAiLayerBox) =>
        inferDocAiLayerRole(layer, draftByKey.get(layer.layer_key), fullBleedMode);

      const resolveLayoutBlockToBox = (
        layoutBlock: (typeof layoutTextBlocks)[number] | undefined
      ): DocAiLayerBox | undefined => {
        if (!layoutBlock) return undefined;
        return docAiLayerBoxes.find((layer) => layer.layer_key === layoutBlock.layer_key);
      };

      let target: DocAiLayerBox | undefined;
      if (fieldRole != null) {
        target = inspectBoxes.find((layer) => layoutRoleMatchesField(roleForBox(layer), fieldRole));
        if (!target) {
          const layoutMatch = layoutTextBlocks.find((layer) =>
            layoutRoleMatchesField(layer.role, fieldRole)
          );
          target = resolveLayoutBlockToBox(layoutMatch);
        }
      } else {
        target =
          inspectBoxes[blockIndex] ?? resolveLayoutBlockToBox(layoutTextBlocks[blockIndex]);
      }
      if (!target) target = resolveLayoutBlockToBox(layoutTextBlocks[blockIndex]);
      if (!target) return;
      if (fieldRole === "body" && roleForBox(target) === "handle") return;
      if (fieldRole === "headline" && roleForBox(target) === "handle") return;
      const base =
        layerPosDraft.length > 0
          ? layerPosDraft
          : docAiLayerBoxes.map((layer) => ({
              layer_key: layer.layer_key,
              x_px: layer.x_px,
              y_px: layer.y_px,
              w_px: layer.w_px,
              h_px: layer.h_px,
              font_size_px: layer.font_size_px,
              text: layer.text,
              box_locked: true,
            }));
      const next = base.some((r) => r.layer_key === target.layer_key)
        ? base.map((r) => (r.layer_key === target.layer_key ? { ...r, text } : r))
        : [
            ...base,
            {
              layer_key: target.layer_key,
              x_px: 0,
              y_px: 0,
              text,
              box_locked: true,
            },
          ];
      handleLayerDraftChange(next);
    });
    return () => registerTextBlockUpdater(null);
  }, [
    registerTextBlockUpdater,
    layoutTextBlocks,
    layerPosDraft,
    docAiLayerBoxes,
    handleLayerDraftChange,
    templateBgMode,
    templateBgFieldRoles,
    renderInspect,
    fullBleedMode,
  ]);

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

          visual_similarity_pct: regenSimilarityPct,

          image_input_mode: regenUseReference ? "reference_edit" : "analysis_t2i",

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
  const hasHiddenDraftLayers = layerPosDraft.some((row) => row.hidden);

  const restoreDefaultLayout = useCallback(() => {
    const cleared = layerPosDraft.filter((row) => !row.hidden);
    handleLayerDraftChange(cleared);
  }, [layerPosDraft, handleLayerDraftChange]);



  return (

    <div className="mimic-layer-editor-panel">

      <div className="mimic-layer-editor-panel__head">
        <p className="mimic-layer-editor-panel__title">Text layout</p>
      </div>



      <div className="mimic-layer-editor-panel__slide-row">

        <span className="mimic-layer-editor-panel__slide-counter">Slide {editorSlide} / {slideCount}</span>

        {Array.from({ length: Math.max(slideCount, 1) }, (_, i) => i + 1).map((n) => {

          const active = editorSlide === n;

          const saved = slidesWithSavedLayout.has(n);

          return (

            <button
              key={n}
              type="button"
              className={`mimic-layer-editor-panel__slide-btn ${active ? "btn-primary" : "btn-ghost"}`}
              onClick={() => goToSlide(n)}
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
          className={`btn-ghost btn-sm${showRegenRoute ? " mimic-regen-route__toggle--open" : ""}`}
          onClick={() => setShowRegenRoute((v) => !v)}
          title="Pick how the image regenerates"
          aria-expanded={showRegenRoute}
        >
          Route ▾
        </button>

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={regenerateBusy || reprintBusy || layerPosSaving}
          onClick={() => void handleRegenerateSlideImage()}
          title="Run Flux/Qwen again for this slide (billed)"
        >
          {regenerateBusy ? "Regenerating…" : "Regenerate"}
        </button>

        {onDeleteSlide && slideCount > 1 ? (
          <button
            type="button"
            className="btn-danger-ghost btn-sm"
            onClick={() => {
              if (window.confirm(`Remove slide ${editorSlide} from this deck?`)) {
                onDeleteSlide(editorSlide);
              }
            }}
            title="Remove this slide from the carousel deck"
          >
            Delete slide
          </button>
        ) : null}

      </div>

      {showRegenRoute ? (
        <div className="mimic-regen-route">
          <div className="mimic-regen-route__group">
            <span className="mimic-regen-route__label">Similarity</span>
            {[
              { pct: 85, label: "Close ~85%" },
              { pct: 60, label: "Variant ~60%" },
              { pct: 25, label: "Bold ~25%" },
            ].map((opt) => (
              <button
                key={opt.pct}
                type="button"
                className={`mimic-regen-route__chip${regenSimilarityPct === opt.pct ? " mimic-regen-route__chip--on" : ""}`}
                onClick={() => setRegenSimilarityPct(opt.pct)}
              >
                {opt.label}
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={100}
              value={regenSimilarityPct}
              onChange={(e) => {
                const n = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                setRegenSimilarityPct(n);
              }}
              className="mimic-regen-route__num"
              title="Visual similarity %"
            />
          </div>
          <div className="mimic-regen-route__group">
            <span className="mimic-regen-route__label">Reference</span>
            <button
              type="button"
              className={`mimic-regen-route__chip${regenUseReference ? " mimic-regen-route__chip--on" : ""}`}
              onClick={() => setRegenUseReference(true)}
            >
              Use reference
            </button>
            <button
              type="button"
              className={`mimic-regen-route__chip${!regenUseReference ? " mimic-regen-route__chip--on" : ""}`}
              onClick={() => setRegenUseReference(false)}
              title="Generate from analysis only (no reference image)"
            >
              No reference
            </button>
          </div>
          <p className="mimic-regen-route__note">
            Text is always added as an editable HTML overlay — image models never bake copy.
          </p>
        </div>
      ) : null}

      {regenerateMsg ? <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p> : null}
      {regenerateError ? <p className="mimic-layer-editor-panel__error">{regenerateError}</p> : null}

      <div className="mimic-layer-editor-panel__highlight">
        <label className="mimic-layer-editor-panel__option">
          <input
            type="checkbox"
            checked={reprintTextBacking}
            onChange={(e) => setReprintTextBacking(e.target.checked)}
          />
          <span>Highlight behind text</span>
        </label>
        {reprintTextBacking ? (
          <label className="mimic-layer-editor-panel__highlight-color">
            <span>Colour</span>
            <input
              type="color"
              value={reprintTextBackingHex}
              onChange={(e) => setReprintTextBackingHex(e.target.value)}
              title="Highlight colour behind text"
            />
          </label>
        ) : null}
        {reprintTextBacking && brandPalette.length > 0 ? (
          <div className="brand-swatches" title="Brand palette">
            {brandPalette.map((hex) => (
              <button
                key={hex}
                type="button"
                className="brand-swatch"
                style={{ background: hex }}
                title={hex}
                aria-label={`Use ${hex}`}
                onClick={() => setReprintTextBackingHex(hex)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {brandLogoUrl.trim() ? (
        <div className="mimic-layer-editor-panel__highlight">
          <label className="mimic-layer-editor-panel__option">
            <input
              type="checkbox"
              checked={logoEnabled}
              onChange={(e) => setLogoEnabled(e.target.checked)}
            />
            <span>Stamp brand logo (lower-right)</span>
          </label>
          {logoEnabled ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogoUrl} alt="Brand logo" className="brand-logo-chip" />
          ) : null}
        </div>
      ) : null}

      {!showEditor && !renderInspectLoading ? (

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>No text layers on this slide.</p>
          {hasHiddenDraftLayers ? (
            <button type="button" className="btn-secondary btn-sm" onClick={restoreDefaultLayout}>
              Restore default text boxes
            </button>
          ) : null}
        </div>

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

            textBackingColor={reprintTextBackingCss}

            projectHandle={instagramHandle}

            suppressReseed={userTouchedLayout}

            activeBlockIndex={activeLayoutBlockIndex}

            onActiveBlockIndexChange={handleActiveLayoutBlockChange}

            fullBleedMode={fullBleedMode}

            templateBgMode={templateBgMode}

            brandPalette={brandPalette}

            logoOverlayUrl={logoOverlayPayload ? brandLogoUrl : ""}

          />

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

    </div>

  );

}


