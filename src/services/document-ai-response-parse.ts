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

function bboxFromPoints(points: Array<{ x: number; y: number }>): BboxPct | null {
  if (points.length < 2) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (maxX <= minX || maxY <= minY) return null;
  return {
    x: clamp01(minX),
    y: clamp01(minY),
    w: clamp01(maxX - minX),
    h: clamp01(maxY - minY),
  };
}

function bboxFromPoly(
  poly: Record<string, unknown> | null,
  pageWidth: number | null,
  pageHeight: number | null
): BboxPct | null {
  if (!poly) return null;

  const norm = (poly.normalizedVertices ?? poly.normalized_vertices) as unknown;
  if (Array.isArray(norm) && norm.length >= 2) {
    const points = norm.map((v) => {
      const p = asRecord(v);
      return { x: Number(p?.x ?? 0), y: Number(p?.y ?? 0) };
    });
    return bboxFromPoints(points);
  }

  const verts = poly.vertices as unknown;
  if (
    Array.isArray(verts) &&
    verts.length >= 2 &&
    pageWidth != null &&
    pageHeight != null &&
    pageWidth > 0 &&
    pageHeight > 0
  ) {
    const points = verts.map((v) => {
      const p = asRecord(v);
      return {
        x: Number(p?.x ?? 0) / pageWidth,
        y: Number(p?.y ?? 0) / pageHeight,
      };
    });
    return bboxFromPoints(points);
  }

  return null;
}

function bboxFromLayout(
  layout: Record<string, unknown> | null,
  pageWidth: number | null,
  pageHeight: number | null
): BboxPct | null {
  if (!layout) return null;
  const poly = asRecord(layout.boundingPoly) ?? asRecord(layout.bounding_poly);
  return bboxFromPoly(poly, pageWidth, pageHeight);
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

function extractTextFromAnchor(fullText: string, layout: Record<string, unknown> | null): string {
  const anchor = asRecord(layout?.textAnchor) ?? asRecord(layout?.text_anchor);
  const inline = String(anchor?.content ?? "").trim();
  if (inline) return inline;

  const segments = anchor?.textSegments ?? anchor?.text_segments;
  if (!Array.isArray(segments) || segments.length === 0) return "";
  let slice = "";
  for (const seg of segments) {
    const s = asRecord(seg);
    if (!s) continue;
    const start = Number(s.startIndex ?? s.start_index ?? 0);
    const end = Number(s.endIndex ?? s.end_index ?? 0);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      slice += fullText.slice(start, end);
    }
  }
  return slice.trim();
}

type PageElementKey = "tokens" | "lines" | "paragraphs" | "blocks";

function parsePageElements(
  page: Record<string, unknown>,
  fullText: string,
  elementKey: PageElementKey,
  pageWidth: number | null,
  pageHeight: number | null
): ParsedToken[] {
  const layoutRec = asRecord(page.layout);
  const elements = page[elementKey] ?? layoutRec?.[elementKey];
  if (!Array.isArray(elements)) return [];

  const out: ParsedToken[] = [];
  for (const raw of elements) {
    const el = asRecord(raw);
    if (!el) continue;
    const layout = asRecord(el.layout);
    const bbox = bboxFromLayout(layout, pageWidth, pageHeight);
    if (!bbox) continue;

    const text =
      String(el.text ?? "").trim() ||
      extractTextFromAnchor(fullText, layout) ||
      extractTextFromAnchor(fullText, el);
    if (!text) continue;

    const styleRaw = asRecord(el.styleInfo) ?? asRecord(el.style_info);
    const conf = Number(el.confidence ?? layout?.confidence);
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

/** Prefer token-level geometry; fall back to lines then paragraphs. */
function parseTextElementsFromPage(
  page: Record<string, unknown>,
  fullText: string,
  pageWidth: number | null,
  pageHeight: number | null
): ParsedToken[] {
  for (const key of ["tokens", "lines", "paragraphs", "blocks"] as const) {
    const parsed = parsePageElements(page, fullText, key, pageWidth, pageHeight);
    if (parsed.length > 0) return parsed;
  }
  return [];
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
  doc: Record<string, unknown> | null | undefined,
  slideIndex: number
): CarouselDocumentAiSlideOcr {
  const safeDoc = doc && typeof doc === "object" ? doc : {};
  const pages = Array.isArray(safeDoc.pages) ? safeDoc.pages : [];
  const page = (pages[0] && asRecord(pages[0])) || null;
  const dim = page ? asRecord(page.dimension) : null;
  const width = dim ? Number(dim.width ?? dim.widthPixels ?? dim.width_pixels) : null;
  const height = dim ? Number(dim.height ?? dim.heightPixels ?? dim.height_pixels) : null;
  const pageWidth = width != null && Number.isFinite(width) && width > 0 ? width : null;
  const pageHeight = height != null && Number.isFinite(height) && height > 0 ? height : null;

  const fullTextDoc = String(safeDoc.text ?? "");
  const tokens = page ? parseTextElementsFromPage(page, fullTextDoc, pageWidth, pageHeight) : [];
  const text_layers = groupTokensIntoTextLayers(tokens);
  const full_text =
    fullTextDoc.trim() ||
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
    canvas_width_px: pageWidth,
    canvas_height_px: pageHeight,
    full_text,
    ocr_confidence_mean,
    text_layers,
    token_count: tokens.length,
  };
}
