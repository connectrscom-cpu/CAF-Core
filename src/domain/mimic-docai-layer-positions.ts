import { isHandleTextBlock, looksLikeInstagramHandleText } from "./instagram-handle.js";

export type MimicDocAiLayerPositionLayer = {
  text: string;
  role: string;
  x_pct: number;
  y_pct: number;
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  css_style: string;
  ref_x?: number;
  ref_y?: number;
  w_pct?: number;
  h_pct?: number;
  layout_mode?: string;
  layout_class?: string;
  font_size_px?: number | null;
  ref_font_size_px?: number | null;
  font_weight?: number | null;
  color_hex?: string | null;
  text_align?: string;
  text_backing?: boolean;
  skip_center_avoid?: boolean;
  /** Set when reviewer overrides w/h — renderer keeps box dimensions on reprint. */
  reviewer_box_locked?: boolean;
};

export type MimicDocAiLayerPositionOverride = {
  layer_key: string;
  x_px: number;
  y_px: number;
  /** Reviewer override — applied on reprint when set. */
  font_size_px?: number;
  /** Reviewer override — applied on reprint when non-empty. */
  text?: string;
  /** Reviewer override — highlight box width in px. */
  w_px?: number;
  /** Reviewer override — highlight box height in px. */
  h_px?: number;
  /** Reviewer override — CSS font-weight (400–900). */
  font_weight?: number;
  /** Reviewer override — text color (#rrggbb). */
  color_hex?: string;
  /** Reviewer override — CSS font-family stack. */
  font_family?: string;
  /** Reviewer override — italic style. */
  font_style_italic?: boolean;
  /** When true, w/h are frozen on reprint (user resized the highlight box). */
  box_locked?: boolean;
  /** When true, layer is omitted from reprint (reviewer deleted the text box). */
  hidden?: boolean;
};

/** Per-slide map keyed by slide index string ("1", "2", …). */
export type MimicDocAiLayerPositionsBySlide = Record<string, MimicDocAiLayerPositionOverride[]>;

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX = 50;
export const MIMIC_DOCAI_MIN_FONT_SIZE_PX = 32;
/** Soft cap for first paint in Review layout editor — saved overrides may exceed this. */
export const MIMIC_DOCAI_EDITOR_INITIAL_FONT_MAX_PX = 60;
const MIMIC_DOCAI_HANDLE_FONT_SIZE_PX = 28;
export const MIMIC_CUSTOM_DOCAI_LAYER_KEY_PREFIX = "custom@";

/** Clamp inspect / inferred sizes on first editor open (reviewer saves are not passed through here). */
export function clampMimicDocAiInitialEditorFontPx(size: number): number {
  return Math.max(
    MIMIC_DOCAI_MIN_FONT_SIZE_PX,
    Math.min(MIMIC_DOCAI_EDITOR_INITIAL_FONT_MAX_PX, Math.round(size))
  );
}

export function isCustomAddedMimicDocAiLayerKey(layerKey: string): boolean {
  return String(layerKey ?? "").trim().startsWith(MIMIC_CUSTOM_DOCAI_LAYER_KEY_PREFIX);
}

/** Review editor copy-slot keys (`slot@1`, …) — not OCR keys; composited like custom boxes. */
export function isCopySlotEditorLayerPositionKey(layerKey: string): boolean {
  return /^slot@\d+$/.test(String(layerKey ?? "").trim());
}

/** Layers placed by the reviewer that are not native OCR keys (custom text boxes + copy slots). */
export function isReviewerPlacedDocAiLayerKey(layerKey: string): boolean {
  return isCustomAddedMimicDocAiLayerKey(layerKey) || isCopySlotEditorLayerPositionKey(layerKey);
}

/** Role token from keys like `custom@body@abc123`. */
export function parseCustomMimicDocAiLayerRole(layerKey: string): string {
  const parts = String(layerKey ?? "").split("@");
  const role = parts[1]?.trim().toLowerCase();
  if (role === "headline" || role === "title" || role === "cta" || role === "handle") return role;
  return "body";
}

export function buildCustomMimicDocAiLayerFromOverride(
  override: MimicDocAiLayerPositionOverride
): MimicDocAiLayerPositionLayer {
  const role = parseCustomMimicDocAiLayerRole(override.layer_key);
  const text = String(override.text ?? "New text").trim() || "New text";
  const x = Math.max(0, Math.min(CANVAS_W, Math.round(override.x_px)));
  const y = Math.max(0, Math.min(CANVAS_H, Math.round(override.y_px)));
  const w = Math.max(40, Math.min(CANVAS_W, Math.round(override.w_px ?? 280)));
  const h = Math.max(24, Math.min(CANVAS_H, Math.round(override.h_px ?? 72)));
  const defaultFontPx =
    role === "handle" || isHandleTextBlock(role, text) || looksLikeInstagramHandleText(text)
      ? MIMIC_DOCAI_HANDLE_FONT_SIZE_PX
      : MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX;
  const fontSize = Math.max(
    MIMIC_DOCAI_MIN_FONT_SIZE_PX,
    Math.round(override.font_size_px ?? defaultFontPx)
  );
  const fontWeight =
    override.font_weight != null && Number.isFinite(override.font_weight) && override.font_weight >= 100
      ? Math.round(override.font_weight / 100) * 100
      : 700;
  const colorHex =
    typeof override.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(override.color_hex.trim())
      ? override.color_hex.trim()
      : "#111111";
  const fontFamily = override.font_family?.trim() || "sans-serif";
  const fontStyle = override.font_style_italic ? "italic" : "normal";
  const css = [
    `left:${x}px`,
    `top:${y}px`,
    `width:${w}px`,
    `height:${h}px`,
    `font-size:${fontSize}px`,
    `font-weight:${fontWeight}`,
    `color:${colorHex}`,
    `font-family:${fontFamily}`,
    `font-style:${fontStyle}`,
    "text-align:left",
    "line-height:1.15",
    "position:absolute",
    "box-sizing:border-box",
  ].join(";");
  return {
    text,
    role,
    x_pct: x / CANVAS_W,
    y_pct: y / CANVAS_H,
    w_pct: w / CANVAS_W,
    h_pct: h / CANVAS_H,
    x_px: x,
    y_px: y,
    w_px: w,
    h_px: h,
    layout_mode: "single_line",
    layout_class: "mimic-docai-layer--single-line",
    font_size_px: fontSize,
    ref_font_size_px: fontSize,
    font_weight: fontWeight,
    color_hex: colorHex,
    text_align: "left",
    css_style: css,
    text_backing: true,
    skip_center_avoid: true,
    reviewer_box_locked: true,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Stable key for matching reviewer overrides across reprints (role + ref bbox + text prefix). */
export function mimicDocAiLayerPositionKey(
  layer: Pick<MimicDocAiLayerPositionLayer, "role" | "text" | "ref_x" | "ref_y" | "x_pct" | "y_pct">
): string {
  const role = String(layer.role ?? "body").toLowerCase();
  const text = String(layer.text ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 64);
  const rx =
    layer.ref_x != null && Number.isFinite(layer.ref_x)
      ? Math.round(layer.ref_x * 1000)
      : Math.round((layer.x_pct ?? 0) * 1000);
  const ry =
    layer.ref_y != null && Number.isFinite(layer.ref_y)
      ? Math.round(layer.ref_y * 1000)
      : Math.round((layer.y_pct ?? 0) * 1000);
  return `${role}@${rx},${ry}:${text}`;
}

/** Stable match key without text — survives copy edits on reprint. */
export function mimicDocAiLayerRefKey(
  layer: Pick<MimicDocAiLayerPositionLayer, "role" | "ref_x" | "ref_y" | "x_pct" | "y_pct">
): string {
  const role = String(layer.role ?? "body").toLowerCase();
  const rx =
    layer.ref_x != null && Number.isFinite(layer.ref_x)
      ? Math.round(layer.ref_x * 1000)
      : Math.round((layer.x_pct ?? 0) * 1000);
  const ry =
    layer.ref_y != null && Number.isFinite(layer.ref_y)
      ? Math.round(layer.ref_y * 1000)
      : Math.round((layer.y_pct ?? 0) * 1000);
  return `${role}@${rx},${ry}`;
}

export function refKeyFromLayerPositionKey(layerKey: string): string {
  const colon = layerKey.indexOf(":");
  return colon >= 0 ? layerKey.slice(0, colon) : layerKey;
}

export function patchMimicDocAiLayerPxPosition<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  xPx: number,
  yPx: number
): T {
  const left = Math.max(0, Math.min(CANVAS_W, Math.round(xPx)));
  const top = Math.max(0, Math.min(CANVAS_H, Math.round(yPx)));
  let css = layer.css_style;
  css = /left:\d+px/.test(css) ? css.replace(/left:\d+px/, `left:${left}px`) : `left:${left}px;${css}`;
  css = /top:\d+px/.test(css) ? css.replace(/top:\d+px/, `top:${top}px`) : `top:${top}px;${css}`;
  return {
    ...layer,
    x_px: left,
    y_px: top,
    x_pct: left / CANVAS_W,
    y_pct: top / CANVAS_H,
    css_style: css,
  };
}

export function patchMimicDocAiLayerFontSize<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  fontSizePx: number
): T {
  const fontSize = Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.round(fontSizePx));
  const css = /font-size:\d+px/.test(layer.css_style)
    ? layer.css_style.replace(/font-size:\d+px/, `font-size:${fontSize}px`)
    : `${layer.css_style};font-size:${fontSize}px`;
  return { ...layer, font_size_px: fontSize, css_style: css };
}

export function patchMimicDocAiLayerText<T extends MimicDocAiLayerPositionLayer>(layer: T, text: string): T {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return layer;
  return { ...layer, text: trimmed };
}

function patchCssProp(css: string, prop: string, value: string): string {
  const re = new RegExp(`${prop}:[^;]+`);
  return re.test(css) ? css.replace(re, `${prop}:${value}`) : `${css};${prop}:${value}`;
}

export function patchMimicDocAiLayerFontWeight<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  fontWeight: number
): T {
  const weight = Math.max(100, Math.min(900, Math.round(fontWeight / 100) * 100));
  return {
    ...layer,
    font_weight: weight,
    css_style: patchCssProp(layer.css_style, "font-weight", String(weight)),
  };
}

export function patchMimicDocAiLayerColor<T extends MimicDocAiLayerPositionLayer>(layer: T, colorHex: string): T {
  const color = /^#[0-9a-fA-F]{3,8}$/.test(colorHex.trim()) ? colorHex.trim() : layer.color_hex ?? "#111111";
  return {
    ...layer,
    color_hex: color,
    css_style: patchCssProp(layer.css_style, "color", color),
  };
}

export function patchMimicDocAiLayerFontFamily<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  fontFamily: string
): T {
  const family = fontFamily.trim();
  if (!family) return layer;
  return {
    ...layer,
    css_style: patchCssProp(layer.css_style, "font-family", family),
  };
}

export function patchMimicDocAiLayerFontStyle<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  italic: boolean
): T {
  const css = italic
    ? patchCssProp(layer.css_style, "font-style", "italic")
    : layer.css_style.replace(/font-style:[^;]+;?/g, "");
  return { ...layer, css_style: css };
}

export function patchMimicDocAiLayerSize<T extends MimicDocAiLayerPositionLayer>(
  layer: T,
  wPx: number,
  hPx: number
): T {
  const width = Math.max(40, Math.min(CANVAS_W, Math.round(wPx)));
  const height = Math.max(24, Math.min(CANVAS_H, Math.round(hPx)));
  let css = layer.css_style;
  css = /width:\d+px/.test(css) ? css.replace(/width:\d+px/, `width:${width}px`) : `width:${width}px;${css}`;
  css = /height:\d+px/.test(css) ? css.replace(/height:\d+px/, `height:${height}px`) : `height:${height}px;${css}`;
  return {
    ...layer,
    w_px: width,
    h_px: height,
    w_pct: width / CANVAS_W,
    h_pct: height / CANVAS_H,
    css_style: css,
    reviewer_box_locked: true,
  };
}

/** Build generation_payload slide copy from saved layout boxes (reprint / template_bg fallback). */
export function llmSlideCopyPatchFromDocAiOverrides(
  overrides: MimicDocAiLayerPositionOverride[]
): Record<string, unknown> | null {
  const blocks: Array<{ role: string; text: string }> = [];
  for (const o of overrides) {
    if (o.hidden) continue;
    const text = o.text?.trim() ?? "";
    if (!text || looksLikeInstagramHandleText(text)) continue;
    const roleHead = o.layer_key.split("@")[0]?.trim().toLowerCase() || "body";
    const role =
      roleHead === "headline" || roleHead === "title" || roleHead === "cta"
        ? roleHead === "title"
          ? "headline"
          : roleHead
        : "body";
    blocks.push({ role, text });
  }
  if (blocks.length === 0) return null;
  const headline = blocks.find((b) => b.role === "headline")?.text ?? "";
  const body = blocks
    .filter((b) => b.role === "body")
    .map((b) => b.text)
    .join("\n");
  return {
    text_blocks: blocks,
    on_slide_lines: blocks.map((b) => b.text),
    ...(headline ? { headline } : {}),
    ...(body ? { body } : {}),
  };
}

export function parseMimicDocAiLayerPositionsBySlide(raw: unknown): MimicDocAiLayerPositionsBySlide | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const out: MimicDocAiLayerPositionsBySlide = {};
  for (const [slideKey, rows] of Object.entries(rec)) {
    if (!Array.isArray(rows)) continue;
    const parsed: MimicDocAiLayerPositionOverride[] = [];
    for (const row of rows) {
      const r = asRecord(row);
      if (!r) continue;
      const layer_key = String(r.layer_key ?? "").trim();
      const x_px = Number(r.x_px);
      const y_px = Number(r.y_px);
      if (!layer_key || !Number.isFinite(x_px) || !Number.isFinite(y_px)) continue;
      const font_size_px = Number(r.font_size_px);
      const w_px = Number(r.w_px);
      const h_px = Number(r.h_px);
        const text = typeof r.text === "string" ? r.text.trim() : "";
        const box_locked = r.box_locked === true;
        const hidden = r.hidden === true;
        const custom =
          isCustomAddedMimicDocAiLayerKey(layer_key) || isCopySlotEditorLayerPositionKey(layer_key);
        const persistBox = box_locked || custom;
        const font_weight = Number(r.font_weight);
        const color_hex =
          typeof r.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color_hex.trim())
            ? r.color_hex.trim()
            : undefined;
        const font_family = typeof r.font_family === "string" ? r.font_family.trim() : undefined;
        parsed.push({
          layer_key,
          x_px: Math.round(x_px),
          y_px: Math.round(y_px),
          ...(Number.isFinite(font_size_px) && font_size_px > 0 ? { font_size_px: Math.round(font_size_px) } : {}),
          ...(persistBox && Number.isFinite(w_px) && w_px > 0 ? { w_px: Math.round(w_px) } : {}),
          ...(persistBox && Number.isFinite(h_px) && h_px > 0 ? { h_px: Math.round(h_px) } : {}),
          ...(text ? { text } : custom ? { text: "New text" } : {}),
          ...(Number.isFinite(font_weight) && font_weight >= 100 && font_weight <= 900
            ? { font_weight: Math.round(font_weight / 100) * 100 }
            : {}),
          ...(color_hex ? { color_hex } : {}),
          ...(font_family ? { font_family } : {}),
          ...(r.font_style_italic === true ? { font_style_italic: true } : {}),
          ...(persistBox ? { box_locked: true } : {}),
          ...(hidden ? { hidden: true } : {}),
        });
    }
    if (parsed.length > 0) out[slideKey] = parsed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function pickMimicDocAiLayerPositionsFromMimicV1(mimicV1: unknown): MimicDocAiLayerPositionsBySlide | null {
  const rec = asRecord(mimicV1);
  if (!rec) return null;
  return parseMimicDocAiLayerPositionsBySlide(rec.docai_layer_positions);
}

export function pickMimicDocAiLayerPositionsForSlide(
  mimicV1: unknown,
  slideIndex1Based: number
): MimicDocAiLayerPositionOverride[] | null {
  const all = pickMimicDocAiLayerPositionsFromMimicV1(mimicV1);
  if (!all) return null;
  const rows = all[String(slideIndex1Based)];
  return rows?.length ? rows : null;
}

/** True when reviewers saved any per-slide layout boxes on mimic_v1. */
export function mimicV1HasReviewerDocAiLayerPositions(mimicV1: unknown): boolean {
  const all = pickMimicDocAiLayerPositionsFromMimicV1(mimicV1);
  if (!all) return false;
  return Object.values(all).some((rows) => Array.isArray(rows) && rows.length > 0);
}

/** Drop junk custom layers and stale OCR copy text before template_bg inspect/reprint. */
export function sanitizeTemplateBgDocAiOverridesForInspect(
  overrides: MimicDocAiLayerPositionOverride[]
): MimicDocAiLayerPositionOverride[] {
  return overrides
    .filter((o) => {
      if (!isCustomAddedMimicDocAiLayerKey(o.layer_key)) return true;
      if (o.hidden) return false;
      const t = o.text?.trim();
      return Boolean(t && t !== "New text");
    })
    .map((o) => {
      if (isCustomAddedMimicDocAiLayerKey(o.layer_key)) return o;
      const { text: _text, ...rest } = o;
      return rest;
    });
}

/** Inspect/preview only — hidden markers are reprint-only; always show all OCR slots in editor. */
export function coerceTemplateBgInspectOverrides<T extends MimicDocAiLayerPositionLayer>(
  baseLayers: T[],
  overrides: MimicDocAiLayerPositionOverride[]
): MimicDocAiLayerPositionOverride[] {
  const sanitized = sanitizeTemplateBgDocAiOverridesForInspect(overrides).filter((o) => !o.hidden);
  if (!sanitized.length || !baseLayers.length) return sanitized;
  const visible = applyMimicDocAiLayerPositionOverrides(baseLayers, sanitized, {
    applySavedTextOnBaseLayers: false,
  });
  if (visible.length > 0) return sanitized;
  return sanitized.filter((o) => !o.hidden);
}

export function applyMimicDocAiLayerPositionOverrides<T extends MimicDocAiLayerPositionLayer>(
  layers: T[],
  overrides: MimicDocAiLayerPositionOverride[],
  opts?: { applySavedTextOnBaseLayers?: boolean }
): T[] {
  const applySavedTextOnBaseLayers = opts?.applySavedTextOnBaseLayers !== false;
  if (!overrides.length) return layers;
  const baseOverrides = overrides.filter((o) => !isReviewerPlacedDocAiLayerKey(o.layer_key));
  const customOverrides = overrides.filter(
    (o) => isReviewerPlacedDocAiLayerKey(o.layer_key) && !o.hidden
  );
  const byExactKey = new Map(baseOverrides.map((o) => [o.layer_key, o]));
  const byRefKey = new Map(baseOverrides.map((o) => [refKeyFromLayerPositionKey(o.layer_key), o]));
  const mapped = layers
    .filter((layer) => {
      const key = mimicDocAiLayerPositionKey(layer);
      const refKey = mimicDocAiLayerRefKey(layer);
      const o = byExactKey.get(key) ?? byRefKey.get(refKey);
      return !o?.hidden;
    })
    .map((layer) => {
      const key = mimicDocAiLayerPositionKey(layer);
      const refKey = mimicDocAiLayerRefKey(layer);
      const o = byExactKey.get(key) ?? byRefKey.get(refKey);
      if (!o) return layer;
      let next = patchMimicDocAiLayerPxPosition(layer, o.x_px, o.y_px);
      if (o.font_size_px != null && Number.isFinite(o.font_size_px) && o.font_size_px > 0) {
        next = patchMimicDocAiLayerFontSize(next, o.font_size_px);
      }
      if (o.font_weight != null && Number.isFinite(o.font_weight) && o.font_weight >= 100) {
        next = patchMimicDocAiLayerFontWeight(next, o.font_weight);
      }
      if (o.color_hex?.trim()) {
        next = patchMimicDocAiLayerColor(next, o.color_hex);
      }
      if (o.font_family?.trim()) {
        next = patchMimicDocAiLayerFontFamily(next, o.font_family);
      }
      if (o.font_style_italic === true) {
        next = patchMimicDocAiLayerFontStyle(next, true);
      } else if (o.font_style_italic === false) {
        next = patchMimicDocAiLayerFontStyle(next, false);
      }
      const explicitText = o.text?.trim() ?? "";
      if (
        explicitText &&
        (isCustomAddedMimicDocAiLayerKey(o.layer_key) || applySavedTextOnBaseLayers)
      ) {
        // Saved reviewer copy always wins on reprint for full-bleed / carousel_visual.
        // template_bg passes applySavedTextOnBaseLayers: false — copy stays on slide fields.
        next = patchMimicDocAiLayerText(next, explicitText);
      }
      const boxW = o.w_px ?? layer.w_px;
      const boxH = o.h_px ?? layer.h_px;
      if (
        boxW != null &&
        boxH != null &&
        Number.isFinite(boxW) &&
        Number.isFinite(boxH) &&
        boxW > 0 &&
        boxH > 0 &&
        (o.box_locked || (o.w_px != null && o.h_px != null))
      ) {
        next = patchMimicDocAiLayerSize(next, boxW, boxH);
      }
      return {
        ...next,
        skip_center_avoid: true,
        ...(o.box_locked ? { reviewer_box_locked: true } : {}),
      };
    });
  const added = customOverrides.map((o) => buildCustomMimicDocAiLayerFromOverride(o) as T);
  return [...mapped, ...added];
}

export function mergeMimicDocAiLayerPositionOverrides(
  existing: MimicDocAiLayerPositionsBySlide | null | undefined,
  slideIndex1Based: number,
  overrides: MimicDocAiLayerPositionOverride[]
): MimicDocAiLayerPositionsBySlide {
  const next: MimicDocAiLayerPositionsBySlide = { ...(existing ?? {}) };
  if (overrides.length === 0) {
    delete next[String(slideIndex1Based)];
  } else {
    next[String(slideIndex1Based)] = overrides;
  }
  return next;
}

export function layersToPositionOverrides(
  layers: MimicDocAiLayerPositionLayer[]
): MimicDocAiLayerPositionOverride[] {
  return layers.map((layer) => ({
    layer_key: mimicDocAiLayerPositionKey(layer),
    x_px: layer.x_px,
    y_px: layer.y_px,
  }));
}
