"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MimicDocAiLayerPositionEditor,
  openHighlightBoxForText,
  type DocAiLayerBox,

  type DocAiLayerOverride,

  type DocAiLayerTypographyStyle,
  type DocAiLayerPlacementStyle,

} from "@/components/MimicDocAiLayerPositionEditor";

import {
  formatMimicTextBackingBackground,
  mimicTextBackingColorToHex,
} from "@caf-core-carousel/mimic-slide-typography";
import { refKeyFromLayerPositionKey } from "@caf-core-carousel/mimic-docai-layer-positions";
import {
  templateBgSlideIndicesForSlot,
  templateBgSlotForSlide,
  type MimicTemplateBgSlot,
} from "@/lib/mimic-template-bg";
import {
  clusterIndexForOcrBoxIndex,
  ocrBoxSpanForClusterIndex,
  slideRecordForCopySlots,
} from "@/lib/carousel-slides";
import {
  copySlotsForSlideRecord,
  splitLineForRefBlocks,
  type MimicReferenceCopySlot,
} from "@caf-core-carousel/mimic-copy-slots";



function isDraftHiddenForLayer(
  layerKey: string,
  draftByKey: Map<string, DocAiLayerOverride>
): boolean {
  if (draftByKey.get(layerKey)?.hidden) return true;
  const refKey = refKeyFromLayerPositionKey(layerKey);
  if (refKey !== layerKey && draftByKey.get(refKey)?.hidden) return true;
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

function roleFromLayerKey(layerKey: string): string {
  if (layerKey.startsWith("custom@")) {
    return (layerKey.split("@")[1] ?? "body").trim().toLowerCase();
  }
  const at = layerKey.indexOf("@");
  if (at <= 0) return "body";
  return layerKey.slice(0, at).toLowerCase();
}

function inferDocAiLayerRole(
  layer: DocAiLayerBox,
  row: DocAiLayerOverride | undefined,
  fullBleed: boolean,
  templateBg = false
): string {
  const ocrRole = (layer.role ?? "").trim().toLowerCase();
  if (templateBg) {
    if (ocrRole === "handle") return "handle";
    if (ocrRole === "headline" || ocrRole === "title" || ocrRole === "hook" || ocrRole === "subheadline") {
      return "headline";
    }
    if (ocrRole === "body" || ocrRole === "subtitle" || ocrRole === "caption") return "body";
  }
  const text = (row?.text ?? layer.text ?? "").trim();
  if (looksLikeHandleText(text)) return "handle";
  if (layer.role === "handle" || layer.layer_key?.includes("handle")) return "handle";
  if (fullBleed) return "body";
  return layer.role || "body";
}

function isPlaceholderCustomLayer(layer: DocAiLayerBox, row: DocAiLayerOverride | undefined): boolean {
  if (!layer.layer_key?.startsWith("custom@")) return false;
  const text = (row?.text ?? layer.text ?? "").trim();
  return !text || text === "New text";
}

/** Drop empty reviewer-added boxes — they must not persist, inspect, or duplicate OCR slots. */
function dropPlaceholderCustomOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.filter((row) => {
    if (!row.layer_key.startsWith("custom@")) return true;
    if (row.hidden) return true;
    const text = row.text?.trim();
    return Boolean(text && text !== "New text");
  });
}

/** Legacy inspect echoed custom copy under body@x,y:text keys — skip when a custom@ draft matches. */
function isLegacyInspectEchoOfCustomDraft(
  inspectLayer: DocAiLayerBox,
  draftRow: DocAiLayerOverride
): boolean {
  if (inspectLayer.layer_key.startsWith("custom@")) return false;
  const inspectText = (inspectLayer.text ?? "").trim();
  const draftText = (draftRow.text ?? "").trim();
  if (!inspectText || !draftText || inspectText !== draftText) return false;
  return (
    Math.abs(inspectLayer.x_px - draftRow.x_px) <= 32 &&
    Math.abs(inspectLayer.y_px - draftRow.y_px) <= 32
  );
}

function normalizePhraseKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function newCustomLayerKeyForPanel(): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `custom@body@${id}`;
}

function buildCustomPhraseOverride(
  text: string,
  blockIndex: number,
  boxes: DocAiLayerBox[]
): DocAiLayerOverride {
  const sorted = [...boxes].sort((a, b) => b.y_px - a.y_px || b.x_px - a.x_px);
  const anchor = sorted[0];
  const x_px = anchor?.x_px ?? 216;
  const y_px = anchor
    ? Math.min(1280, anchor.y_px + (anchor.h_px ?? 72) + 20 + blockIndex * 12)
    : 200 + blockIndex * 72;
  const font_size_px = 50;
  const open = openHighlightBoxForText(text, font_size_px, x_px, y_px);
  return {
    layer_key: newCustomLayerKeyForPanel(),
    x_px,
    y_px,
    w_px: open.w_px,
    h_px: open.h_px,
    font_size_px,
    text,
    box_locked: true,
  };
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



/** template_bg: hidden is reprint-only — never hydrate the editor from saved hidden markers. */
function stripTemplateBgHiddenOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.map((row) => {
    if (!row.hidden) return row;
    const { hidden: _hidden, ...rest } = row;
    return rest as DocAiLayerOverride;
  });
}

function overridesForPersist(rows: DocAiLayerOverride[], templateBgMode = false): DocAiLayerOverride[] {
  return dropPlaceholderCustomOverrides(rows).map((r) => {
    if (r.hidden) return r;
    if (r.layer_key.startsWith("custom@")) {
      const text = r.text?.trim();
      return {
        ...r,
        box_locked: true,
        w_px: r.w_px ?? 280,
        h_px: r.h_px ?? 72,
        ...(text ? { text } : {}),
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
  const persisted = dropPlaceholderCustomOverrides(overridesForPersist(rows, templateBgMode));
  if (!templateBgMode) return persisted;
  return persisted.filter((row) => !row.hidden);
}

/** template_bg: copy lives in slide fields — layer draft stores geometry only. */
function stripTextFromLayerDraft(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  return rows.map(({ text: _text, ...rest }) => rest as DocAiLayerOverride);
}

/** Drop custom@ rows that duplicate OCR copy or repeat the same phrase (bad auto-seed recovery). */
function dedupeRedundantCustomOverrides(rows: DocAiLayerOverride[]): DocAiLayerOverride[] {
  const ocrPhraseKeys = new Set<string>();
  for (const row of rows) {
    if (row.hidden || row.layer_key.startsWith("custom@")) continue;
    const key = normalizePhraseKey(row.text ?? "");
    if (key.length >= 3) ocrPhraseKeys.add(key);
  }
  const seenCustom = new Set<string>();
  return rows.filter((row) => {
    if (!row.layer_key.startsWith("custom@") || row.hidden) return true;
    if (isPlaceholderCustomLayer(
      {
        layer_key: row.layer_key,
        text: row.text ?? "",
        role: roleFromLayerKey(row.layer_key),
        x_px: row.x_px,
        y_px: row.y_px,
        w_px: row.w_px ?? 120,
        h_px: row.h_px ?? 48,
      },
      row
    )) {
      return false;
    }
    const key = normalizePhraseKey(row.text ?? "");
    if (key.length < 3) return false;
    if (seenCustom.has(key)) return false;
    for (const ocrKey of ocrPhraseKeys) {
      if (ocrKey.includes(key) || key.includes(ocrKey)) return false;
    }
    seenCustom.add(key);
    return true;
  });
}

function normalizeLayerPosDraft(rows: DocAiLayerOverride[], templateBgMode: boolean): DocAiLayerOverride[] {
  const stripped = templateBgMode ? stripTextFromLayerDraft(rows) : rows;
  return dedupeRedundantCustomOverrides(stripped);
}

function layoutDraftCompareKey(rows: DocAiLayerOverride[], _templateBgMode = false): string {
  // Geometry + style only — copy edits must not retrigger inspect, auto-save, or reseed.
  return JSON.stringify(
    rows.map((r) => ({
      k: r.layer_key,
      x: r.x_px,
      y: r.y_px,
      w: r.w_px,
      h: r.h_px,
      f: r.font_size_px,
      hidden: r.hidden,
      locked: r.box_locked,
      c: r.color_hex,
      fw: r.font_weight,
      ff: r.font_family,
    }))
  );
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



function serverSlideDraftsFromMimicV1(
  mimicV1: Record<string, unknown> | null | undefined,
  templateBgMode: boolean
): Record<number, DocAiLayerOverride[]> {
  const raw = mimicV1?.docai_layer_positions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<number, DocAiLayerOverride[]> = {};
  for (const [key, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const slideIndex = Number(key);
    if (!Number.isFinite(slideIndex) || slideIndex < 1) continue;
    out[slideIndex] = normalizeLayerPosDraft(
      templateBgMode
        ? stripTemplateBgHiddenOverrides(rows as DocAiLayerOverride[])
        : (rows as DocAiLayerOverride[]),
      templateBgMode
    );
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

      if (!layer_key) return null;

      const text = String(r.text ?? "");

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

        ...(Number.isFinite(w_px) && w_px > 0 ? { w_px } : {}),

        ...(Number.isFinite(h_px) && h_px > 0 ? { h_px } : {}),

        ...(text?.trim() ? { text: text.trim() } : custom ? { text: "New text" } : {}),

        ...(Number.isFinite(font_weight) && font_weight >= 100 ? { font_weight } : {}),

        ...(color_hex ? { color_hex } : {}),

        ...(font_family ? { font_family } : {}),

        ...(r.font_style_italic === true ? { font_style_italic: true } : {}),

        ...(Number.isFinite(w_px) && w_px > 0 && Number.isFinite(h_px) && h_px > 0
          ? { box_locked: true }
          : box_locked
            ? { box_locked: true }
            : {}),

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

  /** Parallel copy for left-column fields — synced into layout boxes without refetching inspect. */
  templateBgFieldTexts?: string[];

  /** Fired when layout boxes for the active slide change (for left-column text fields). */
  onLayoutTextBlocksChange?: (
    slideIndex: number,
    blocks: Array<{ role: string; text: string; layer_key: string }>
  ) => void;

  /** Register handler so left-column text edits update layout box copy. */
  registerTextBlockUpdater?: (
    fn: ((blockIndex: number, text: string) => void) | null
  ) => void;

  /** template_bg: push layout-editor copy edits back into slide copy (left column + reprint). */
  onTemplateBgFieldTextChange?: (slideIndex: number, fieldRole: string, text: string) => void;

  /** Project brand palette (hex) for color quick-pick swatches. */
  brandPalette?: string[];

  /** Project brand logo URL — composited lower-right when the logo toggle is on. */
  brandLogoUrl?: string;

  /** Shared mimic slide-regen prompt note (carousel header + layout editor). */
  regenerationNote?: string;
  onRegenerationNoteChange?: (value: string) => void;

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

  templateBgFieldTexts = [],

  onLayoutTextBlocksChange,

  registerTextBlockUpdater,

  onTemplateBgFieldTextChange,

  brandPalette = [],

  brandLogoUrl = "",

  regenerationNote: regenerationNoteProp,

  onRegenerationNoteChange,

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
  const inspectCacheRef = useRef<Record<number, Record<string, unknown>>>({});

  useEffect(() => {
    inspectCacheRef.current = {};
  }, [taskId]);

  const [reprintScope, setReprintScope] = useState<"selected" | "all">("all");

  const [reprintTextBacking, setReprintTextBacking] = useState(true);
  const [reprintTextBackingHex, setReprintTextBackingHex] = useState(() => readJobTextBackingColorHex(job));
  const [userTouchedLayout, setUserTouchedLayout] = useState(false);
  const [draftSyncRevision, setDraftSyncRevision] = useState(0);
  const [layoutResetToken, setLayoutResetToken] = useState(0);

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

  /** Which template_bg slot regen is in flight (for button feedback). */
  const [regeneratingSlot, setRegeneratingSlot] = useState<MimicTemplateBgSlot | null>(null);

  // Regenerate route picker (1.6): similarity preset + reference on/off.
  const [regenSimilarityPct, setRegenSimilarityPct] = useState<number>(85);
  const [regenUseReference, setRegenUseReference] = useState<boolean>(true);
  const [localRegenNote, setLocalRegenNote] = useState("");
  const regenNote = regenerationNoteProp ?? localRegenNote;
  const setRegenNote = onRegenerationNoteChange ?? setLocalRegenNote;
  const [showRegenRoute, setShowRegenRoute] = useState<boolean>(false);
  const [regenPlateOpen, setRegenPlateOpen] = useState(true);

  const lastEmittedTextBlocksRef = useRef<string>("");
  const [layerPosDraft, setLayerPosDraft] = useState<DocAiLayerOverride[]>([]);

  const [slideDrafts, setSlideDrafts] = useState<Record<number, DocAiLayerOverride[]>>({});

  // `${slide}:${geometryKey}` of the last content we persisted. Both auto-save paths
  // (slide-leave flush + debounced effect) and the manual save/reprint check this so
  // identical content is never saved or reprinted twice.
  const lastPersistedKeyRef = useRef<string>("");
  const persistKeyFor = useCallback(
    (slideIndex: number, rows: DocAiLayerOverride[]) =>
      `${slideIndex}:${layoutDraftCompareKey(rows, templateBgMode)}`,
    [templateBgMode]
  );

  // Slide change: restore per-slide inspect cache immediately; only show loading when uncached.
  useEffect(() => {
    lastEmittedTextBlocksRef.current = "";
    lastPersistedKeyRef.current = "";
    setLayoutBaseline("");
    setUserTouchedLayout(false);

    const cachedInspect = inspectCacheRef.current[editorSlide];
    if (cachedInspect) {
      setRenderInspect(cachedInspect);
      setRenderInspectLoading(false);
    } else {
      setRenderInspect(null);
      setRenderInspectLoading(true);
    }

    const cached = slideDrafts[editorSlide];
    setLayerPosDraft(
      cached?.length
        ? normalizeLayerPosDraft(
            templateBgMode ? stripTemplateBgHiddenOverrides(cached) : [...cached],
            templateBgMode
          )
        : []
    );
  }, [editorSlide, templateBgMode]);

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

  const slideCopyLayout = useMemo(() => {
    const grounding = asRec(gp.mimic_job_grounding);
    const raw = grounding?.slide_copy_layout;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : null;
  }, [gp]);

  const copySlotsForEditor = useMemo((): MimicReferenceCopySlot[] => {
    if (templateBgMode || !fullBleedMode) return [];
    const vg =
      mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object"
        ? (mimicV1.visual_guideline as Record<string, unknown>)
        : null;
    const rec = slideRecordForCopySlots(vg, slideCopyLayout, editorSlide);
    return copySlotsForSlideRecord(rec);
  }, [templateBgMode, fullBleedMode, mimicV1, slideCopyLayout, editorSlide]);

  const copySlotsRef = useRef(copySlotsForEditor);
  copySlotsRef.current = copySlotsForEditor;

  const templateUsed = useMemo(() => template || pickCarouselTemplateName(gp), [template, gp]);

  const layoutDirty =

    userTouchedLayout &&

    layerPosDraft.length > 0 &&

    // Treat an unset baseline ("") as dirty: a user edit performed before the editor
    // finished its initial seed must still be eligible for auto-save.
    (layoutBaseline === "" ||
      layoutDraftCompareKey(layerPosDraft, templateBgMode) !== layoutBaseline);

  useEffect(() => {

    setSlidesWithSavedLayout(savedLayoutSlideIndices(mimicV1));

    const fromServer = serverSlideDraftsFromMimicV1(mimicV1, templateBgMode);

    if (Object.keys(fromServer).length === 0) return;

    // Do not clobber in-progress editor drafts when the server echoes a save we already have locally.
    if (userTouchedLayoutRef.current && layoutDirty) return;

    setSlideDrafts((prev) => {
      const merged = { ...fromServer };
      for (const [key, rows] of Object.entries(prev)) {
        const slideIndex = Number(key);
        if (rows?.length) merged[slideIndex] = rows;
      }
      return merged;
    });

    setLayerPosDraft((prev) => {
      if (prev.length > 0 || userTouchedLayoutRef.current) return prev;
      const cached = fromServer[editorSlide];
      return cached?.length ? normalizeLayerPosDraft(cached, templateBgMode) : prev;
    });

  }, [mimicV1, taskId, templateBgMode, layoutDirty, editorSlide]);



  const persistLayerPositions = useCallback(

    async (slideIndex: number, positions: DocAiLayerOverride[]): Promise<void> => {

      if (!taskId.trim() || !projectSlug.trim()) return;

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

    const key = persistKeyFor(editorSlide, layerPosDraft);
    if (key === lastPersistedKeyRef.current) {
      setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));
      setUserTouchedLayout(false);
      return true;
    }

    try {

      await persistLayerPositions(editorSlide, layerPosDraft);

      lastPersistedKeyRef.current = key;

      setSlideDrafts((prev) => ({ ...prev, [editorSlide]: layerPosDraft }));

      setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));

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

    persistKeyFor,

    templateBgMode,

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

  // Debounced auto-save: persist layout, then reprint so the carousel preview matches the editor.
  useEffect(() => {
    if (!userTouchedLayout || !layoutDirty || layerPosDraft.length === 0) return;
    const t = setTimeout(() => {
      void (async () => {
        const key = persistKeyFor(editorSlide, layerPosDraft);
        if (key === lastPersistedKeyRef.current) {
          // Already saved + reprinted by the slide-leave flush (or a prior tick) —
          // just clear the dirty state so we don't loop.
          setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));
          if (!templateBgMode) setUserTouchedLayout(false);
          return;
        }
        try {
          await persistLayerPositions(editorSlide, layerPosDraft);
          lastPersistedKeyRef.current = key;
          setSlideDrafts((prev) => {
            const merged = { ...prev, [editorSlide]: layerPosDraft };
            scheduleAutoReprintForSlide(editorSlide, layerPosDraft, merged);
            return merged;
          });
          setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));
          if (!templateBgMode) setUserTouchedLayout(false);
          setSlidesWithSavedLayout((prev) => new Set(prev).add(editorSlide));
        } catch (e) {
          setLayerPosError(e instanceof Error ? e.message : "Auto-save failed");
        }
      })();
    }, 1200);
    return () => clearTimeout(t);
  }, [
    layerPosDraft,
    userTouchedLayout,
    layoutDirty,
    editorSlide,
    persistLayerPositions,
    templateBgMode,
    scheduleAutoReprintForSlide,
    persistKeyFor,
  ]);



  const handleLayoutInitialized = useCallback((overrides: DocAiLayerOverride[]) => {

    if (userTouchedLayoutRef.current) return;

    const normalized = normalizeLayerPosDraft(overrides, templateBgMode);

    setLayerPosDraft((prev) => {
      if (prev.length > 0) return prev;
      return normalized;
    });

    setSlideDrafts((prev) => {
      if (prev[editorSlide]?.length) return prev;
      return { ...prev, [editorSlide]: normalized };
    });

    setLayoutBaseline((baseline) =>
      baseline || layoutDraftCompareKey(normalized, templateBgMode)
    );

    setUserTouchedLayout(false);

  }, [editorSlide, templateBgMode]);



  const applyLayerPatchToRoleAcrossDeck = useCallback(
    (
      targetRole: "headline" | "body",
      patch: Partial<DocAiLayerOverride>,
      successLabel: string
    ) => {
      const serverDrafts = serverSlideDraftsFromMimicV1(mimicV1, templateBgMode);
      const nextDrafts: Record<number, DocAiLayerOverride[]> = { ...slideDrafts };

      const roleRefKeys = new Set<string>();
      for (let s = 1; s <= slideCount; s++) {
        const inspectLayers = parseDocAiLayerBoxes(inspectCacheRef.current[s] ?? null);
        for (const layer of inspectLayers) {
          const role = inferDocAiLayerRole(layer, undefined, fullBleedMode, templateBgMode);
          if (layoutRoleMatchesField(role, targetRole)) {
            roleRefKeys.add(refKeyFromLayerPositionKey(layer.layer_key));
          }
        }
        for (const row of nextDrafts[s] ?? serverDrafts[s] ?? []) {
          if (layoutRoleMatchesField(roleFromLayerKey(row.layer_key), targetRole)) {
            roleRefKeys.add(refKeyFromLayerPositionKey(row.layer_key));
          }
        }
      }

      const patchRow = (row: DocAiLayerOverride): DocAiLayerOverride => ({
        ...row,
        ...patch,
        box_locked: patch.box_locked ?? row.box_locked ?? true,
      });

      let touchedSlides = 0;
      for (let slide = 1; slide <= slideCount; slide++) {
        const inspectLayers = parseDocAiLayerBoxes(inspectCacheRef.current[slide] ?? null);
        const existing = [...(nextDrafts[slide] ?? serverDrafts[slide] ?? [])];
        const byKey = new Map(existing.map((r) => [r.layer_key, { ...r }]));
        let slideTouched = false;

        for (const layer of inspectLayers) {
          const row = byKey.get(layer.layer_key);
          const role = inferDocAiLayerRole(layer, row, fullBleedMode, templateBgMode);
          const ref = refKeyFromLayerPositionKey(layer.layer_key);
          const matchesRole = layoutRoleMatchesField(role, targetRole);
          const matchesRef = roleRefKeys.size > 0 && roleRefKeys.has(ref);
          if (!matchesRole && !matchesRef) continue;
          const base: DocAiLayerOverride =
            row ??
            ({
              layer_key: layer.layer_key,
              x_px: layer.x_px,
              y_px: layer.y_px,
              w_px: layer.w_px,
              h_px: layer.h_px,
              box_locked: true,
            } as DocAiLayerOverride);
          byKey.set(layer.layer_key, patchRow(base));
          slideTouched = true;
        }

        for (const [key, row] of byKey.entries()) {
          const role = roleFromLayerKey(key);
          const ref = refKeyFromLayerPositionKey(key);
          if (!layoutRoleMatchesField(role, targetRole) && !roleRefKeys.has(ref)) continue;
          byKey.set(key, patchRow(row));
          slideTouched = true;
        }

        if (slideTouched && byKey.size > 0) {
          nextDrafts[slide] = normalizeLayerPosDraft(Array.from(byKey.values()), templateBgMode);
          touchedSlides += 1;
        }
      }

      if (touchedSlides === 0) {
        setLayerPosMsg(`No ${targetRole} boxes found to update — open slides in the editor first.`);
        return;
      }

      setSlideDrafts(nextDrafts);
      const current = nextDrafts[editorSlide];
      if (current?.length) {
        setLayerPosDraft(current);
        setDraftSyncRevision((v) => v + 1);
      }
      setUserTouchedLayout(true);
      setLayerPosMsg(
        `Applied ${targetRole} ${successLabel} across ${touchedSlides} slide${touchedSlides === 1 ? "" : "s"}.`
      );
    },
    [mimicV1, templateBgMode, slideDrafts, slideCount, fullBleedMode, editorSlide]
  );

  const applyTypographyToRole = useCallback(
    (targetRole: "headline" | "body", style: DocAiLayerTypographyStyle) => {
      applyLayerPatchToRoleAcrossDeck(targetRole, style, "typography");
    },
    [applyLayerPatchToRoleAcrossDeck]
  );

  const applyPlacementToRole = useCallback(
    (targetRole: "headline" | "body", placement: DocAiLayerPlacementStyle) => {
      applyLayerPatchToRoleAcrossDeck(targetRole, placement, "box placement");
    },
    [applyLayerPatchToRoleAcrossDeck]
  );



  const renderInspectRef = useRef(renderInspect);
  renderInspectRef.current = renderInspect;

  const handleLayerDraftChange = useCallback(

    (overrides: DocAiLayerOverride[]) => {

      if (templateBgMode && onTemplateBgFieldTextChange && templateBgFieldRoles.length > 0) {
        const prevByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
        const inspectBoxes = parseDocAiLayerBoxes(renderInspectRef.current);
        for (const row of overrides) {
          const prev = prevByKey.get(row.layer_key);
          const nextText = row.text?.trim();
          if (!nextText || nextText === prev?.text?.trim()) continue;
          const layer = inspectBoxes.find((l) => l.layer_key === row.layer_key);
          const role = inferDocAiLayerRole(
            layer ?? {
              layer_key: row.layer_key,
              text: nextText,
              role: "body",
              x_px: row.x_px,
              y_px: row.y_px,
              w_px: row.w_px ?? 120,
              h_px: row.h_px ?? 48,
            },
            row,
            fullBleedMode,
            templateBgMode
          );
          const fieldRole = templateBgFieldRoles.find((fr) => layoutRoleMatchesField(role, fr));
          if (fieldRole) onTemplateBgFieldTextChange(editorSlide, fieldRole, nextText);
        }
      }

      const normalized = normalizeLayerPosDraft(overrides, templateBgMode);

      setLayerPosDraft(normalized);

      setSlideDrafts((prev) => ({ ...prev, [editorSlide]: normalized }));

      setUserTouchedLayout(true);

    },

    [
      editorSlide,
      templateBgMode,
      onTemplateBgFieldTextChange,
      templateBgFieldRoles,
      layerPosDraft,
      fullBleedMode,
    ]

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

  const layoutGeometryFingerprint = useMemo(
    () => layoutDraftCompareKey(persistedPositionsForInspect, templateBgMode),
    [persistedPositionsForInspect, templateBgMode]
  );



  useEffect(() => {

    if (!buildInspectPayloadRef.current || !templateUsed || slideCount < 1) {

      setRenderInspect(null);

      setRenderInspectLoading(false);

      return;

    }

    const gen = ++inspectRequestGenRef.current;
    const hadCachedInspect = Boolean(inspectCacheRef.current[editorSlide]);

    const timer = window.setTimeout(() => {

      void (async () => {

        if (!hadCachedInspect) setRenderInspectLoading(true);

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

          if (json.ok) {
            inspectCacheRef.current[editorSlide] = json;
            setRenderInspect(json);
          } else {
            setRenderInspect({ error: json.error ?? "inspect failed" });
          }

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

  }, [
    templateUsed,
    editorSlide,
    slideCount,
    instagramHandle,
    reprintTextBacking,
    reprintTextBackingCss,
    layoutGeometryFingerprint,
  ]);

  const docAiLayerBoxes = useMemo(() => {
    let boxes = parseDocAiLayerBoxes(renderInspect);
    if (templateBgMode) {
      const slot = templateBgSlotForSlide(editorSlide, slideCount);
      if (slot !== "cta") {
        boxes = boxes.filter((layer) => {
          if (layer.layer_key?.startsWith("custom@")) return true;
          const role = (layer.role ?? "").trim().toLowerCase();
          return role !== "handle";
        });
      }
      let blockIndex = 0;
      return boxes.map((layer) => {
        const withIdx = { ...layer, block_index: blockIndex };
        blockIndex += 1;
        return withIdx;
      });
    }
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    const customDraftRows = layerPosDraft.filter(
      (row) => row.layer_key.startsWith("custom@") && !row.hidden && !isPlaceholderCustomLayer(
        {
          layer_key: row.layer_key,
          text: row.text ?? "",
          role: roleFromLayerKey(row.layer_key),
          x_px: row.x_px,
          y_px: row.y_px,
          w_px: row.w_px ?? 120,
          h_px: row.h_px ?? 48,
        },
        row
      )
    );
    const filtered = boxes.filter((layer) => {
      if (isDraftHiddenForLayer(layer.layer_key, draftByKey)) return false;
      if (isPlaceholderCustomLayer(layer, draftByKey.get(layer.layer_key))) return false;
      if (
        customDraftRows.some((draftRow) => isLegacyInspectEchoOfCustomDraft(layer, draftRow))
      ) {
        return false;
      }
      return true;
    });
    const dedupedInspect = filtered.filter((layer, index, arr) => {
      const layerText = normalizePhraseKey(layer.text ?? "");
      if (layerText.length < 3 || layer.layer_key?.startsWith("custom@")) return true;
      const firstIndex = arr.findIndex(
        (other) =>
          !other.layer_key?.startsWith("custom@") &&
          normalizePhraseKey(other.text ?? "") === layerText &&
          Math.abs(other.x_px - layer.x_px) <= 48 &&
          Math.abs(other.y_px - layer.y_px) <= 48
      );
      return firstIndex === index;
    });
    const seenKeys = new Set(dedupedInspect.map((l) => l.layer_key));
    for (const row of layerPosDraft) {
      if (row.hidden || seenKeys.has(row.layer_key)) continue;
      if (isPlaceholderCustomLayer(
        { layer_key: row.layer_key, text: row.text ?? "", role: roleFromLayerKey(row.layer_key), x_px: row.x_px, y_px: row.y_px, w_px: row.w_px ?? 120, h_px: row.h_px ?? 48 },
        row
      )) continue;
      dedupedInspect.push({
        layer_key: row.layer_key,
        text: row.text ?? "",
        role: roleFromLayerKey(row.layer_key),
        x_px: row.x_px,
        y_px: row.y_px,
        w_px: Math.max(24, row.w_px ?? 120),
        h_px: Math.max(20, row.h_px ?? 48),
        font_size_px: row.font_size_px,
      });
      seenKeys.add(row.layer_key);
    }
    let blockIndex = 0;
    return dedupedInspect.map((layer) => {
      const withIdx = { ...layer, block_index: blockIndex };
      blockIndex += 1;
      return withIdx;
    });
  }, [renderInspect, layerPosDraft, templateBgMode, editorSlide, slideCount]);

  const editorLayers = useMemo(() => {
    if (!templateBgMode || templateBgFieldRoles.length === 0) return docAiLayerBoxes;
    const fieldTextsByRole = new Map(
      templateBgFieldRoles.map((role, i) => [role, templateBgFieldTexts[i] ?? ""])
    );
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    return docAiLayerBoxes.map((layer) => {
      const role = inferDocAiLayerRole(layer, draftByKey.get(layer.layer_key), fullBleedMode, templateBgMode);
      const fieldRole = templateBgFieldRoles.find((fr) => layoutRoleMatchesField(role, fr));
      const copyText = fieldRole ? fieldTextsByRole.get(fieldRole) : undefined;
      if (copyText !== undefined && role !== "handle") {
        return { ...layer, text: copyText };
      }
      return layer;
    });
  }, [
    docAiLayerBoxes,
    templateBgMode,
    templateBgFieldRoles,
    templateBgFieldTexts,
    layerPosDraft,
    fullBleedMode,
  ]);

  const layoutTextBlocks = useMemo(() => {
    const draftByKey = new Map(layerPosDraft.map((row) => [row.layer_key, row]));
    const fieldTextsByRole =
      templateBgMode && templateBgFieldRoles.length > 0
        ? new Map(templateBgFieldRoles.map((role, i) => [role, templateBgFieldTexts[i] ?? ""]))
        : null;
    return docAiLayerBoxes.map((layer) => {
      const row = draftByKey.get(layer.layer_key);
      const role = inferDocAiLayerRole(layer, row, fullBleedMode, templateBgMode);
      const fieldRole = templateBgFieldRoles.find((fr) => layoutRoleMatchesField(role, fr));
      const fromField = fieldRole && fieldTextsByRole ? fieldTextsByRole.get(fieldRole) : undefined;
      return {
        role,
        text: (fromField !== undefined ? fromField : row?.text) ?? layer.text,
        layer_key: layer.layer_key,
        block_index: layer.block_index ?? 0,
      };
    });
  }, [docAiLayerBoxes, layerPosDraft, fullBleedMode, templateBgMode, templateBgFieldRoles, templateBgFieldTexts]);

  useEffect(() => {
    if (!onLayoutTextBlocksChange || templateBgMode || fullBleedMode) return;
    const next = layoutTextBlocks.map(({ role, text, layer_key }) => ({ role, text, layer_key }));
    const fingerprint = `${editorSlide}:${JSON.stringify(next)}`;
    if (fingerprint === lastEmittedTextBlocksRef.current) return;
    lastEmittedTextBlocksRef.current = fingerprint;
    onLayoutTextBlocksChange(editorSlide, next);
  }, [layoutTextBlocks, editorSlide, onLayoutTextBlocksChange]);

  const activeLayoutBlockIndex = useMemo(() => {
    if (activeTextBlockIndex == null) return null;
    if (fullBleedMode && copySlotsForEditor.length > 0) {
      const { start } = ocrBoxSpanForClusterIndex(activeTextBlockIndex, copySlotsForEditor);
      return start;
    }
    if (!templateBgMode || templateBgFieldRoles.length === 0) return activeTextBlockIndex;
    const fieldRole = templateBgFieldRoles[activeTextBlockIndex];
    if (!fieldRole) return activeTextBlockIndex;
    const match = layoutTextBlocks.find((layer) => layoutRoleMatchesField(layer.role, fieldRole));
    return match?.block_index ?? activeTextBlockIndex;
  }, [activeTextBlockIndex, templateBgMode, templateBgFieldRoles, layoutTextBlocks, fullBleedMode, copySlotsForEditor]);

  const handleActiveLayoutBlockChange = useCallback(
    (blockIndex: number | null) => {
      if (!onActiveTextBlockIndexChange) return;
      if (fullBleedMode && blockIndex != null && copySlotsRef.current.length > 0) {
        onActiveTextBlockIndexChange(clusterIndexForOcrBoxIndex(blockIndex, copySlotsRef.current));
        return;
      }
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

  const templateBgFieldRolesRef = useRef(templateBgFieldRoles);
  templateBgFieldRolesRef.current = templateBgFieldRoles;

  useEffect(() => {
    if (!registerTextBlockUpdater) return;
    registerTextBlockUpdater((blockIndex, text) => {
      const slots = copySlotsRef.current;
      const fieldRole = templateBgMode ? templateBgFieldRolesRef.current[blockIndex] : undefined;
      const inspectBoxes = parseDocAiLayerBoxes(renderInspectRefForUpdater.current);
      const draft = layerPosDraftRef.current;
      const boxes = docAiLayerBoxesRef.current;
      const blocks = layoutTextBlocksRef.current;
      const draftByKey = new Map(draft.map((row) => [row.layer_key, row]));

      if (fullBleedMode && slots.length > 0 && fieldRole == null) {
        const { start, count } = ocrBoxSpanForClusterIndex(blockIndex, slots);
        const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
        const slot = sorted[blockIndex];
        const refTexts = slot?.block_texts.map((t) => t.trim()).filter(Boolean) ?? [];
        const splits =
          refTexts.length > 1 ? splitLineForRefBlocks(text, refTexts) : [text];
        const base =
          draft.length > 0
            ? [...draft]
            : boxes.map((layer) => ({
                layer_key: layer.layer_key,
                x_px: layer.x_px,
                y_px: layer.y_px,
                w_px: layer.w_px,
                h_px: layer.h_px,
                font_size_px: layer.font_size_px,
                text: layer.text,
                box_locked: true,
              }));
        const byKey = new Map(base.map((r) => [r.layer_key, { ...r }]));
        for (let i = 0; i < count; i++) {
          const box = boxes[start + i];
          const piece = splits[i] ?? "";
          if (!piece.trim()) continue;
          if (!box) continue;
          const existing = byKey.get(box.layer_key);
          byKey.set(box.layer_key, {
            layer_key: box.layer_key,
            x_px: existing?.x_px ?? box.x_px,
            y_px: existing?.y_px ?? box.y_px,
            w_px: existing?.w_px ?? box.w_px,
            h_px: existing?.h_px ?? box.h_px,
            font_size_px: existing?.font_size_px ?? box.font_size_px,
            text: piece,
            box_locked: true,
          });
        }
        handleLayerDraftChangeRef.current(Array.from(byKey.values()));
        return;
      }

      const roleForBox = (layer: DocAiLayerBox) =>
        inferDocAiLayerRole(layer, draftByKey.get(layer.layer_key), fullBleedMode, templateBgMode);

      const resolveLayoutBlockToBox = (
        layoutBlock: (typeof blocks)[number] | undefined
      ): DocAiLayerBox | undefined => {
        if (!layoutBlock) return undefined;
        return boxes.find((layer) => layer.layer_key === layoutBlock.layer_key);
      };

      let target: DocAiLayerBox | undefined;
      if (fieldRole != null) {
        target = inspectBoxes.find((layer) => layoutRoleMatchesField(roleForBox(layer), fieldRole));
        if (!target) {
          const layoutMatch = blocks.find((layer) => layoutRoleMatchesField(layer.role, fieldRole));
          target = resolveLayoutBlockToBox(layoutMatch);
        }
      } else {
        target = inspectBoxes[blockIndex] ?? resolveLayoutBlockToBox(blocks[blockIndex]);
      }
      if (!target) target = resolveLayoutBlockToBox(blocks[blockIndex]);
      if (!target) {
        const trimmed = text.trim();
        if (!trimmed || fullBleedMode) return;
        const custom = buildCustomPhraseOverride(trimmed, blockIndex, boxes);
        const base =
          draft.length > 0
            ? draft
            : boxes.map((layer) => ({
                layer_key: layer.layer_key,
                x_px: layer.x_px,
                y_px: layer.y_px,
                w_px: layer.w_px,
                h_px: layer.h_px,
                font_size_px: layer.font_size_px,
                text: layer.text,
                box_locked: true,
              }));
        handleLayerDraftChangeRef.current([...base, custom]);
        return;
      }
      if (fieldRole === "body" && roleForBox(target) === "handle") return;
      if (fieldRole === "headline" && roleForBox(target) === "handle") return;
      const base =
        draft.length > 0
          ? draft
          : boxes.map((layer) => ({
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
              x_px: target.x_px,
              y_px: target.y_px,
              w_px: target.w_px,
              h_px: target.h_px,
              text,
              box_locked: true,
            },
          ];
      handleLayerDraftChangeRef.current(next);
    });
    return () => registerTextBlockUpdater(null);
  }, [registerTextBlockUpdater, templateBgMode, fullBleedMode]);

  const docAiSavedOverrides = useMemo(() => parseDocAiSavedOverrides(renderInspect), [renderInspect]);

  const initialOverridesForEditor = useMemo(() => {

    if (layerPosDraft.length > 0) {
      return normalizeLayerPosDraft(layerPosDraft, templateBgMode);
    }

    const cached = slideDrafts[editorSlide];

    if (cached?.length) {
      return normalizeLayerPosDraft(
        templateBgMode ? stripTemplateBgHiddenOverrides(cached) : cached,
        templateBgMode
      );
    }

    return normalizeLayerPosDraft(
      templateBgMode
        ? stripTemplateBgHiddenOverrides(docAiSavedOverrides)
        : docAiSavedOverrides,
      templateBgMode
    );

  }, [layerPosDraft, slideDrafts, editorSlide, docAiSavedOverrides, templateBgMode]);

  const restoreDefaultLayout = useCallback(() => {
    const cleared = layerPosDraft.filter((row) => !row.hidden);
    handleLayerDraftChange(cleared);
  }, [layerPosDraft, handleLayerDraftChange]);

  const resetSlideLayout = useCallback(async () => {
    if (!taskId.trim() || !projectSlug.trim()) return;
    const ok = window.confirm(
      `Clear all saved layout for slide ${editorSlide}? OCR boxes return to defaults; added boxes are removed.`
    );
    if (!ok) return;
    setLayerPosSaving(true);
    setLayerPosError(null);
    setLayerPosMsg(null);
    try {
      await persistLayerPositions(editorSlide, []);
      setLayerPosDraft([]);
      setSlideDrafts((prev) => {
        const next = { ...prev };
        delete next[editorSlide];
        return next;
      });
      setUserTouchedLayout(false);
      setLayoutBaseline("");
      setLayoutResetToken((t) => t + 1);
      setLayerPosMsg(`Layout reset for slide ${editorSlide} — use Reprint text to refresh the image.`);
      onMimicLayoutSaved?.(editorSlide, []);
    } catch (e) {
      setLayerPosError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setLayerPosSaving(false);
    }
  }, [taskId, projectSlug, editorSlide, persistLayerPositions, onMimicLayoutSaved]);

  const handleLayerDraftChangeRef = useRef(handleLayerDraftChange);
  handleLayerDraftChangeRef.current = handleLayerDraftChange;
  const layerPosDraftRef = useRef(layerPosDraft);
  layerPosDraftRef.current = layerPosDraft;
  const docAiLayerBoxesRef = useRef(docAiLayerBoxes);
  docAiLayerBoxesRef.current = docAiLayerBoxes;
  const layoutTextBlocksRef = useRef(layoutTextBlocks);
  layoutTextBlocksRef.current = layoutTextBlocks;
  const renderInspectRefForUpdater = useRef(renderInspect);
  renderInspectRefForUpdater.current = renderInspect;

  async function handleSaveAllLayerPositions() {
    if (!taskId.trim() || !projectSlug.trim()) return;

    const mergedDrafts: Record<number, DocAiLayerOverride[]> = {
      ...slideDrafts,
      ...(layerPosDraft.length > 0 ? { [editorSlide]: layerPosDraft } : {}),
    };
    const slidesToSave = Object.entries(mergedDrafts)
      .map(([key, rows]) => ({ slide: Number(key), rows }))
      .filter(({ slide, rows }) => Number.isFinite(slide) && slide >= 1 && rows.length > 0);

    if (slidesToSave.length === 0) {
      setLayerPosError("No layout drafts to save — edit at least one slide first.");
      return;
    }

    setLayerPosSaving(true);
    setLayerPosError(null);
    setLayerPosMsg(null);

    try {
      const savedSlides: number[] = [];
      for (const { slide, rows } of slidesToSave.sort((a, b) => a.slide - b.slide)) {
        await persistLayerPositions(slide, rows);
        savedSlides.push(slide);
      }
      setSlideDrafts(mergedDrafts);
      if (layerPosDraft.length > 0) {
        lastPersistedKeyRef.current = persistKeyFor(editorSlide, layerPosDraft);
      }
      setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));
      setUserTouchedLayout(false);
      setSlidesWithSavedLayout(new Set(savedSlides));
      setLayerPosMsg(`Saved layouts for ${savedSlides.length} slide${savedSlides.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setLayerPosError(e instanceof Error ? e.message : "Save all failed");
    } finally {
      setLayerPosSaving(false);
    }
  }

  async function handleSaveLayerPositions() {

    if (!taskId.trim() || !projectSlug.trim() || layerPosDraft.length === 0) return;

    setLayerPosSaving(true);

    setLayerPosError(null);

    setLayerPosMsg(null);

    try {

      await persistLayerPositions(editorSlide, layerPosDraft);

      lastPersistedKeyRef.current = persistKeyFor(editorSlide, layerPosDraft);

      setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));

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

      if (layerPosDraft.length > 0) {
        lastPersistedKeyRef.current = persistKeyFor(editorSlide, layerPosDraft);
      }

      setSlidesWithSavedLayout((prev) => {

        const next = new Set(prev);

        for (const key of Object.keys(slideDrafts)) {

          const n = Number(key);

          if (Number.isFinite(n) && n >= 1) next.add(n);

        }

        if (layerPosDraft.length > 0) next.add(editorSlide);

        return next;

      });

      if (layerPosDraft.length > 0) setLayoutBaseline(layoutDraftCompareKey(layerPosDraft, templateBgMode));

    } catch (e) {

      setReprintError(e instanceof Error ? e.message : "Reprint failed");

      setReprintMsg(null);

    } finally {

      setReprintBusy(false);

    }

  }



  async function regenerateSlideImages(
    slideIndices: number[],
    opts?: { slot?: MimicTemplateBgSlot | null }
  ) {

    if (!taskId.trim() || !projectSlug.trim()) {
      setRegenerateError("Missing task or project — reload the review page and try again.");
      return;
    }
    if (slideIndices.length === 0) {
      setRegenerateError("No slides selected for regeneration.");
      return;
    }

    setRegenerateBusy(true);
    setRegeneratingSlot(opts?.slot ?? null);

    setRegenerateError(null);

    setRegenerateMsg(null);

    try {

      const res = await fetch("/api/task/regenerate-carousel-slides", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          task_id: taskId,

          project: projectSlug.trim(),

          slide_indices: slideIndices,

          visual_similarity_pct: regenSimilarityPct,

          image_input_mode: regenUseReference ? "reference_edit" : "analysis_t2i",

          ...(regenNote.trim() ? { regeneration_note: regenNote.trim().slice(0, 400) } : {}),

        }),

      });

      const json = (await res.json()) as { ok?: boolean; accepted?: boolean; message?: string; error?: string };

      if ((!res.ok && res.status !== 202) || !json.ok) {

        throw new Error(json.error ?? json.message ?? `Regenerate failed (${res.status})`);

      }

      setRegenerateMsg(
        json.message ??
          (opts?.slot === "cover"
            ? "Cover background regen started — refresh in 2–5 minutes."
            : opts?.slot === "cta"
              ? "CTA background regen started — refresh in 2–5 minutes."
              : opts?.slot === "body"
                ? `Middle background regen started for ${slideIndices.length} slides — refresh in 2–5 minutes.`
                : `Regenerating ${slideIndices.length} slide(s)…`)
      );

      refreshCarouselAfterReprint();

    } catch (e) {

      setRegenerateError(e instanceof Error ? e.message : "Regenerate failed");

    } finally {

      setRegenerateBusy(false);
      setRegeneratingSlot(null);

    }

  }



  async function handleRegenerateSlideImage() {

    await regenerateSlideImages([editorSlide]);

  }



  async function handleRegenerateTemplateBgSlot(slot: MimicTemplateBgSlot) {

    const indices = templateBgSlideIndicesForSlot(slot, slideCount);

    if (indices.length === 0) {
      setRegenerateError(
        slot === "body"
          ? "This deck has no middle slides to regenerate."
          : "No slides in that slot for this deck."
      );
      return;
    }

    await regenerateSlideImages(indices, { slot });

  }



  if (!job) return null;



  const showEditor = docAiLayerBoxes.length > 0;
  const hasHiddenDraftLayers = layerPosDraft.some((row) => row.hidden);
  const templateBgMiddleSlideCount = templateBgMode
    ? templateBgSlideIndicesForSlot("body", slideCount).length
    : 0;

  const slotRegenButtonLabel = (slot: MimicTemplateBgSlot, base: string): string => {
    if (regeneratingSlot === slot && regenerateBusy) return "Starting…";
    return base;
  };

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

        <input
          type="text"
          className="mimic-regen-route__note-input"
          value={regenNote}
          onChange={(e) => setRegenNote(e.target.value.slice(0, 400))}
          placeholder="Regen note (optional)"
          maxLength={400}
          disabled={regenerateBusy}
          title="Short instruction appended to the image prompt for this regenerate"
        />

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
          {regenerateBusy ? "Regenerating…" : templateBgMode ? "This slide" : "Regenerate"}
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

      {templateBgMode ? (
        <div className="mimic-regen-route mimic-regen-route--slots">
          <button
            type="button"
            className="mimic-regen-route__collapse btn-ghost btn-sm"
            onClick={() => setRegenPlateOpen((v) => !v)}
            aria-expanded={regenPlateOpen}
          >
            Regen plate {regenPlateOpen ? "▾" : "▸"}
          </button>
          {regenPlateOpen ? (
            <>
          <div className="mimic-regen-route__group">
            <button
              type="button"
              className="btn-secondary btn-sm mimic-slot-regen-btn"
              disabled={regenerateBusy || reprintBusy || layerPosSaving}
              onClick={() => void handleRegenerateTemplateBgSlot("cover")}
              title="Regenerate cover slide background (slide 1) — billed"
            >
              {slotRegenButtonLabel("cover", "Regen cover")}
            </button>
            {templateBgMiddleSlideCount > 0 ? (
              <button
                type="button"
                className="btn-secondary btn-sm mimic-slot-regen-btn"
                disabled={regenerateBusy || reprintBusy || layerPosSaving}
                onClick={() => void handleRegenerateTemplateBgSlot("body")}
                title={`Regenerate shared middle background for slides 2–${slideCount - 1} — billed`}
              >
                {slotRegenButtonLabel("body", `Regen middle (${templateBgMiddleSlideCount})`)}
              </button>
            ) : null}
            {slideCount > 1 ? (
              <button
                type="button"
                className="btn-secondary btn-sm mimic-slot-regen-btn"
                disabled={regenerateBusy || reprintBusy || layerPosSaving}
                onClick={() => void handleRegenerateTemplateBgSlot("cta")}
                title={`Regenerate CTA slide background (slide ${slideCount}) — billed`}
              >
                {slotRegenButtonLabel("cta", "Regen CTA")}
              </button>
            ) : null}
          </div>
          <p className="mimic-regen-route__note">
            Each button starts image regen immediately (2–5 min). Middle slides share one background plate.
          </p>
          {regenerateMsg || regenerateError ? (
            <div className="mimic-slot-regen-feedback">
              {regenerateMsg ? (
                <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p>
              ) : null}
              {regenerateError ? (
                <p className="mimic-layer-editor-panel__error">{regenerateError}</p>
              ) : null}
            </div>
          ) : null}
            </>
          ) : null}
        </div>
      ) : null}

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

      {regenerateMsg && !templateBgMode ? (
        <p className="mimic-layer-editor-panel__status">{regenerateMsg}</p>
      ) : null}
      {regenerateError && !templateBgMode ? (
        <p className="mimic-layer-editor-panel__error">{regenerateError}</p>
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
            key={`docai-layout-${editorSlide}-${layoutResetToken}`}

            slideIndex={editorSlide}

            backgroundUrl={getBackgroundUrl?.(editorSlide)}

            layers={editorLayers}

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

            textBackingEnabled={reprintTextBacking}
            onTextBackingEnabledChange={setReprintTextBacking}
            textBackingColorHex={reprintTextBackingHex}
            onTextBackingColorHexChange={setReprintTextBackingHex}
            logoStampEnabled={logoEnabled}
            onLogoStampEnabledChange={setLogoEnabled}
            brandLogoPreviewUrl={brandLogoUrl}

            slideCount={slideCount}
            onApplyTypographyToRole={applyTypographyToRole}
            onApplyPlacementToRole={applyPlacementToRole}
            draftSyncRevision={draftSyncRevision}

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
            <button
              type="button"
              className="btn-secondary btn-block"
              disabled={layerPosSaving}
              onClick={() => void resetSlideLayout()}
              title="Remove all saved positions and manually-added boxes for this slide"
            >
              Reset slide layout
            </button>
            {slideCount > 1 ? (
              <button
                type="button"
                className="btn-secondary btn-block"
                disabled={layerPosSaving}
                onClick={() => void handleSaveAllLayerPositions()}
                title="Persist layout drafts for every slide you have edited"
              >
                {layerPosSaving ? "Saving…" : "Save all slides"}
              </button>
            ) : null}
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


