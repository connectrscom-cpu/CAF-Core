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

function newCustomLayerKey(): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${CUSTOM_LAYER_KEY_PREFIX}body@${id}`;
}

const HIGHLIGHT_PAD_X = 16;
const HIGHLIGHT_PAD_Y = 12;
const HIGHLIGHT_LINE_HEIGHT = 1.15;

/** Size the white highlight box to fit full copy (single-line when possible). */
export function openHighlightBoxForText(
  text: string,
  fontSizePx: number,
  xPx: number,
  yPx: number
): { w_px: number; h_px: number } {
  const fontSize = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(fontSizePx) || DEFAULT_FONT_PX));
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l, i, arr) => l.length > 0 || arr.length === 1);
  const safeLines = lines.length > 0 ? lines : [""];
  const charW = fontSize * 0.55;
  const maxLineChars = Math.max(...safeLines.map((l) => l.length));
  const width = Math.min(
    CANVAS_W - Math.max(0, xPx),
    Math.max(MIN_BOX_W, Math.ceil(maxLineChars * charW + HIGHLIGHT_PAD_X))
  );
  const height = Math.min(
    CANVAS_H - Math.max(0, yPx),
    Math.max(
      MIN_BOX_H,
      Math.ceil(safeLines.length * fontSize * HIGHLIGHT_LINE_HEIGHT + HIGHLIGHT_PAD_Y)
    )
  );
  return { w_px: width, h_px: height };
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
  const open =
    row.box_locked && row.w_px && row.h_px
      ? { w_px: Math.max(MIN_BOX_W, row.w_px), h_px: Math.max(MIN_BOX_H, row.h_px) }
      : openHighlightBoxForText(text, fontSize, row.x_px, row.y_px);
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
  skip_center_avoid?: boolean;
};

export type DocAiLayerOverride = {
  layer_key: string;
  x_px: number;
  y_px: number;
  w_px?: number;
  h_px?: number;
  font_size_px?: number;
  text?: string;
  box_locked?: boolean;
  hidden?: boolean;
};

type MimicDocAiLayerPositionEditorProps = {
  slideIndex: number;
  backgroundUrl?: string;
  layers: DocAiLayerBox[];
  initialOverrides?: DocAiLayerOverride[];
  onOverridesChange?: (overrides: DocAiLayerOverride[]) => void;
  /** Fired once when slide layers seed — not a user edit. */
  onLayoutInitialized?: (overrides: DocAiLayerOverride[]) => void;
  /** When true, draw white highlight pills behind copy in the editor (matches reprint). */
  textBacking?: boolean;
  /** Optional server-rendered PNG under the interactive boxes (manual refresh only). */
  renderPreviewUrl?: string | null;
  renderPreviewBusy?: boolean;
  /** Project Instagram handle — handle OCR boxes default to 25px. */
  projectHandle?: string;
  /** When true, ignore inspect/layer refreshes on the same slide (preserves deletes/moves). */
  suppressReseed?: boolean;
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

const CORNER_CURSORS: Record<ResizeCorner, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

function roleLabel(role: string): string {
  const r = role.toLowerCase();
  if (r === "headline" || r === "title" || r === "hook") return "Headline";
  if (r === "handle" || r === "watermark") return "Handle";
  if (r === "kicker" || r === "subheadline") return "Subhead";
  if (r === "body" || r === "subtitle" || r === "caption") return "Body";
  if (r && r !== "cta") return r.charAt(0).toUpperCase() + r.slice(1);
  return "Text";
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

export function MimicDocAiLayerPositionEditor({
  slideIndex,
  backgroundUrl,
  layers,
  initialOverrides,
  onOverridesChange,
  onLayoutInitialized,
  textBacking = true,
  renderPreviewUrl = null,
  renderPreviewBusy = false,
  projectHandle = "",
  suppressReseed = false,
}: MimicDocAiLayerPositionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(360);
  const [overrides, setOverrides] = useState<Record<string, DocAiLayerOverride>>({});
  const [customLayers, setCustomLayers] = useState<DocAiLayerBox[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  const scale = containerWidth / CANVAS_W;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth || 360));
    ro.observe(el);
    setContainerWidth(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);

  const layerKeysFingerprint = useMemo(
    () => layers.map((l) => l.layer_key).join("\0"),
    [layers]
  );
  const initialOverridesFingerprint = useMemo(
    () => JSON.stringify(initialOverrides ?? []),
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
      const key = layer.layer_key;
      const savedRow = resolveSaved(key);
      const text = savedRow?.text ?? layer.text;
      const baseFont = defaultLayerFontPx(layer, savedRow?.font_size_px, projectHandle);
      const x_px = savedRow?.x_px ?? layer.x_px;
      const y_px = savedRow?.y_px ?? layer.y_px;
      const locked = savedRow?.box_locked === true;
      const open =
        locked && savedRow?.w_px != null && savedRow?.h_px != null
          ? {
              w_px: Math.max(MIN_BOX_W, savedRow.w_px),
              h_px: Math.max(MIN_BOX_H, savedRow.h_px),
            }
          : openHighlightBoxForText(text, savedRow?.font_size_px ?? baseFont, x_px, y_px);
      next[key] = {
        layer_key: key,
        x_px,
        y_px,
        w_px: open.w_px,
        h_px: open.h_px,
        font_size_px: savedRow?.font_size_px ?? baseFont,
        text,
        ...(savedRow?.hidden ? { hidden: true } : {}),
        box_locked: savedRow?.box_locked ?? false,
      };
    }
    for (const savedRow of initialOverrides ?? []) {
      if (!isCustomLayerKey(savedRow.layer_key) || savedRow.hidden) continue;
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
      if (!savedRow.hidden || isCustomLayerKey(savedRow.layer_key)) continue;
      const ref = refKeyFromLayerPositionKey(savedRow.layer_key);
      const matchedVisible = layers.some(
        (layer) =>
          layer.layer_key === savedRow.layer_key || refKeyFromLayerPositionKey(layer.layer_key) === ref
      );
      if (!matchedVisible && !next[savedRow.layer_key]) {
        next[savedRow.layer_key] = { ...savedRow };
      }
    }
    setCustomLayers(nextCustom);
    setOverrides(next);
    const allKeys = [...layers.map((l) => l.layer_key), ...nextCustom.map((l) => l.layer_key)];
    setSelectedKey((prev) => (prev && next[prev] && !next[prev]?.hidden ? prev : allKeys.find((k) => !next[k]?.hidden) ?? null));
    skipUserChangeEmitRef.current = true;
  }, [
    layers,
    initialOverrides,
    slideIndex,
    layerKeysFingerprint,
    initialOverridesFingerprint,
    projectHandle,
    suppressReseed,
  ]);

  const overrideList = useMemo(() => Object.values(overrides), [overrides]);
  const onOverridesChangeRef = useRef(onOverridesChange);
  const onLayoutInitializedRef = useRef(onLayoutInitialized);
  onOverridesChangeRef.current = onOverridesChange;
  onLayoutInitializedRef.current = onLayoutInitialized;
  const skipUserChangeEmitRef = useRef(false);

  useEffect(() => {
    if (skipUserChangeEmitRef.current) {
      skipUserChangeEmitRef.current = false;
      onLayoutInitializedRef.current?.(overrideList);
      return;
    }
    onOverridesChangeRef.current?.(overrideList);
  }, [overrideList]);

  const updateOverride = useCallback((key: string, patch: Partial<DocAiLayerOverride>) => {
    setOverrides((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const merged = { ...row, ...patch, layer_key: key };
      const shouldReflow = patch.text != null || patch.font_size_px != null;
      let nextRow = merged;
      if (shouldReflow && patch.x_px == null && patch.y_px == null && !merged.box_locked) {
        const open = openHighlightBoxForText(
          merged.text ?? "",
          merged.font_size_px ?? MIN_FONT_PX,
          merged.x_px,
          merged.y_px
        );
        nextRow = { ...merged, w_px: open.w_px, h_px: open.h_px };
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
  }, []);

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
        updateOverride(resizeDrag.key, box);
        return;
      }
      if (!moveDrag) return;
      const dx = (e.clientX - moveDrag.startX) / scale;
      const dy = (e.clientY - moveDrag.startY) / scale;
      const row = overrides[moveDrag.key];
      const w = row?.w_px ?? MIN_BOX_W;
      const h = row?.h_px ?? MIN_BOX_H;
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
    setMoveDrag(null);
    setResizeDrag(null);
  }, [moveDrag, resizeDrag, updateOverride, overrides]);

  const selected = selectedKey ? overrides[selectedKey] : null;
  const displayLayers = useMemo(() => [...layers, ...customLayers], [layers, customLayers]);
  const selectedLayer = selectedKey ? displayLayers.find((l) => l.layer_key === selectedKey) : null;
  const visibleLayers = useMemo(
    () => displayLayers.filter((layer) => !overrides[layer.layer_key]?.hidden),
    [displayLayers, overrides]
  );
  const hiddenCount = displayLayers.length - visibleLayers.length;
  const showRenderPreview = Boolean(renderPreviewUrl?.trim());
  const baseImageUrl = backgroundUrl?.trim() || (showRenderPreview ? renderPreviewUrl!.trim() : "");

  const fitAllBoxesToText = useCallback(() => {
    setOverrides((prev) => {
      const next: Record<string, DocAiLayerOverride> = { ...prev };
      for (const [key, row] of Object.entries(next)) {
        if (!row || row.hidden) continue;
        const open = openHighlightBoxForText(
          row.text ?? "",
          row.font_size_px ?? DEFAULT_FONT_PX,
          row.x_px,
          row.y_px
        );
        next[key] = { ...row, w_px: open.w_px, h_px: open.h_px, box_locked: false };
      }
      return next;
    });
  }, []);

  const addTextBox = useCallback(() => {
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
  }, []);

  const deleteSelectedLayer = useCallback(() => {
    if (!selectedKey) return;
    const row = overrides[selectedKey];
    if (!row) return;
    if (isCustomLayerKey(selectedKey)) {
      setCustomLayers((prev) => prev.filter((box) => box.layer_key !== selectedKey));
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[selectedKey];
        return next;
      });
    } else {
      updateOverride(selectedKey, { hidden: true });
    }
    setSelectedKey(null);
  }, [selectedKey, overrides, updateOverride]);

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
    <div>
      <div className="mimic-docai-editor__toolbar">
        <p className="mimic-docai-editor__toolbar-hint">
          Drag boxes to move. Select a box, then drag corner handles to resize the highlight. Click a box to
          edit copy or font size. Use &quot;Preview render&quot; to check the Puppeteer output before reprint.
          {hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </p>
        <div className="mimic-docai-editor__toolbar-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={fitAllBoxesToText}>
            Fit boxes to text
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={addTextBox}>
            Add text box
          </button>
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
            return (
              <button
                key={key}
                type="button"
                className={`mimic-docai-editor__layer-tab${active ? " mimic-docai-editor__layer-tab--active" : ""}`}
                onClick={() => setSelectedKey(key)}
                title={preview}
              >
                {roleLabel(layer.role)}: {short}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        ref={containerRef}
        style={{ width: "100%", maxWidth: 540 }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            background: "#f3f4f6",
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          {baseImageUrl ? (
            <img
              src={baseImageUrl}
              alt=""
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
          {showRenderPreview && backgroundUrl?.trim() ? (
            <img
              src={renderPreviewUrl!}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.35,
                pointerEvents: "none",
              }}
            />
          ) : null}
          {renderPreviewBusy ? (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                padding: "4px 8px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.9)",
                fontSize: 11,
                color: "var(--muted)",
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              Rendering preview…
            </div>
          ) : null}
          {!baseImageUrl ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                fontSize: 11,
                color: "var(--muted)",
                textAlign: "center",
              }}
            >
              No background plate for this slide — reprint or regenerate art-only image first.
            </div>
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
            const boxW = Math.max(MIN_BOX_W, row.w_px ?? layer.w_px);
            const boxH = Math.max(MIN_BOX_H, row.h_px ?? layer.h_px);
            const w = boxW * scale;
            const h = boxH * scale;
            const isSelected = selectedKey === key;
            const previewFont = Math.max(8, (row.font_size_px ?? DEFAULT_FONT_PX) * scale);
            const displayText = row.text ?? layer.text;
            const padY = 4 * scale;
            const padX = 10 * scale;
            const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedKey(key)}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).dataset.resizeCorner) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setSelectedKey(key);
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
                  boxSizing: "border-box",
                  border: isSelected
                    ? "2px solid rgba(37,99,235,1)"
                    : "2px solid rgba(59,130,246,0.75)",
                  background: textBacking ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.35)",
                  color: textBacking ? "#111" : "#fff",
                  fontSize: previewFont,
                  lineHeight: HIGHLIGHT_LINE_HEIGHT,
                  padding: `${padY}px ${padX}px`,
                  cursor: "grab",
                  userSelect: "none",
                  overflow: "visible",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  minHeight: h,
                  height: "auto",
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                  zIndex: isSelected ? 4 : 3,
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
                          setSelectedKey(key);
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
      </div>

      {selected && selectedLayer ? (
        <div className="mimic-docai-editor__selected-panel">
          <p className="mimic-docai-editor__selected-header">
            <span>
              {roleLabel(selectedLayer.role)}
              {isCustomLayerKey(selected.layer_key) ? " (added)" : ""} — edit selected layer
            </span>
            <button type="button" className="btn-danger-ghost" style={{ marginLeft: "auto" }} onClick={deleteSelectedLayer}>
              Delete box
            </button>
          </p>
          <label className="filter-label">Text</label>
          <textarea
            value={selected.text ?? ""}
            rows={2}
            onChange={(e) => updateOverride(selected.layer_key, { text: e.target.value })}
            style={{
              width: "100%",
              fontSize: 12,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div className="mimic-docai-editor__font-row">
            <span style={{ fontSize: 11, color: "var(--fg-secondary)" }}>Font size (px)</span>
            <button
              type="button"
              className="btn-secondary mimic-docai-editor__font-step"
              onClick={() =>
                updateOverride(selected.layer_key, {
                  font_size_px: Math.max(MIN_FONT_PX, (selected.font_size_px ?? DEFAULT_FONT_PX) - 2),
                })
              }
            >
              −
            </button>
            <input
              type="number"
              className="mimic-docai-editor__font-input"
              min={MIN_FONT_PX}
              max={MAX_FONT_PX}
              value={selected.font_size_px ?? DEFAULT_FONT_PX}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                updateOverride(selected.layer_key, {
                  font_size_px: Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(n))),
                });
              }}
            />
            <button
              type="button"
              className="btn-secondary mimic-docai-editor__font-step"
              onClick={() =>
                updateOverride(selected.layer_key, {
                  font_size_px: Math.min(MAX_FONT_PX, (selected.font_size_px ?? DEFAULT_FONT_PX) + 2),
                })
              }
            >
              +
            </button>
            <span style={{ fontSize: 11, color: "var(--fg-secondary)" }}>
              Box {Math.round(selected.w_px ?? selectedLayer.w_px)}×{Math.round(selected.h_px ?? selectedLayer.h_px)} px
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated use DocAiLayerOverride */
export type DocAiLayerPosition = DocAiLayerOverride;
