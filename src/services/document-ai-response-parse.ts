/**
 * Parse Document AI Enterprise OCR `Document` JSON into CAF carousel OCR slices.
 */
import type {
  BboxPct,
  CarouselDetectedTextLayer,
  CarouselDocumentAiSlideOcr,
  CarouselTextLayerFont,
} from "../domain/carousel-slide-analysis.js";
import { CAROUSEL_REFERENCE_OCR_SCHEMA } from "../domain/carousel-slide-analysis.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgbaToHex(color: Record<string, unknown> | null): string | null {
  if (!color) return null;
  const r = Math.round(Number(color.red ?? 0) * 255);
  const g = Math.round(Number(color.green ?? 0) * 255);
  const b = Math.round(Number(color.blue ?? 0) * 255);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function bboxFromLayout(layout: Record<string, unknown> | null): BboxPct | null {
  if (!layout) return null;
  const poly = asRecord(layout.boundingPoly) ?? asRecord(layout.bounding_poly);
  const norm = (poly?.normalizedVertices ?? poly?.normalized_vertices) as unknown;
  const verts = Array.isArray(norm) ? norm : null;
  if (!verts || verts.length < 2) {
    const box = verts?.[0] ? null : null;
    void box;
    return null;
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const v of verts) {
    const p = asRecord(v);
    if (!p) continue;
    const x = Number(p.x ?? 0);
    const y = Number(p.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX <= minX || maxY <= minY) return null;
  return {
    x: clamp01(minX),
    y: clamp01(minY),
    w: clamp01(maxX - minX),
    h: clamp01(maxY - minY),
  };
}

function styleFromToken(style: Record<string, unknown> | null): CarouselTextLayerFont {
  const textColor = asRecord(style?.textColor) ?? asRecord(style?.text_color);
  const bgColor = asRecord(style?.backgroundColor) ?? asRecord(style?.background_color);
  const pixelSize = Number(style?.pixelFontSize ?? style?.pixel_font_size);
  const fontSize = Number(style?.fontSize ?? style?.font_size);
  const sizePx =
    Number.isFinite(pixelSize) && pixelSize > 0
      ? Math.round(pixelSize)
      : Number.isFinite(fontSize) && fontSize > 0
        ? Math.round(fontSize * 4)
        : null;
  return {
    family_detected: String(style?.fontType ?? style?.font_type ?? "").trim() || null,
    size_px: sizePx,
    weight: Number.isFinite(Number(style?.fontWeight ?? style?.font_weight))
      ? Math.round(Number(style?.fontWeight ?? style?.font_weight))
      : null,
    bold: style?.bold === true ? true : style?.bold === false ? false : null,
    italic: style?.italic === true ? true : style?.italic === false ? false : null,
    underline: style?.underline === true ? true : style?.underline === false ? false : null,
    color_hex: rgbaToHex(textColor),
    background_color_hex: rgbaToHex(bgColor),
    letter_spacing: String(style?.letterSpacing ?? style?.letter_spacing ?? "").trim() || null,
  };
}

interface ParsedToken {
  text: string;
  confidence: number | null;
  bbox: BboxPct;
  font: CarouselTextLayerFont;
  centerY: number;
  centerX: number;
}

function parseTokensFromPage(page: Record<string, unknown>): ParsedToken[] {
  const layoutRec = asRecord(page.layout);
  const tokens = page.tokens ?? layoutRec?.tokens;
  if (!Array.isArray(tokens)) return [];
  const out: ParsedToken[] = [];
  for (const raw of tokens) {
    const t = asRecord(raw);
    if (!t) continue;
    const layout = asRecord(t.layout);
    const bbox = bboxFromLayout(layout);
    if (!bbox) continue;
    const textAnchor = layout ? asRecord(layout.textAnchor) ?? asRecord(layout.text_anchor) : null;
    const text =
      String(textAnchor?.content ?? t.text ?? "").trim() || extractTextFromAnchor(page, layout);
    if (!text) continue;
    const styleRaw = asRecord(t.styleInfo) ?? asRecord(t.style_info);
    const conf = Number(t.confidence ?? layout?.confidence);
    out.push({
      text,
      confidence: Number.isFinite(conf) ? conf : null,
      bbox,
      font: styleFromToken(styleRaw),
      centerY: bbox.y + bbox.h / 2,
      centerX: bbox.x + bbox.w / 2,
    });
  }
  return out;
}

function extractTextFromAnchor(page: Record<string, unknown>, layout: Record<string, unknown> | null): string {
  const anchor = asRecord(layout?.textAnchor) ?? asRecord(layout?.text_anchor);
  const segments = anchor?.textSegments ?? anchor?.text_segments;
  if (!Array.isArray(segments) || segments.length === 0) return "";
  const full = String(page.text ?? "");
  let slice = "";
  for (const seg of segments) {
    const s = asRecord(seg);
    if (!s) continue;
    const start = Number(s.startIndex ?? s.start_index ?? 0);
    const end = Number(s.endIndex ?? s.end_index ?? 0);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      slice += full.slice(start, end);
    }
  }
  return slice.trim();
}

function inferAlignment(tokens: ParsedToken[]): "left" | "center" | "right" | "unknown" {
  if (tokens.length === 0) return "unknown";
  const xs = tokens.map((t) => t.centerX);
  const spread = Math.max(...xs) - Math.min(...xs);
  if (spread < 0.08) {
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (avg < 0.38) return "left";
    if (avg > 0.62) return "right";
    return "center";
  }
  return "unknown";
}

/** Group tokens into line-level text layers by vertical proximity. */
export function groupTokensIntoTextLayers(tokens: ParsedToken[]): CarouselDetectedTextLayer[] {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  const lines: ParsedToken[][] = [];
  for (const tok of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([tok]);
      continue;
    }
    const refY = last[0]!.centerY;
    const lineH = Math.max(...last.map((t) => t.bbox.h));
    if (Math.abs(tok.centerY - refY) <= Math.max(0.02, lineH * 0.6)) {
      last.push(tok);
    } else {
      lines.push([tok]);
    }
  }

  const layers: CarouselDetectedTextLayer[] = [];
  let order = 0;
  for (const line of lines) {
    order++;
    const text = line
      .sort((a, b) => a.centerX - b.centerX)
      .map((t) => t.text)
      .join(" ")
      .trim();
    if (!text) continue;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    let confSum = 0;
    let confN = 0;
    for (const t of line) {
      minX = Math.min(minX, t.bbox.x);
      minY = Math.min(minY, t.bbox.y);
      maxX = Math.max(maxX, t.bbox.x + t.bbox.w);
      maxY = Math.max(maxY, t.bbox.y + t.bbox.h);
      if (t.confidence != null) {
        confSum += t.confidence;
        confN++;
      }
    }
    const sizes = line.map((t) => t.font.size_px).filter((n): n is number => n != null && n > 0);
    const weights = line.map((t) => t.font.weight).filter((n): n is number => n != null);
    const primary = line[0]!;
    layers.push({
      layer_index: order,
      text,
      bbox_pct: {
        x: clamp01(minX),
        y: clamp01(minY),
        w: clamp01(maxX - minX),
        h: clamp01(maxY - minY),
      },
      alignment: inferAlignment(line),
      font: {
        ...primary.font,
        size_px: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : primary.font.size_px,
        weight: weights.length ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length) : primary.font.weight,
        bold: line.some((t) => t.font.bold) ? true : primary.font.bold,
      },
      reading_order: order,
      confidence: confN > 0 ? confSum / confN : null,
      source: "document_ai",
    });
  }
  return layers;
}

export function parseDocumentAiResponseToSlideOcr(
  doc: Record<string, unknown>,
  slideIndex: number
): CarouselDocumentAiSlideOcr {
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const page = (pages[0] && asRecord(pages[0])) || null;
  const dim = page ? asRecord(page.dimension) : null;
  const width = dim ? Number(dim.width ?? dim.widthPixels) : null;
  const height = dim ? Number(dim.height ?? dim.heightPixels) : null;

  const tokens = page ? parseTokensFromPage(page) : [];
  const text_layers = groupTokensIntoTextLayers(tokens);
  const full_text =
    String(doc.text ?? "").trim() ||
    text_layers
      .map((l) => l.text)
      .join("\n")
      .trim();
  const confs = text_layers.map((l) => l.confidence).filter((c): c is number => c != null);
  const ocr_confidence_mean =
    confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  return {
    schema_version: CAROUSEL_REFERENCE_OCR_SCHEMA,
    slide_index: slideIndex,
    canvas_width_px: width != null && Number.isFinite(width) && width > 0 ? width : null,
    canvas_height_px: height != null && Number.isFinite(height) && height > 0 ? height : null,
    full_text,
    ocr_confidence_mean,
    text_layers,
    token_count: tokens.length,
  };
}
