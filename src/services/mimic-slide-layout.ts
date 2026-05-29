/**
 * Per-slide layout extraction from Nemotron vision (text blocks, safe zones).
 * Used to route text to HBS/CSS instead of image models.
 * Lives under `services/` so Review (`@caf-core-carousel`) can bundle it with typography helpers.
 */
import { slideOnScreenTextChars } from "../domain/mimic-text-heavy.js";

export interface MimicTextBlock {
  text: string;
  role: string | null;
  /** Normalized 0–1 box: left, top, width, height */
  x: number;
  y: number;
  w: number;
  h: number;
  align: string | null;
  font_size_px: number | null;
  font_weight: string | null;
  color_hex: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickNum(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pickBBoxNorm(rec: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const bboxNorm = asRecord(rec.bbox_norm);
  if (bboxNorm) {
    const x = pickNum(bboxNorm.x ?? bboxNorm.left);
    const y = pickNum(bboxNorm.y ?? bboxNorm.top);
    const w = pickNum(bboxNorm.w ?? bboxNorm.width);
    const h = pickNum(bboxNorm.h ?? bboxNorm.height);
    if (x != null && y != null && w != null && h != null) return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
  }
  const bbox = Array.isArray(rec.bbox) ? rec.bbox : Array.isArray(rec.bounding_box) ? rec.bounding_box : null;
  if (bbox && bbox.length >= 4) {
    const [a, b, c, d] = bbox.map((v) => Number(v));
    if (![a, b, c, d].every((v) => Number.isFinite(v))) return null;
    const maxVal = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    if (maxVal <= 1.05) {
      return { x: clamp01(a), y: clamp01(b), w: clamp01(c), h: clamp01(d) };
    }
    const canvasW = 1080;
    const canvasH = 1350;
    const x2 = Math.max(a, c);
    const y2 = Math.max(b, d);
    const x1 = Math.min(a, c);
    const y1 = Math.min(b, d);
    return {
      x: clamp01(x1 / canvasW),
      y: clamp01(y1 / canvasH),
      w: clamp01((x2 - x1) / canvasW),
      h: clamp01((y2 - y1) / canvasH),
    };
  }
  return null;
}

/** Parse Nemotron `text_blocks[]` (or legacy typography hints) into normalized blocks. */
export function parseMimicTextBlocks(raw: unknown): MimicTextBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MimicTextBlock[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = String(rec.text ?? rec.content ?? "").trim();
    if (!text) continue;
    const box = pickBBoxNorm(rec);
    if (!box) continue;
    const fontPx = pickNum(rec.font_size_px ?? rec.estimated_font_size_px ?? rec.font_size);
    const color = String(rec.color_hex ?? rec.color ?? "").trim();
    out.push({
      text,
      role: String(rec.role ?? rec.semantic_role ?? "").trim().toLowerCase() || null,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      align: String(rec.align ?? rec.alignment ?? rec.text_align ?? "").trim().toLowerCase() || null,
      font_size_px: fontPx != null && fontPx > 0 && fontPx < 400 ? Math.round(fontPx) : null,
      font_weight: String(rec.font_weight ?? rec.weight ?? "").trim().toLowerCase() || null,
      color_hex: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null,
    });
  }
  return out;
}

/** Any on-screen reference text → deterministic HBS overlay (never image-model typography). */
export function slidePreferHbsTextOverlay(slide: Record<string, unknown>): boolean {
  if (slideOnScreenTextChars(slide) > 0) return true;
  const blocks = parseMimicTextBlocks(slide.text_blocks);
  return blocks.some((b) => b.text.length > 0);
}

/** Infer flex placement from Nemotron text blocks or typography.text_placement. */
export function textPlacementFromSlide(slide: Record<string, unknown> | null): string {
  if (!slide) return "";
  const typography = asRecord(slide.typography);
  const placement = String(typography?.text_placement ?? "").trim().toLowerCase();
  if (placement) return placement;

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  if (blocks.length === 0) return "";

  const centers = blocks.map((b) => b.y + b.h / 2);
  const avg = centers.reduce((a, c) => a + c, 0) / centers.length;
  if (avg >= 0.62) return "bottom band";
  if (avg <= 0.38) return "top band";
  return "center band";
}

/** Qwen art-only prompt hint: reserve space where reference had text. */
export function buildArtOnlySafeZoneHint(slide: Record<string, unknown> | null | undefined): string {
  if (!slide) {
    return "Leave generous clean margins suitable for later HTML text overlay. Do not render any letters, numbers, logos, signs, captions, watermarks, symbols, or handwriting.";
  }

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  const placement = textPlacementFromSlide(slide);

  const parts: string[] = [
    "Do not render any letters, numbers, logos, signs, captions, watermarks, symbols, or handwriting.",
    "Output art/background only — all final copy will be added later via HTML/CSS overlay.",
  ];

  if (blocks.length > 0) {
    const minY = Math.min(...blocks.map((b) => b.y));
    const maxY = Math.max(...blocks.map((b) => b.y + b.h));
    if (maxY >= 0.55) {
      parts.push(
        `Leave the lower ${Math.round(Math.min(45, (1 - minY) * 100))}% of the frame clean, soft, and low-detail for white or light text overlay.`
      );
    } else if (minY <= 0.35) {
      parts.push("Leave the upper third clean and low-detail for headline overlay.");
    } else {
      parts.push("Leave a clear center band with low visual clutter for centered text overlay.");
    }
  } else if (/bottom|lower|footer|caption/.test(placement)) {
    parts.push("Leave the bottom 35% clean, soft gradient, low detail, suitable for text overlay.");
  } else if (/top|upper|header/.test(placement)) {
    parts.push("Leave the top 30% clean and low-detail for headline overlay.");
  } else if (/center|middle|band|stack/.test(placement)) {
    parts.push("Leave a clear center band with low clutter for centered text overlay.");
  } else {
    parts.push("Leave generous clean margins suitable for later HTML text overlay.");
  }

  return parts.join(" ");
}
