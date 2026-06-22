"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isMimicDocAiHandleLayer,
  MIMIC_DOCAI_HANDLE_FONT_SIZE_PX,
} from "@caf-core-carousel/mimic-slide-typography";
import { refKeyFromLayerPositionKey } from "@caf-core-carousel/mimic-docai-layer-positions";

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const DEFAULT_FONT_PX = 50;
const MIN_FONT_PX = 24;
const MAX_FONT_PX = 120;
const MIN_BOX_W = 48;
const MIN_BOX_H = 28;
const CUSTOM_LAYER_KEY_PREFIX = "custom@";

function isCustomLayerKey(layerKey: string): boolean {
  return layerKey.startsWith(CUSTOM_LAYER_KEY_PREFIX);
}

function looksLikeHandleText(text: string): boolean {
  return /^@[\w.]{2,}$/i.test(text.trim());
}

function ocrRoleForLayer(layer: DocAiLayerBox): string {
  return (layer.role ?? "").trim().toLowerCase();
}

/** On-slide copy for editor sizing — template_bg drafts omit text; fall back to inspect/field layer. */
function resolveEditorLayerText(
  layer: DocAiLayerBox | undefined,
  row: DocAiLayerOverride | undefined,
  templateBgMode: boolean,
  projectHandle: string
): string {
  // Never trim row.text here — controlled inputs need trailing spaces while typing.
  if (row?.text != null) return row.text;
  if (templateBgMode && layer) {
    return templateBgLayerSeedText(layer, row, projectHandle);
  }
  return layer?.text ?? "";
}

/** template_bg: never seed a body OCR slot with @handle — handle lives on the handle bbox only. */
function templateBgLayerSeedText(
  layer: DocAiLayerBox,
  savedRow: DocAiLayerOverride | undefined,
  projectHandle: string
): string {
  const ocrRole = ocrRoleForLayer(layer);
  const fromSaved = savedRow?.text?.trim() ?? "";
  const fromInspect = layer.text?.trim() ?? "";
  if (ocrRole === "handle") {
    return fromInspect || fromSaved || projectHandle.trim() || fromInspect;
  }
  if (ocrRole === "body" || ocrRole === "subtitle" || ocrRole === "caption") {
    if (fromSaved && !looksLikeHandleText(fromSaved)) return fromSaved;
    if (fromInspect && !looksLikeHandleText(fromInspect)) return fromInspect;
    return fromSaved;
  }
  return fromInspect || fromSaved || "";
}

function newCustomLayerKey(): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${CUSTOM_LAYER_KEY_PREFIX}body@${id}`;
}

const HIGHLIGHT_PAD_X = 16;
const HIGHLIGHT_PAD_Y = 12;
const HIGHLIGHT_LINE_HEIGHT = 1.15;

/** Prefer saved geometry, then inspect layer size, then highlight fit — stops dimension flicker. */
function resolveSeedBoxSize(
  layer: DocAiLayerBox,
  savedRow: DocAiLayerOverride | undefined,
  text: string,
  fontSizePx: number,
  xPx: number,
  yPx: number
): { w_px: number; h_px: number } {
  const savedW = savedRow?.w_px;
  const savedH = savedRow?.h_px;
  if (
    savedW != null &&
    savedH != null &&
    Number.isFinite(savedW) &&
    Number.isFinite(savedH) &&
    savedW > 0 &&
    savedH > 0
  ) {
    return { w_px: Math.max(MIN_BOX_W, savedW), h_px: Math.max(MIN_BOX_H, savedH) };
  }
  if (
    layer.w_px > 0 &&
    layer.h_px > 0 &&
    Number.isFinite(layer.w_px) &&
    Number.isFinite(layer.h_px)
  ) {
    return { w_px: Math.max(MIN_BOX_W, layer.w_px), h_px: Math.max(MIN_BOX_H, layer.h_px) };
  }
  return openHighlightBoxForText(text, fontSizePx, xPx, yPx);
}

/** Estimate how many wrapped lines fit at a given inner width. */
function wrappedLineCountForText(text: string, innerWidthPx: number, fontSizePx: number): number {
  const charW = Math.max(1, fontSizePx * 0.52);
  const charsPerLine = Math.max(1, Math.floor(Math.max(MIN_BOX_W, innerWidthPx) / charW));
  const paragraphs = String(text ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || arr.length === 1);
  const safe = paragraphs.length > 0 ? paragraphs : [""];
  let lines = 0;
  for (const para of safe) {
    lines += Math.max(1, Math.ceil(Math.max(para.length, 1) / charsPerLine));
  }
  return Math.max(1, lines);
}

/** Size the highlight box — wraps long body copy; single-line when short. */
export function openHighlightBoxForText(
  text: string,
  fontSizePx: number,
  xPx: number,
  yPx: number,
  opts?: { fixedWidthPx?: number }
): { w_px: number; h_px: number } {
  const fontSize = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(fontSizePx) || DEFAULT_FONT_PX));
  const paragraphs = String(text ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || arr.length === 1);
  const safeLines = paragraphs.length > 0 ? paragraphs : [""];
  const charW = fontSize * 0.52;
  const maxLineChars = Math.max(...safeLines.map((l) => l.length), 0);
  const maxAvailW = CANVAS_W - Math.max(0, xPx);
  const naturalSingleLineW = Math.max(MIN_BOX_W, Math.ceil(maxLineChars * charW + HIGHLIGHT_PAD_X));
  const totalChars = safeLines.join(" ").length;
  const preferWideWrap = totalChars > 40 || safeLines.length > 1;

  let width: number;
  if (opts?.fixedWidthPx != null && opts.fixedWidthPx > 0) {
    width = Math.min(maxAvailW, Math.max(MIN_BOX_W, Math.round(opts.fixedWidthPx)));
  } else if (preferWideWrap) {
    width = Math.min(
      maxAvailW,
      Math.max(MIN_BOX_W, Math.min(naturalSingleLineW, Math.max(480, Math.round(maxAvailW * 0.88))))
    );
  } else {
    width = Math.min(maxAvailW, naturalSingleLineW);
  }

  const innerW = Math.max(MIN_BOX_W, width - HIGHLIGHT_PAD_X);
  const lineCount = wrappedLineCountForText(text, innerW, fontSize);
  const height = Math.min(
    CANVAS_H - Math.max(0, yPx),
    Math.max(
      MIN_BOX_H,
      Math.ceil(lineCount * fontSize * HIGHLIGHT_LINE_HEIGHT + HIGHLIGHT_PAD_Y)
    )
  );
  return { w_px: width, h_px: height };
}

/** Saved box size, expanded when copy would overflow (wrapped estimate). */
function effectiveBoxDimensions(
  row: Pick<DocAiLayerOverride, "text" | "x_px" | "y_px" | "w_px" | "h_px">,
  fontSizePx: number
): { w_px: number; h_px: number } {
  const w = Math.max(MIN_BOX_W, row.w_px ?? MIN_BOX_W);
  const h = Math.max(MIN_BOX_H, row.h_px ?? MIN_BOX_H);
  const fitted = openHighlightBoxForText(
    row.text ?? "",
    fontSizePx,
    row.x_px,
    row.y_px,
    w > MIN_BOX_W ? { fixedWidthPx: w } : undefined
  );
  return { w_px: Math.max(w, fitted.w_px), h_px: Math.max(h, fitted.h_px) };
}

function defaultLayerFontPx(
  layer: { role?: string; text?: string; font_size_px?: number },
  savedFont: number | undefined,
  projectHandle?: string
): number {
  if (savedFont != null && savedFont > 0) return savedFont;
  const text = String(layer.text ?? "");
  if (isMimicDocAiHandleLayer(layer.role ?? null, text, projectHandle)) {
    return MIMIC_DOCAI_HANDLE_FONT_SIZE_PX;
  }
  if (layer.font_size_px && layer.font_size_px > 0) return layer.font_size_px;
  return DEFAULT_FONT_PX;
}

function customBoxFromOverride(row: DocAiLayerOverride, projectHandle?: string): DocAiLayerBox {
  const role = row.layer_key.split("@")[1]?.trim().toLowerCase() || "body";
  const text = row.text?.trim() || "New text";
  const fontSize = defaultLayerFontPx({ role, text }, row.font_size_px, projectHandle);
  const open = effectiveBoxDimensions(
    { text, x_px: row.x_px, y_px: row.y_px, w_px: row.w_px, h_px: row.h_px },
    fontSize
  );
  return {
    layer_key: row.layer_key,
    text,
    role: role === "headline" || role === "cta" || role === "handle" ? role : "body",
    x_px: row.x_px,
    y_px: row.y_px,
    w_px: open.w_px,
    h_px: open.h_px,
    font_size_px: fontSize,
  };
}

type ResizeCorner = "nw" | "ne" | "sw" | "se";

export type DocAiLayerBox = {
  layer_key: string;
  text: string;
  role: string;
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  font_size_px?: number;
  font_weight?: number;
  color_hex?: string;
  font_family?: string;
  font_style_italic?: boolean;
  /** Index into slide text_blocks[] when mapped 1:1. */
  block_index?: number;
  skip_center_avoid?: boolean;
};

export type DocAiLayerOverride = {
  layer_key: string;
  x_px: number;
  y_px: number;
  w_px?: number;
  h_px?: number;
  font_size_px?: number;
  font_weight?: number;
  color_hex?: string;
  font_family?: string;
  font_style_italic?: boolean;
  text?: string;
  box_locked?: boolean;
  hidden?: boolean;
  /**
   * Forward-compat provenance tag so the human drag-editor emits the same shape an
   * automated placer would (`ocr` = solver seed, `human` = reviewer edit, `vision` =
   * vision-model suggestion). See docs/MIMIC_TEXT_PLACEMENT_AUTOMATION.md. Capture
   * plumbing (persisting this through Core) is intentionally NOT wired yet.
   */
  source?: "ocr" | "human" | "vision";
};

export type DocAiLayerTypographyStyle = Pick<
  DocAiLayerOverride,
  "font_size_px" | "font_weight" | "color_hex" | "font_family" | "font_style_italic"
>;

export type DocAiLayerPlacementStyle = Pick<
  DocAiLayerOverride,
  "x_px" | "y_px" | "w_px" | "h_px" | "box_locked"
>;

function roleFromLayerKey(layerKey: string): string {
  if (layerKey.startsWith("custom@")) {
    return (layerKey.split("@")[1] ?? "body").trim().toLowerCase();
  }
  const at = layerKey.indexOf("@");
  if (at <= 0) return "body";
  return layerKey.slice(0, at).toLowerCase();
}

type MimicDocAiLayerPositionEditorProps = {
  slideIndex: number;
  backgroundUrl?: string;
  layers: DocAiLayerBox[];
  initialOverrides?: DocAiLayerOverride[];
  onOverridesChange?: (overrides: DocAiLayerOverride[]) => void;
  /** Fired once when slide layers seed — not a user edit. */
  onLayoutInitialized?: (overrides: DocAiLayerOverride[]) => void;
  /** When true, draw highlight pills behind copy in the editor (matches reprint). */
  textBacking?: boolean;
  /** CSS background for highlight pills (rgba or derived from colour picker). */
  textBackingColor?: string;
  /** Project Instagram handle — handle OCR boxes default to 25px. */
  projectHandle?: string;
  /** When true, ignore inspect/layer refreshes on the same slide (preserves deletes/moves). */
  suppressReseed?: boolean;
  /** Active text block index (0-based) — syncs selection with copy fields. */
  activeBlockIndex?: number | null;
  onActiveBlockIndexChange?: (blockIndex: number | null) => void;
  /** Full-bleed mimic: neutral box labels (no headline/body roles in UI). */
  fullBleedMode?: boolean;
  /** template_bg: slide copy drives OCR layer text; positions may still be edited. */
  templateBgMode?: boolean;
  /** Project brand palette (hex) for the per-box colour quick-pick. */
  brandPalette?: string[];
  /** When set, preview the brand logo lower-right on the canvas. */
  logoOverlayUrl?: string;
  /** Highlight behind text (reprint + preview). */
  textBackingEnabled?: boolean;
  onTextBackingEnabledChange?: (enabled: boolean) => void;
  textBackingColorHex?: string;
  onTextBackingColorHexChange?: (hex: string) => void;
  logoStampEnabled?: boolean;
  onLogoStampEnabledChange?: (enabled: boolean) => void;
  brandLogoPreviewUrl?: string;
  /** Total slides in the deck — enables apply-typography-to-all actions. */
  slideCount?: number;
  /** Apply current box typography to all headline or body boxes in the carousel. */
  onApplyTypographyToRole?: (role: "headline" | "body", style: DocAiLayerTypographyStyle) => void;
  /** Apply current box placement to all headline or body boxes in the carousel. */
  onApplyPlacementToRole?: (role: "headline" | "body", placement: DocAiLayerPlacementStyle) => void;
  /** Parent bumped after cross-slide apply — merge into local overrides without full reseed. */
  draftSyncRevision?: number;
};

type MoveDrag = {
  key: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
};

type ResizeDrag = {
  key: string;
  corner: ResizeCorner;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
};

type PreviewResizeDrag = {
  startX: number;
  startScale: number;
  colWidth: number;
};

const FONT_FAMILY_OPTIONS = [
  { label: "Sans (default)", value: "" },
  { label: "Inter / System", value: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { label: "Arial / Helvetica", value: "Arial, Helvetica, sans-serif" },
  { label: "Roboto", value: "Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { label: "Montserrat", value: "Montserrat, 'Segoe UI', sans-serif" },
  { label: "Poppins", value: "Poppins, 'Segoe UI', sans-serif" },
  { label: "Oswald / Condensed", value: "Oswald, 'Arial Narrow', sans-serif" },
  { label: "Impact / Display", value: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { label: "Georgia / Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Playfair Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Script", value: "'Segoe Script', 'Brush Script MT', cursive" },
  { label: "Monospace", value: "ui-monospace, 'Cascadia Code', monospace" },
];

const CORNER_CURSORS: Record<ResizeCorner, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

const PREVIEW_SCALE_KEY = "caf.mimic-docai.previewScale";
const MIN_PREVIEW_SCALE = 0.45;
const MAX_PREVIEW_SCALE = 2;
const DEFAULT_PREVIEW_SCALE = 1;

function clampPreviewScale(value: number): number {
  return Math.max(MIN_PREVIEW_SCALE, Math.min(MAX_PREVIEW_SCALE, value));
}

function readStoredPreviewScale(): number {
  if (typeof window === "undefined") return DEFAULT_PREVIEW_SCALE;
  const stored = window.localStorage.getItem(PREVIEW_SCALE_KEY);
  if (!stored) return DEFAULT_PREVIEW_SCALE;
  const n = Number(stored);
  return Number.isFinite(n) ? clampPreviewScale(n) : DEFAULT_PREVIEW_SCALE;
}

function layerStyleFromRow(
  layer: DocAiLayerBox,
  row: DocAiLayerOverride | undefined
): {
  font_size_px: number;
  font_weight: number;
  color_hex: string;
  font_family: string;
  font_style_italic: boolean;
} {
  const font_size_px = row?.font_size_px ?? layer.font_size_px ?? DEFAULT_FONT_PX;
  const font_weight = row?.font_weight ?? layer.font_weight ?? 700;
  const color_hex = row?.color_hex ?? layer.color_hex ?? "#111111";
  const font_family = row?.font_family ?? layer.font_family ?? "";
  const font_style_italic = row?.font_style_italic ?? layer.font_style_italic ?? false;
  return { font_size_px, font_weight, color_hex, font_family, font_style_italic };
}

function roleLabel(role: string, fullBleed?: boolean, blockIndex?: number): string {
  if (fullBleed) {
    if (role.toLowerCase() === "handle" || role.toLowerCase() === "watermark") return "Handle";
    return blockIndex != null ? `Box ${blockIndex + 1}` : "Box";
  }
  const r = role.toLowerCase();
  if (r === "headline" || r === "title" || r === "hook") return "Headline";
  if (r === "handle" || r === "watermark") return "Handle";
  if (r === "kicker" || r === "subheadline") return "Subhead";
  if (r === "body" || r === "subtitle" || r === "caption") return "Body";
  if (r && r !== "cta") return r.charAt(0).toUpperCase() + r.slice(1);
  return "Text";
}

function inferDisplayRole(layer: DocAiLayerBox, row?: DocAiLayerOverride): string {
  const text = (row?.text ?? layer.text ?? "").trim();
  if (/^@[a-z0-9_.]{2,}$/i.test(text)) return "handle";
  if (layer.role === "handle" || layer.layer_key?.includes("handle")) return "handle";
  return layer.role || "body";
}

function clampBox(
  x: number,
  y: number,
  w: number,
  h: number
): { x_px: number; y_px: number; w_px: number; h_px: number } {
  let width = Math.max(MIN_BOX_W, Math.round(w));
  let height = Math.max(MIN_BOX_H, Math.round(h));
  let left = Math.round(x);
  let top = Math.round(y);
  left = Math.max(0, Math.min(CANVAS_W - MIN_BOX_W, left));
  top = Math.max(0, Math.min(CANVAS_H - MIN_BOX_H, top));
  width = Math.min(width, CANVAS_W - left);
  height = Math.min(height, CANVAS_H - top);
  return { x_px: left, y_px: top, w_px: width, h_px: height };
}

function resizeFromCorner(
  corner: ResizeCorner,
  origX: number,
  origY: number,
  origW: number,
  origH: number,
  dx: number,
  dy: number
): { x_px: number; y_px: number; w_px: number; h_px: number } {
  let x = origX;
  let y = origY;
  let w = origW;
  let h = origH;

  if (corner === "se") {
    w = origW + dx;
    h = origH + dy;
  } else if (corner === "sw") {
    w = origW - dx;
    x = origX + origW - w;
    h = origH + dy;
  } else if (corner === "ne") {
    w = origW + dx;
    h = origH - dy;
    y = origY + origH - h;
  } else {
    w = origW - dx;
    h = origH - dy;
    x = origX + origW - w;
    y = origY + origH - h;
  }

  return clampBox(x, y, w, h);
}

/**
 * Stable, order-independent serialization of the override list used to classify an
 * emit as "programmatic" (seed / auto-fit / prop-sync) vs a genuine user edit. The
 * editor records the key of every programmatic mutation; the emit effect treats a
 * matching key as an initialize (baseline, never dirty) and anything else as a user
 * change. This avoids the prior reliance on effect ordering, which mis-reported the
 * seeded layout as a user edit and triggered spurious auto-save + reprint on load.
 */
function overrideEmitKey(rows: DocAiLayerOverride[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.layer_key.localeCompare(b.layer_key))
      .map((r) => ({
        k: r.layer_key,
        x: r.x_px,
        y: r.y_px,
        w: r.w_px,
        h: r.h_px,
        f: r.font_size_px,
        fw: r.font_weight,
        c: r.color_hex,
        ff: r.font_family,
        it: r.font_style_italic,
        t: r.text,
        hidden: r.hidden,
        locked: r.box_locked,
      }))
  );
}

export function MimicDocAiLayerPositionEditor({
  slideIndex,
  backgroundUrl,
  layers,
  initialOverrides,
  onOverridesChange,
  onLayoutInitialized,
  textBacking = true,
  textBackingColor,
  projectHandle = "",
  suppressReseed = false,
  activeBlockIndex = null,
  onActiveBlockIndexChange,
  fullBleedMode = false,
  templateBgMode = false,
  brandPalette = [],
  logoOverlayUrl = "",
  textBackingEnabled,
  onTextBackingEnabledChange,
  textBackingColorHex,
  onTextBackingColorHexChange,
  logoStampEnabled,
  onLogoStampEnabledChange,
  brandLogoPreviewUrl = "",
  slideCount = 1,
  onApplyTypographyToRole,
  onApplyPlacementToRole,
  draftSyncRevision = 0,
}: MimicDocAiLayerPositionEditorProps) {
  const canvasColRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(360);
  const [previewScale, setPreviewScale] = useState(DEFAULT_PREVIEW_SCALE);
  const [previewResizeDrag, setPreviewResizeDrag] = useState<PreviewResizeDrag | null>(null);
  const [overrides, setOverrides] = useState<Record<string, DocAiLayerOverride>>({});
  const [customLayers, setCustomLayers] = useState<DocAiLayerBox[]>([]);
  const layersRef = useRef(layers);
  const customLayersRef = useRef(customLayers);
  layersRef.current = layers;
  customLayersRef.current = customLayers;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);
  const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const lastActiveBlockIndexRef = useRef<number | null>(null);

  // Undo/redo history. Each entry is a full snapshot of the editable state
  // (overrides + custom boxes + selection). We snapshot at discrete commit
  // boundaries (add/delete/fit/typography clicks, the start of a drag, the start
  // of a text edit) rather than on every keystroke, so a single Ctrl+Z reverts a
  // whole logical action. Restoring a snapshot re-emits the override list, which
  // flows back to the parent as a normal user edit (auto-save + reprint).
  type EditorSnapshot = {
    overrides: Record<string, DocAiLayerOverride>;
    customLayers: DocAiLayerBox[];
    selectedKey: string | null;
  };
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const overridesRef = useRef(overrides);
  const selectedKeyRef = useRef(selectedKey);
  overridesRef.current = overrides;
  selectedKeyRef.current = selectedKey;
  const dragSnapshotRef = useRef<EditorSnapshot | null>(null);
  const dragMovedRef = useRef(false);
  // Layer key whose copy is mid-edit — lets consecutive keystrokes collapse into
  // one undo entry (we snapshot on the first keystroke of an editing session).
  const textEditKeyRef = useRef<string | null>(null);
  // Timestamp of the last selection the editor made itself. The parent echoes the
  // selection back via `activeBlockIndex`, but in cluster/full-bleed mode it can be
  // normalized to a *different* box in the same group — which would otherwise yank
  // the selection away from the box the user just clicked. We ignore that echo for
  // a short window so editor clicks win.
  const selfSelectAtRef = useRef(0);

  const captureSnapshot = useCallback(
    (): EditorSnapshot => ({
      overrides: overridesRef.current,
      customLayers: customLayersRef.current,
      selectedKey: selectedKeyRef.current,
    }),
    []
  );

  const pushUndoSnapshot = useCallback((snap: EditorSnapshot) => {
    setUndoStack((stack) => [...stack.slice(-49), snap]);
    setRedoStack([]);
  }, []);

  const pushUndo = useCallback(() => {
    pushUndoSnapshot(captureSnapshot());
  }, [pushUndoSnapshot, captureSnapshot]);

  const applySnapshot = useCallback((snap: EditorSnapshot) => {
    setOverrides(snap.overrides);
    setCustomLayers(snap.customLayers);
    setSelectedKey(snap.selectedKey);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setRedoStack((r) => [...r.slice(-49), captureSnapshot()]);
      applySnapshot(prev);
      return stack.slice(0, -1);
    });
  }, [captureSnapshot, applySnapshot]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((u) => [...u.slice(-49), captureSnapshot()]);
      applySnapshot(next);
      return stack.slice(0, -1);
    });
  }, [captureSnapshot, applySnapshot]);

  useEffect(() => {
    setFontSizeDraft(null);
    textEditKeyRef.current = null;
    if (selectedKey) {
      window.requestAnimationFrame(() => textInputRef.current?.focus());
    }
  }, [selectedKey, slideIndex]);

  const scale = containerWidth / CANVAS_W;
  const highlightBackground = textBacking
    ? textBackingColor || "rgba(255,255,255,0.92)"
    : "rgba(0,0,0,0.35)";

  useEffect(() => {
    setPreviewScale(readStoredPreviewScale());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREVIEW_SCALE_KEY, String(previewScale));
  }, [previewScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth || 360));
    ro.observe(el);
    setContainerWidth(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);

  const onPreviewResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!previewResizeDrag) return;
      const dx = e.clientX - previewResizeDrag.startX;
      const next = previewResizeDrag.startScale + dx / Math.max(120, previewResizeDrag.colWidth);
      setPreviewScale(clampPreviewScale(Math.round(next * 100) / 100));
    },
    [previewResizeDrag]
  );

  const endPreviewResize = useCallback(() => {
    setPreviewResizeDrag(null);
  }, []);

  const layerKeysFingerprint = useMemo(
    () => layers.map((l) => l.layer_key).join("\0"),
    [layers]
  );
  function overridesGeometryFingerprint(rows: DocAiLayerOverride[]): string {
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
  const initialOverridesFingerprint = useMemo(
    () => overridesGeometryFingerprint(initialOverrides ?? []),
    [initialOverrides]
  );
  const slideSeedRef = useRef({ slideIndex: -1, layerKeys: "", overridesKey: "" });

  useEffect(() => {
    const layerKeysChanged = slideSeedRef.current.layerKeys !== layerKeysFingerprint;
    const slideChanged = slideSeedRef.current.slideIndex !== slideIndex;
    const overridesChanged = slideSeedRef.current.overridesKey !== initialOverridesFingerprint;
    if (!slideChanged && !layerKeysChanged && !overridesChanged) return;
    if (suppressReseed && !slideChanged) return;

    slideSeedRef.current = {
      slideIndex,
      layerKeys: layerKeysFingerprint,
      overridesKey: initialOverridesFingerprint,
    };

    const savedByKey = new Map((initialOverrides ?? []).map((p) => [p.layer_key, p]));
    const savedByRefKey = new Map(
      (initialOverrides ?? []).map((p) => [refKeyFromLayerPositionKey(p.layer_key), p])
    );
    const resolveSaved = (layerKey: string): DocAiLayerOverride | undefined =>
      savedByKey.get(layerKey) ?? savedByRefKey.get(refKeyFromLayerPositionKey(layerKey));

    const nextCustom: DocAiLayerBox[] = [];
    const next: Record<string, DocAiLayerOverride> = {};
    for (const layer of layers) {
      if (isCustomLayerKey(layer.layer_key)) continue;
      const key = layer.layer_key;
      const savedRow = resolveSaved(key);
      const text = templateBgMode
        ? templateBgLayerSeedText(layer, savedRow, projectHandle)
        : (savedRow?.text ?? layer.text);
      const baseFont = defaultLayerFontPx(layer, savedRow?.font_size_px, projectHandle);
      const x_px = savedRow?.x_px ?? layer.x_px;
      const y_px = savedRow?.y_px ?? layer.y_px;
      const seedSize = resolveSeedBoxSize(
        layer,
        savedRow,
        text,
        savedRow?.font_size_px ?? baseFont,
        x_px,
        y_px
      );
      const style = layerStyleFromRow(layer, savedRow);
      next[key] = {
        layer_key: key,
        x_px,
        y_px,
        w_px: seedSize.w_px,
        h_px: seedSize.h_px,
        font_size_px: style.font_size_px,
        font_weight: style.font_weight,
        color_hex: style.color_hex,
        ...(style.font_family ? { font_family: style.font_family } : {}),
        ...(style.font_style_italic ? { font_style_italic: true } : {}),
        text,
        ...(savedRow?.hidden && !templateBgMode ? { hidden: true } : {}),
        box_locked: true,
      };
    }
    for (const savedRow of initialOverrides ?? []) {
      if (!isCustomLayerKey(savedRow.layer_key) || savedRow.hidden) continue;
      if (nextCustom.some((box) => box.layer_key === savedRow.layer_key)) continue;
      const box = customBoxFromOverride(savedRow, projectHandle);
      nextCustom.push(box);
      next[savedRow.layer_key] = {
        ...savedRow,
        text: savedRow.text ?? box.text,
        w_px: savedRow.w_px ?? box.w_px,
        h_px: savedRow.h_px ?? box.h_px,
        font_size_px: savedRow.font_size_px ?? box.font_size_px ?? DEFAULT_FONT_PX,
        box_locked: true,
      };
    }
    for (const savedRow of initialOverrides ?? []) {
      if (templateBgMode || !savedRow.hidden || isCustomLayerKey(savedRow.layer_key)) continue;
      const ref = refKeyFromLayerPositionKey(savedRow.layer_key);
      const matchedVisible = layers.some(
        (layer) =>
          layer.layer_key === savedRow.layer_key || refKeyFromLayerPositionKey(layer.layer_key) === ref
      );
      if (!matchedVisible && !next[savedRow.layer_key]) {
        next[savedRow.layer_key] = { ...savedRow };
      }
    }
    setCustomLayers((prevCustom) => {
      const mergedKeys = new Set(nextCustom.map((b) => b.layer_key));
      const keysInLayers = new Set(
        layers.filter((l) => isCustomLayerKey(l.layer_key)).map((l) => l.layer_key)
      );
      const unsavedLocal = prevCustom.filter(
        (b) =>
          isCustomLayerKey(b.layer_key) &&
          !mergedKeys.has(b.layer_key) &&
          !keysInLayers.has(b.layer_key)
      );
      return unsavedLocal.length > 0 ? [...nextCustom, ...unsavedLocal] : nextCustom;
    });
    setOverrides((prevOverrides) => {
      const merged = { ...next };
      for (const [key, row] of Object.entries(prevOverrides)) {
        if (!isCustomLayerKey(key) || merged[key] || row.hidden) continue;
        merged[key] = row;
      }
      programmaticEmitKeysRef.current.add(overrideEmitKey(Object.values(merged)));
      return merged;
    });
    const allKeys = [...layers.map((l) => l.layer_key), ...nextCustom.map((l) => l.layer_key)];
    setSelectedKey((prev) => (prev && next[prev] && !next[prev]?.hidden ? prev : allKeys.find((k) => !next[k]?.hidden) ?? null));
  }, [
    layers,
    initialOverrides,
    slideIndex,
    layerKeysFingerprint,
    initialOverridesFingerprint,
    projectHandle,
    suppressReseed,
    templateBgMode,
  ]);

  useEffect(() => {
    if (!draftSyncRevision || !initialOverrides?.length) return;
    const byKey = new Map(initialOverrides.map((row) => [row.layer_key, row]));
    const byRefKey = new Map(initialOverrides.map((row) => [refKeyFromLayerPositionKey(row.layer_key), row]));
    setOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const layer of layers) {
        const key = layer.layer_key;
        const incoming =
          byKey.get(key) ?? byRefKey.get(refKeyFromLayerPositionKey(key));
        if (!incoming) continue;
        const merged = { ...(next[key] ?? incoming), ...incoming, layer_key: key };
        if (JSON.stringify(merged) !== JSON.stringify(next[key])) {
          next[key] = merged;
          changed = true;
        }
      }
      if (!changed) return prev;
      programmaticEmitKeysRef.current.add(overrideEmitKey(Object.values(next)));
      return next;
    });
  }, [draftSyncRevision, initialOverrides, layers]);

  const layerCopyFingerprintRef = useRef("");
  useEffect(() => {
    if (!templateBgMode || layers.length === 0) return;
    const fp = layers.map((l) => `${l.layer_key}:${l.text}`).join("\0");
    if (fp === layerCopyFingerprintRef.current) return;
    layerCopyFingerprintRef.current = fp;
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const layer of layers) {
        const key = layer.layer_key;
        const row = next[key];
        const freshText = layer.text;
        if (!row || freshText == null || row.text === freshText) continue;
        const ocrRole = ocrRoleForLayer(layer);
        if (ocrRole === "body" && freshText.trim() && looksLikeHandleText(freshText)) continue;
        if (
          ocrRole !== "handle" &&
          freshText.trim() &&
          looksLikeHandleText(freshText) &&
          row.text?.trim() &&
          !looksLikeHandleText(row.text)
        ) {
          continue;
        }
        next[key] = { ...row, text: freshText };
        changed = true;
      }
      if (!changed) return prev;
      programmaticEmitKeysRef.current.add(overrideEmitKey(Object.values(next)));
      return next;
    });
  }, [layers, templateBgMode]);

  const overrideList = useMemo(() => Object.values(overrides), [overrides]);
  const onOverridesChangeRef = useRef(onOverridesChange);
  const onLayoutInitializedRef = useRef(onLayoutInitialized);
  onOverridesChangeRef.current = onOverridesChange;
  onLayoutInitializedRef.current = onLayoutInitialized;
  // Keys of override snapshots produced programmatically (seed / auto-fit / prop sync).
  // Seeded with the empty-list key so the very first mount emit is treated as init.
  const programmaticEmitKeysRef = useRef<Set<string>>(new Set([overrideEmitKey([])]));

  useEffect(() => {
    const key = overrideEmitKey(overrideList);
    const programmatic = programmaticEmitKeysRef.current;
    if (programmatic.has(key)) {
      programmatic.delete(key);
      onLayoutInitializedRef.current?.(overrideList);
      return;
    }
    onOverridesChangeRef.current?.(overrideList);
  }, [overrideList]);

  const updateOverride = useCallback((key: string, patch: Partial<DocAiLayerOverride>) => {
    setOverrides((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const layer =
        layersRef.current.find((l) => l.layer_key === key) ??
        customLayersRef.current.find((l) => l.layer_key === key);
      const merged = { ...row, ...patch, layer_key: key };
      if (patch.text === undefined) {
        const copyText = resolveEditorLayerText(layer, merged, templateBgMode, projectHandle);
        if (copyText && copyText !== merged.text) {
          merged.text = copyText;
        }
      }
      const shouldReflow = patch.text != null || patch.font_size_px != null;
      let nextRow = merged;
      if (shouldReflow && patch.x_px == null && patch.y_px == null && patch.w_px == null && patch.h_px == null) {
        const copyText = resolveEditorLayerText(layer, merged, templateBgMode, projectHandle);
        const open = openHighlightBoxForText(
          copyText,
          merged.font_size_px ?? MIN_FONT_PX,
          merged.x_px,
          merged.y_px,
          merged.w_px && merged.w_px > MIN_BOX_W ? { fixedWidthPx: merged.w_px } : undefined
        );
        nextRow = { ...merged, w_px: open.w_px, h_px: open.h_px, box_locked: true };
      }
      return { ...prev, [key]: nextRow };
    });
    if (isCustomLayerKey(key)) {
      setCustomLayers((boxes) =>
        boxes.map((box) => {
          if (box.layer_key !== key) return box;
          return {
            ...box,
            ...(patch.text != null ? { text: patch.text } : {}),
            ...(patch.x_px != null ? { x_px: patch.x_px } : {}),
            ...(patch.y_px != null ? { y_px: patch.y_px } : {}),
            ...(patch.w_px != null ? { w_px: patch.w_px } : {}),
            ...(patch.h_px != null ? { h_px: patch.h_px } : {}),
            ...(patch.font_size_px != null ? { font_size_px: patch.font_size_px } : {}),
          };
        })
      );
    }
  }, [templateBgMode, projectHandle]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (resizeDrag) {
        const dx = (e.clientX - resizeDrag.startX) / scale;
        const dy = (e.clientY - resizeDrag.startY) / scale;
        const box = resizeFromCorner(
          resizeDrag.corner,
          resizeDrag.origX,
          resizeDrag.origY,
          resizeDrag.origW,
          resizeDrag.origH,
          dx,
          dy
        );
        dragMovedRef.current = true;
        updateOverride(resizeDrag.key, box);
        return;
      }
      if (!moveDrag) return;
      dragMovedRef.current = true;
      const dx = (e.clientX - moveDrag.startX) / scale;
      const dy = (e.clientY - moveDrag.startY) / scale;
      const row = overrides[moveDrag.key];
      const w = Math.max(MIN_BOX_W, row?.w_px ?? MIN_BOX_W);
      const h = Math.max(MIN_BOX_H, row?.h_px ?? MIN_BOX_H);
      const box = clampBox(moveDrag.origX + dx, moveDrag.origY + dy, w, h);
      updateOverride(moveDrag.key, { x_px: box.x_px, y_px: box.y_px });
    },
    [moveDrag, resizeDrag, scale, updateOverride, overrides]
  );

  const endPointer = useCallback(() => {
    if (resizeDrag) {
      updateOverride(resizeDrag.key, { box_locked: true });
    } else if (moveDrag) {
      const row = overrides[moveDrag.key];
      updateOverride(moveDrag.key, {
        box_locked: true,
        ...(row?.w_px != null ? { w_px: row.w_px } : {}),
        ...(row?.h_px != null ? { h_px: row.h_px } : {}),
      });
    }
    // Only record a history entry when a drag actually moved/resized a box —
    // a plain click (select) must not pollute the undo stack.
    if ((moveDrag || resizeDrag) && dragMovedRef.current && dragSnapshotRef.current) {
      pushUndoSnapshot(dragSnapshotRef.current);
    }
    dragSnapshotRef.current = null;
    dragMovedRef.current = false;
    setMoveDrag(null);
    setResizeDrag(null);
  }, [moveDrag, resizeDrag, updateOverride, overrides, pushUndoSnapshot]);

  const selected = selectedKey ? overrides[selectedKey] : null;
  const displayLayers = useMemo(() => {
    const byKey = new Map<string, DocAiLayerBox>();
    const order: string[] = [];
    const add = (layer: DocAiLayerBox) => {
      if (!byKey.has(layer.layer_key)) order.push(layer.layer_key);
      byKey.set(layer.layer_key, layer);
    };
    for (const layer of layers) {
      if (!isCustomLayerKey(layer.layer_key)) add(layer);
    }
    for (const layer of layers) {
      if (isCustomLayerKey(layer.layer_key)) add(layer);
    }
    for (const layer of customLayers) add(layer);
    return order.map((key) => byKey.get(key)!);
  }, [layers, customLayers]);
  const selectedLayer = selectedKey ? displayLayers.find((l) => l.layer_key === selectedKey) : null;
  const selectedLayerForPanel: DocAiLayerBox | null =
    selected && selectedKey
      ? (selectedLayer ?? {
          layer_key: selectedKey,
          text: selected.text ?? "",
          role: roleFromLayerKey(selectedKey),
          x_px: selected.x_px,
          y_px: selected.y_px,
          w_px: selected.w_px ?? MIN_BOX_W,
          h_px: selected.h_px ?? MIN_BOX_H,
          font_size_px: selected.font_size_px,
        })
      : null;
  const visibleLayers = useMemo(
    () => displayLayers.filter((layer) => !overrides[layer.layer_key]?.hidden),
    [displayLayers, overrides]
  );
  const layerPaintOrder = useMemo(() => {
    const sorted = [...visibleLayers].sort((a, b) => {
      const rowA = overrides[a.layer_key];
      const rowB = overrides[b.layer_key];
      const areaA = (rowA?.w_px ?? a.w_px) * (rowA?.h_px ?? a.h_px);
      const areaB = (rowB?.w_px ?? b.w_px) * (rowB?.h_px ?? b.h_px);
      return areaA - areaB;
    });
    return new Map(sorted.map((layer, index) => [layer.layer_key, index]));
  }, [visibleLayers, overrides]);
  useEffect(() => {
    lastActiveBlockIndexRef.current = null;
    setSelectedKey(null);
    setUndoStack([]);
    setRedoStack([]);
  }, [slideIndex]);

  useEffect(() => {
    if (activeBlockIndex == null) {
      lastActiveBlockIndexRef.current = null;
      return;
    }
    if (lastActiveBlockIndexRef.current === activeBlockIndex) return;
    // The parent is echoing back a selection the editor just initiated (possibly
    // normalized to another box in the same cluster). Record the new index but keep
    // the user's actual click — don't re-select.
    if (Date.now() - selfSelectAtRef.current < 250) {
      lastActiveBlockIndexRef.current = activeBlockIndex;
      return;
    }
    lastActiveBlockIndexRef.current = activeBlockIndex;
    const match =
      visibleLayers.find((l) => l.block_index === activeBlockIndex) ?? visibleLayers[activeBlockIndex];
    if (match) setSelectedKey(match.layer_key);
  }, [activeBlockIndex, visibleLayers]);

  useEffect(() => {
    if (layers.length === 0) return;
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const layer of layers) {
        const key = layer.layer_key;
        const row = next[key];
        if (!row || row.hidden) continue;
        const copyText = resolveEditorLayerText(layer, row, templateBgMode, projectHandle);
        if (!copyText) continue;
        const fontSize = defaultLayerFontPx(layer, row.font_size_px, projectHandle);
        const fitted = openHighlightBoxForText(
          copyText,
          fontSize,
          row.x_px,
          row.y_px,
          row.w_px && row.w_px > MIN_BOX_W ? { fixedWidthPx: row.w_px } : undefined
        );
        const w = row.w_px ?? MIN_BOX_W;
        const h = row.h_px ?? MIN_BOX_H;
        const needsText = !row.text?.trim();
        const needsSize = h < fitted.h_px - 4 || w < fitted.w_px - 4;
        if (!needsText && !needsSize) continue;
        next[key] = {
          ...row,
          text: copyText,
          w_px: needsSize ? fitted.w_px : row.w_px,
          h_px: needsSize ? fitted.h_px : row.h_px,
          box_locked: true,
        };
        changed = true;
      }
      if (!changed) return prev;
      programmaticEmitKeysRef.current.add(overrideEmitKey(Object.values(next)));
      return next;
    });
  }, [slideIndex, layerKeysFingerprint, layers, templateBgMode, projectHandle]);

  const selectLayer = useCallback(
    (key: string) => {
      // Selection must never mutate geometry — doing so previously marked the layout
      // dirty (and triggered auto-save + reprint) just from clicking through boxes.
      setSelectedKey(key);
      const layer = visibleLayers.find((l) => l.layer_key === key);
      const idx = layer?.block_index ?? visibleLayers.findIndex((l) => l.layer_key === key);
      if (idx >= 0) {
        lastActiveBlockIndexRef.current = idx;
        selfSelectAtRef.current = Date.now();
        onActiveBlockIndexChange?.(idx);
      }
    },
    [visibleLayers, onActiveBlockIndexChange]
  );

  const hiddenCount = displayLayers.length - visibleLayers.length;
  const baseImageUrl = backgroundUrl?.trim() || "";

  const fitBoxToText = useCallback((key: string, row: DocAiLayerOverride) => {
    pushUndo();
    const layer =
      layersRef.current.find((l) => l.layer_key === key) ??
      customLayersRef.current.find((l) => l.layer_key === key);
    const copyText = resolveEditorLayerText(layer, row, templateBgMode, projectHandle);
    const open = openHighlightBoxForText(
      copyText,
      row.font_size_px ?? DEFAULT_FONT_PX,
      row.x_px,
      row.y_px
    );
    updateOverride(key, { text: copyText || row.text, w_px: open.w_px, h_px: open.h_px, box_locked: true });
  }, [updateOverride, templateBgMode, projectHandle, pushUndo]);

  const fitAllBoxesToText = useCallback(() => {
    pushUndo();
    setOverrides((prev) => {
      const next: Record<string, DocAiLayerOverride> = { ...prev };
      for (const [key, row] of Object.entries(next)) {
        if (!row || row.hidden) continue;
        const layer =
          layersRef.current.find((l) => l.layer_key === key) ??
          customLayersRef.current.find((l) => l.layer_key === key);
        const copyText = resolveEditorLayerText(layer, row, templateBgMode, projectHandle);
        const open = openHighlightBoxForText(
          copyText,
          row.font_size_px ?? DEFAULT_FONT_PX,
          row.x_px,
          row.y_px
        );
        next[key] = { ...row, text: copyText || row.text, w_px: open.w_px, h_px: open.h_px, box_locked: true };
      }
      return next;
    });
  }, [templateBgMode, projectHandle, pushUndo]);

  const addTextBox = useCallback(() => {
    const existingPlaceholder = customLayersRef.current.find((box) => {
      const row = overridesRef.current[box.layer_key];
      const text = (row?.text ?? box.text ?? "").trim();
      return !text || text === "New text";
    });
    if (existingPlaceholder) {
      selectLayer(existingPlaceholder.layer_key);
      return;
    }
    pushUndo();
    const key = newCustomLayerKey();
    const text = "New text";
    const font_size_px = DEFAULT_FONT_PX;
    const x_px = Math.round(CANVAS_W * 0.2);
    const y_px = Math.round(CANVAS_H * 0.35);
    const open = openHighlightBoxForText(text, font_size_px, x_px, y_px);
    const box: DocAiLayerBox = {
      layer_key: key,
      text,
      role: "body",
      x_px,
      y_px,
      w_px: open.w_px,
      h_px: open.h_px,
      font_size_px,
    };
    const newBlockIndex = layers.length + customLayers.length;
    setCustomLayers((prev) => [...prev, box]);
    setOverrides((prev) => ({
      ...prev,
      [key]: {
        layer_key: key,
        x_px: box.x_px,
        y_px: box.y_px,
        w_px: box.w_px,
        h_px: box.h_px,
        font_size_px: box.font_size_px,
        text: box.text,
        box_locked: true,
      },
    }));
    setSelectedKey(key);
    lastActiveBlockIndexRef.current = newBlockIndex;
    selfSelectAtRef.current = Date.now();
    onActiveBlockIndexChange?.(newBlockIndex);
  }, [layers.length, customLayers.length, onActiveBlockIndexChange, pushUndo, selectLayer]);

  const deleteSelectedLayer = useCallback(() => {
    if (!selectedKey) return;
    const row = overrides[selectedKey];
    if (!row) return;
    pushUndo();
    if (isCustomLayerKey(selectedKey)) {
      setCustomLayers((prev) => prev.filter((box) => box.layer_key !== selectedKey));
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[selectedKey];
        return next;
      });
    } else {
      const refKey = refKeyFromLayerPositionKey(selectedKey);
      const layerMeta = displayLayers.find((l) => l.layer_key === selectedKey);
      setOverrides((prev) => {
        const next = { ...prev };
        for (const [key, entry] of Object.entries(next)) {
          if (!entry || isCustomLayerKey(key)) continue;
          if (key === selectedKey || refKeyFromLayerPositionKey(key) === refKey) {
            next[key] = { ...entry, hidden: true };
          }
        }
        next[refKey] = {
          layer_key: refKey,
          x_px: row.x_px ?? layerMeta?.x_px ?? 0,
          y_px: row.y_px ?? layerMeta?.y_px ?? 0,
          hidden: true,
        };
        return next;
      });
    }
    setSelectedKey(null);
    lastActiveBlockIndexRef.current = null;
    onActiveBlockIndexChange?.(null);
  }, [selectedKey, overrides, displayLayers, onActiveBlockIndexChange, pushUndo]);

  // Escape hatch for the "boxes piled up and won't go away" case: drop every
  // manually-added box in one click (undoable). OCR/seeded boxes are untouched.
  const clearAddedBoxes = useCallback(() => {
    if (customLayersRef.current.length === 0) return;
    pushUndo();
    setCustomLayers([]);
    setOverrides((prev) => {
      const next: Record<string, DocAiLayerOverride> = {};
      for (const [key, row] of Object.entries(prev)) {
        if (isCustomLayerKey(key)) continue;
        next[key] = row;
      }
      return next;
    });
    setSelectedKey((prev) => (prev && isCustomLayerKey(prev) ? null : prev));
    lastActiveBlockIndexRef.current = null;
    onActiveBlockIndexChange?.(null);
  }, [pushUndo, onActiveBlockIndexChange]);

  const restoreHiddenLayers = useCallback(() => {
    pushUndo();
    setOverrides((prev) => {
      const next: Record<string, DocAiLayerOverride> = {};
      for (const [key, row] of Object.entries(prev)) {
        if (!row || row.hidden) continue;
        next[key] = row;
      }
      return next;
    });
    setSelectedKey(null);
    lastActiveBlockIndexRef.current = null;
    onActiveBlockIndexChange?.(null);
  }, [onActiveBlockIndexChange, pushUndo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. When focused in a
      // text field, defer to the browser's native field-level undo instead.
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (inField) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (inField) return;
        e.preventDefault();
        redo();
        return;
      }
      if (!selectedKey || inField) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedLayer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedKey, deleteSelectedLayer, undo, redo]);

  if (layers.length === 0 && customLayers.length === 0) {
    return (
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
          No Document AI text layers for slide {slideIndex}. You can still add a custom text box.
        </p>
        <button type="button" className="btn-secondary btn-sm" onClick={addTextBox}>
          Add text box
        </button>
      </div>
    );
  }

  return (
    <div className="mimic-docai-editor">
      <div className="mimic-docai-editor__toolbar">
        <div className="mimic-docai-editor__toolbar-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={undo}
            disabled={undoStack.length === 0}
            title="Undo last change (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={redo}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            Redo
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={fitAllBoxesToText}>
            Fit boxes to text
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={addTextBox}>
            Add text box
          </button>
          {selectedKey ? (
            <button type="button" className="btn-danger-ghost btn-sm" onClick={deleteSelectedLayer}>
              Delete box
            </button>
          ) : null}
          {customLayers.length > 0 ? (
            <button
              type="button"
              className="btn-danger-ghost btn-sm"
              onClick={clearAddedBoxes}
              title="Remove every box you added on this slide"
            >
              Clear added boxes ({customLayers.length})
            </button>
          ) : null}
          {hiddenCount > 0 ? (
            <>
              <button type="button" className="btn-secondary btn-sm" onClick={restoreHiddenLayers}>
                Restore hidden
              </button>
              <span className="mimic-docai-editor__hidden-count">{hiddenCount} hidden</span>
            </>
          ) : null}
        </div>
      </div>

      {visibleLayers.length > 0 ? (
        <div className="mimic-docai-editor__layer-tabs">
          {visibleLayers.map((layer) => {
            const key = layer.layer_key;
            const row = overrides[key];
            const preview = (row?.text ?? layer.text).trim();
            const short = preview.length > 36 ? `${preview.slice(0, 36)}…` : preview || "(empty)";
            const active = selectedKey === key;
            const blockIndex = layer.block_index ?? visibleLayers.indexOf(layer);
            return (
              <button
                key={key}
                type="button"
                className={`mimic-docai-editor__layer-tab${active ? " mimic-docai-editor__layer-tab--active" : ""}`}
                onClick={() => selectLayer(key)}
                title={preview}
              >
                {roleLabel(inferDisplayRole(layer, row), fullBleedMode, blockIndex)}: {short}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mimic-docai-editor__workspace">
        <div ref={canvasColRef} className="mimic-docai-editor__canvas-col">
          <div
            ref={containerRef}
            className="mimic-docai-editor__canvas"
            style={{ width: `${previewScale * 100}%` }}
            onPointerMove={(e) => {
              onPreviewResizeMove(e);
              onPointerMove(e);
            }}
            onPointerUp={(e) => {
              endPreviewResize();
              endPointer();
            }}
            onPointerLeave={(e) => {
              endPreviewResize();
              endPointer();
            }}
            onPointerCancel={(e) => {
              endPreviewResize();
              endPointer();
            }}
          >
            <div className="mimic-docai-editor__canvas-inner">
              {baseImageUrl ? (
                <img
                  src={baseImageUrl}
                  alt=""
                  draggable={false}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
              {!baseImageUrl ? (
                <div className="mimic-docai-editor__canvas-empty">
                  No background plate for this slide — reprint or regenerate art-only image first.
                </div>
              ) : null}
              {logoOverlayUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoOverlayUrl}
                  alt="Brand logo preview"
                  draggable={false}
                  className="mimic-docai-editor__logo-preview"
                />
              ) : null}
              {visibleLayers.map((layer) => {
                const key = layer.layer_key;
                const row = overrides[key] ?? {
                  layer_key: key,
                  x_px: layer.x_px,
                  y_px: layer.y_px,
                  w_px: layer.w_px,
                  h_px: layer.h_px,
                  font_size_px: layer.font_size_px ?? DEFAULT_FONT_PX,
                  text: layer.text,
                };
                const style = layerStyleFromRow(layer, row);
                const fontSizePx = style.font_size_px;
                const copyText = resolveEditorLayerText(layer, row, templateBgMode, projectHandle);
                // Paint at the stored size so a manual resize (incl. shrinking) sticks.
                // Boxes are kept fitted to copy by the seed + auto-fit + type-reflow paths.
                const boxW = Math.max(MIN_BOX_W, row.w_px ?? MIN_BOX_W);
                const boxH = Math.max(MIN_BOX_H, row.h_px ?? MIN_BOX_H);
                const w = boxW * scale;
                const h = boxH * scale;
                const isSelected = selectedKey === key;
                const previewFont = Math.max(8, style.font_size_px * scale);
                const displayText = copyText || layer.text;
                const padY = 4 * scale;
                const padX = 10 * scale;
                const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
                const paintIndex = layerPaintOrder.get(key) ?? 0;
                const linkedBlock =
                  (layer.block_index ?? visibleLayers.findIndex((l) => l.layer_key === key)) === activeBlockIndex;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectLayer(key)}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).dataset.resizeCorner) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      selectLayer(key);
                      dragSnapshotRef.current = captureSnapshot();
                      dragMovedRef.current = false;
                      setMoveDrag({
                        key,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: row.x_px,
                        origY: row.y_px,
                      });
                    }}
                    title={displayText}
                    style={{
                      position: "absolute",
                      left: row.x_px * scale,
                      top: row.y_px * scale,
                      width: w,
                      height: h,
                      boxSizing: "border-box",
                      border: isSelected
                        ? "2px solid rgba(37,99,235,1)"
                        : linkedBlock
                          ? "2px solid rgba(16,185,129,0.9)"
                          : "2px solid rgba(59,130,246,0.75)",
                      background: highlightBackground,
                      color: style.color_hex,
                      fontSize: previewFont,
                      fontWeight: style.font_weight,
                      fontFamily: style.font_family || undefined,
                      fontStyle: style.font_style_italic ? "italic" : "normal",
                      lineHeight: HIGHLIGHT_LINE_HEIGHT,
                      padding: `${padY}px ${padX}px`,
                      cursor: "grab",
                      userSelect: "none",
                      touchAction: "none",
                      overflow: "visible",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      zIndex: isSelected ? 20 : 3 + paintIndex,
                      boxShadow: isSelected ? "0 0 0 2px rgba(37,99,235,0.25)" : undefined,
                    }}
                  >
                    {displayText}
                    {isSelected
                      ? corners.map((corner) => (
                          <div
                            key={corner}
                            data-resize-corner={corner}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              selectLayer(key);
                              dragSnapshotRef.current = captureSnapshot();
                              dragMovedRef.current = false;
                              setResizeDrag({
                                key,
                                corner,
                                startX: e.clientX,
                                startY: e.clientY,
                                origX: row.x_px,
                                origY: row.y_px,
                                origW: boxW,
                                origH: boxH,
                              });
                            }}
                            style={{
                              position: "absolute",
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              background: "#fff",
                              border: "2px solid rgba(37,99,235,1)",
                              boxSizing: "border-box",
                              zIndex: 5,
                              cursor: CORNER_CURSORS[corner],
                              ...(corner === "nw" ? { left: -5, top: -5 } : {}),
                              ...(corner === "ne" ? { right: -5, top: -5 } : {}),
                              ...(corner === "sw" ? { left: -5, bottom: -5 } : {}),
                              ...(corner === "se" ? { right: -5, bottom: -5 } : {}),
                            }}
                          />
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
            <div
              className="mimic-docai-editor__canvas-resize-handle"
              title="Drag to resize preview"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                const colWidth = canvasColRef.current?.clientWidth ?? containerWidth;
                setPreviewResizeDrag({
                  startX: e.clientX,
                  startScale: previewScale,
                  colWidth,
                });
              }}
            />
          </div>
        </div>

        <div className="mimic-docai-editor__inspector-col">
          {selected && selectedLayerForPanel ? (
            <div className="mimic-docai-editor__selected-panel">
              <p className="mimic-docai-editor__selected-header">
                <span>
                  {roleLabel(
                    inferDisplayRole(selectedLayerForPanel, selected),
                    fullBleedMode,
                    selectedLayerForPanel.block_index ??
                      visibleLayers.findIndex((l) => l.layer_key === selected.layer_key)
                  )}
                  {isCustomLayerKey(selected.layer_key) ? " (added)" : ""}
                </span>
                <button
                  type="button"
                  className="btn-danger-ghost btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={deleteSelectedLayer}
                >
                  Delete box
                </button>
              </p>
              <label className="filter-label">Text</label>
              <textarea
                ref={textInputRef}
                value={resolveEditorLayerText(selectedLayerForPanel, selected, templateBgMode, projectHandle)}
                rows={3}
                readOnly={templateBgMode}
                onChange={(e) => {
                  if (templateBgMode) return;
                  if (textEditKeyRef.current !== selected.layer_key) {
                    pushUndo();
                    textEditKeyRef.current = selected.layer_key;
                  }
                  updateOverride(selected.layer_key, { text: e.target.value });
                }}
                className="mimic-docai-editor__text-input"
                placeholder={templateBgMode ? "Edit copy in Slide copy (left column)…" : "Type on-slide copy…"}
              />
              {templateBgMode ? (
                <p className="mimic-docai-editor__box-dims" style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                  Copy is edited in the Slide copy panel — this preview follows those fields.
                </p>
              ) : null}
              {(() => {
                const style = layerStyleFromRow(selectedLayerForPanel, selected);
                const activeFontPx = selected.font_size_px ?? style.font_size_px;
                const panelBox = {
                  w_px: Math.max(MIN_BOX_W, selected.w_px ?? MIN_BOX_W),
                  h_px: Math.max(MIN_BOX_H, selected.h_px ?? MIN_BOX_H),
                };
                const fontSizeDisplay = fontSizeDraft ?? String(activeFontPx);
                return (
                  <>
                    <div className="mimic-docai-editor__font-row">
                      <span className="mimic-docai-editor__font-label">Size</span>
                      <button
                        type="button"
                        className="btn-secondary mimic-docai-editor__font-step"
                        onClick={() => {
                          setFontSizeDraft(null);
                          pushUndo();
                          updateOverride(selected.layer_key, {
                            font_size_px: Math.max(MIN_FONT_PX, activeFontPx - 2),
                          });
                        }}
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="mimic-docai-editor__font-input"
                        value={fontSizeDisplay}
                        onFocus={() => setFontSizeDraft(String(activeFontPx))}
                        onChange={(e) => setFontSizeDraft(e.target.value)}
                        onBlur={() => {
                          const raw = (fontSizeDraft ?? fontSizeDisplay).trim();
                          setFontSizeDraft(null);
                          if (!raw) return;
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          if (Math.round(n) === activeFontPx) return;
                          pushUndo();
                          updateOverride(selected.layer_key, {
                            font_size_px: Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(n))),
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary mimic-docai-editor__font-step"
                        onClick={() => {
                          setFontSizeDraft(null);
                          pushUndo();
                          updateOverride(selected.layer_key, {
                            font_size_px: Math.min(MAX_FONT_PX, activeFontPx + 2),
                          });
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div className="mimic-docai-editor__font-row mimic-docai-editor__font-row--styles">
                      <label className="mimic-docai-editor__style-toggle">
                        <input
                          type="checkbox"
                          checked={style.font_weight >= 700}
                          onChange={(e) => {
                            pushUndo();
                            updateOverride(selected.layer_key, {
                              font_weight: e.target.checked ? 700 : 400,
                            });
                          }}
                        />
                        Bold
                      </label>
                      <label className="mimic-docai-editor__style-toggle">
                        <input
                          type="checkbox"
                          checked={style.font_style_italic}
                          onChange={(e) => {
                            pushUndo();
                            updateOverride(selected.layer_key, { font_style_italic: e.target.checked });
                          }}
                        />
                        Italic
                      </label>
                    </div>
                    <div className="mimic-docai-editor__font-row">
                      <span className="mimic-docai-editor__font-label">Color</span>
                      <input
                        type="color"
                        value={style.color_hex}
                        onFocus={() => pushUndo()}
                        onChange={(e) => updateOverride(selected.layer_key, { color_hex: e.target.value })}
                        className="mimic-docai-editor__color-input"
                      />
                      {brandPalette.length > 0 ? (
                        <div className="brand-swatches" title="Brand palette">
                          {brandPalette.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              className="brand-swatch"
                              style={{ background: hex }}
                              title={hex}
                              aria-label={`Use ${hex}`}
                              onClick={() => {
                                pushUndo();
                                updateOverride(selected.layer_key, { color_hex: hex });
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="mimic-docai-editor__font-row">
                      <span className="mimic-docai-editor__font-label">Font</span>
                      <select
                        value={style.font_family}
                        onChange={(e) => {
                          pushUndo();
                          updateOverride(selected.layer_key, { font_family: e.target.value });
                        }}
                        className="mimic-docai-editor__family-select"
                      >
                        {FONT_FAMILY_OPTIONS.map((opt) => (
                          <option key={opt.label} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="mimic-docai-editor__box-dims">
                      {Math.round(panelBox.w_px)}×{Math.round(panelBox.h_px)} px
                      <button
                        type="button"
                        className="btn-ghost btn-sm mimic-docai-editor__fit-one-btn"
                        onClick={() => fitBoxToText(selected.layer_key, selected)}
                      >
                        Fit box to text
                      </button>
                    </p>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="mimic-docai-editor__inspector-empty">
              Select a text box on the preview to edit copy and style.
            </div>
          )}
          {slideCount >= 1 && (onApplyTypographyToRole || onApplyPlacementToRole) ? (
            <div className="mimic-docai-editor__deck-actions">
              <p className="mimic-docai-editor__deck-actions-title">Apply to all slides</p>
              {!selected ? (
                <p className="mimic-docai-editor__deck-actions-hint">
                  Select a box first — its settings become the source.
                </p>
              ) : null}
              {onApplyTypographyToRole ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary btn-sm mimic-docai-editor__apply-typography-btn"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected || !selectedLayerForPanel) return;
                      const style = layerStyleFromRow(selectedLayerForPanel, selected);
                      onApplyTypographyToRole("headline", {
                        font_size_px: style.font_size_px,
                        font_weight: style.font_weight,
                        color_hex: style.color_hex,
                        font_family: style.font_family || undefined,
                        font_style_italic: style.font_style_italic,
                      });
                    }}
                  >
                    Typography → all Headline boxes
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm mimic-docai-editor__apply-typography-btn"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected || !selectedLayerForPanel) return;
                      const style = layerStyleFromRow(selectedLayerForPanel, selected);
                      onApplyTypographyToRole("body", {
                        font_size_px: style.font_size_px,
                        font_weight: style.font_weight,
                        color_hex: style.color_hex,
                        font_family: style.font_family || undefined,
                        font_style_italic: style.font_style_italic,
                      });
                    }}
                  >
                    Typography → all Body boxes
                  </button>
                </>
              ) : null}
              {onApplyPlacementToRole ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary btn-sm mimic-docai-editor__apply-typography-btn"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected || !selectedLayerForPanel) return;
                      onApplyPlacementToRole("headline", {
                        x_px: selected.x_px,
                        y_px: selected.y_px,
                        w_px: selected.w_px ?? selectedLayerForPanel.w_px,
                        h_px: selected.h_px ?? selectedLayerForPanel.h_px,
                        box_locked: true,
                      });
                    }}
                  >
                    Box placement → all Headline boxes
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm mimic-docai-editor__apply-typography-btn"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected || !selectedLayerForPanel) return;
                      onApplyPlacementToRole("body", {
                        x_px: selected.x_px,
                        y_px: selected.y_px,
                        w_px: selected.w_px ?? selectedLayerForPanel.w_px,
                        h_px: selected.h_px ?? selectedLayerForPanel.h_px,
                        box_locked: true,
                      });
                    }}
                  >
                    Box placement → all Body boxes
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {onTextBackingEnabledChange ? (
            <div className="mimic-docai-editor__overlay-options">
              <label className="mimic-layer-editor-panel__option">
                <input
                  type="checkbox"
                  checked={textBackingEnabled ?? textBacking}
                  onChange={(e) => onTextBackingEnabledChange(e.target.checked)}
                />
                <span>Highlight behind text</span>
              </label>
              {(textBackingEnabled ?? textBacking) && onTextBackingColorHexChange ? (
                <label className="mimic-layer-editor-panel__highlight-color">
                  <span>Colour</span>
                  <input
                    type="color"
                    value={textBackingColorHex ?? "#ffffff"}
                    onChange={(e) => onTextBackingColorHexChange(e.target.value)}
                    title="Highlight colour behind text"
                  />
                </label>
              ) : null}
              {(textBackingEnabled ?? textBacking) && brandPalette.length > 0 && onTextBackingColorHexChange ? (
                <div className="brand-swatches" title="Brand palette">
                  {brandPalette.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className="brand-swatch"
                      style={{ background: hex }}
                      title={hex}
                      aria-label={`Use ${hex}`}
                      onClick={() => onTextBackingColorHexChange(hex)}
                    />
                  ))}
                </div>
              ) : null}
              {brandLogoPreviewUrl.trim() && onLogoStampEnabledChange ? (
                <label className="mimic-layer-editor-panel__option">
                  <input
                    type="checkbox"
                    checked={Boolean(logoStampEnabled)}
                    onChange={(e) => onLogoStampEnabledChange(e.target.checked)}
                  />
                  <span>Stamp brand logo (lower-right)</span>
                </label>
              ) : null}
              {logoStampEnabled && brandLogoPreviewUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brandLogoPreviewUrl} alt="Brand logo" className="brand-logo-chip" />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** @deprecated use DocAiLayerOverride */
export type DocAiLayerPosition = DocAiLayerOverride;
