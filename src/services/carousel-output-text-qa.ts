/**
 * Deterministic text QA: compare Document AI output vs intended carousel copy.
 */
import type {
  BboxPct,
  CarouselDocumentAiSlideOcr,
  CarouselOutputIntended,
  CarouselOutputTextQa,
} from "../domain/carousel-slide-analysis.js";

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/['']/g, "'")
    .trim();
}

function fuzzyContains(haystack: string, needle: string): boolean {
  const h = normalizeForMatch(haystack);
  const n = normalizeForMatch(needle);
  if (!n) return true;
  if (h.includes(n)) return true;
  const words = n.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return h.includes(n);
  const hit = words.filter((w) => h.includes(w)).length;
  return hit >= Math.ceil(words.length * 0.7);
}

function bboxIou(a: BboxPct, b: BboxPct): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function contrastRatio(textHex: string | null, bgHex: string | null): number | null {
  if (!textHex || !bgHex) return null;
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(n.slice(0, 2), 16) / 255;
    const g = parseInt(n.slice(2, 4), 16) / 255;
    const b = parseInt(n.slice(4, 6), 16) / 255;
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  try {
    const l1 = parse(textHex);
    const l2 = parse(bgHex);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch {
    return null;
  }
}

export function compareCarouselOutputText(
  intended: CarouselOutputIntended,
  detected: CarouselDocumentAiSlideOcr
): CarouselOutputTextQa {
  const detectedFull = detected.full_text;
  const expectedStrings = intended.text_layers.map((l) => l.text).filter(Boolean);
  const missing_text: string[] = [];
  for (const exp of expectedStrings) {
    if (!fuzzyContains(detectedFull, exp)) missing_text.push(exp);
  }

  const expectedNorm = new Set(expectedStrings.map(normalizeForMatch));
  const extra_text: string[] = [];
  for (const layer of detected.text_layers) {
    const t = layer.text.trim();
    if (!t) continue;
    let matched = false;
    for (const exp of expectedStrings) {
      if (fuzzyContains(t, exp) || fuzzyContains(exp, t)) {
        matched = true;
        break;
      }
    }
    if (!matched && !fuzzyContains(expectedStrings.join(" "), t)) {
      extra_text.push(t);
    }
  }

  const forbidden_text_hits: string[] = [];
  for (const f of intended.forbidden_text) {
    if (fuzzyContains(detectedFull, f)) forbidden_text_hits.push(f);
  }

  const position_drift = intended.text_layers
    .filter((l) => l.bbox_pct && l.text)
    .map((l) => {
      const det =
        detected.text_layers.find((d) => fuzzyContains(d.text, l.text) || fuzzyContains(l.text, d.text)) ??
        detected.text_layers[0];
      const detBox = det?.bbox_pct ?? null;
      const iou = l.bbox_pct && detBox ? bboxIou(l.bbox_pct, detBox) : null;
      return {
        layer_id: l.id,
        expected_bbox_pct: l.bbox_pct,
        detected_bbox_pct: detBox,
        iou,
      };
    });

  let contrast_pass: boolean | null = null;
  for (const layer of detected.text_layers) {
    const ratio = contrastRatio(layer.font.color_hex, layer.font.background_color_hex);
    if (ratio != null) {
      const pass = ratio >= 4.5;
      if (contrast_pass === null) contrast_pass = pass;
      else contrast_pass = contrast_pass && pass;
    }
  }

  const margin = intended.safe_margin_pct;
  let within_safe_margins: boolean | null = null;
  for (const layer of detected.text_layers) {
    const b = layer.bbox_pct;
    const ok =
      b.x >= margin &&
      b.y >= margin &&
      b.x + b.w <= 1 - margin &&
      b.y + b.h <= 1 - margin;
    if (within_safe_margins === null) within_safe_margins = ok;
    else within_safe_margins = within_safe_margins && ok;
  }

  const text_in_art_only_zone =
    intended.art_only_image && detected.text_layers.some((l) => l.text.trim().length > 2);

  const expected_text_present = missing_text.length === 0 && expectedStrings.length > 0;
  const text_check_pass =
    expected_text_present &&
    forbidden_text_hits.length === 0 &&
    !text_in_art_only_zone &&
    extra_text.length === 0;

  return {
    expected_text_present,
    missing_text,
    extra_text,
    forbidden_text_hits,
    text_in_art_only_zone,
    position_drift,
    contrast_pass,
    within_safe_margins,
    text_check_pass,
  };
}
