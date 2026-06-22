import { coerceSlideBodyCopyText } from "./slide-copy-lines.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const OBJECT_STRING = "[object Object]";

/** Unwrap nested LLM shapes (object/array) into plain overlay copy text. */
export function coerceMimicOverlayCopyText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) {
    const parts = raw.map((item) => coerceMimicOverlayCopyText(item)).filter(Boolean);
    return parts.join("\n");
  }
  const rec = asRecord(raw);
  if (rec) {
    for (const key of ["text", "content", "value", "copy", "line", "body"]) {
      if (key in rec) {
        const nested = coerceMimicOverlayCopyText(rec[key]);
        if (nested.trim()) return nested;
      }
    }
    return "";
  }
  const s = String(raw);
  return s === OBJECT_STRING ? "" : s;
}

/**
 * Sanitize on-slide mimic copy before overlay render / LLM budget enforcement.
 */
export function sanitizeMimicOverlayCopyText(raw: unknown): string {
  let t = coerceMimicOverlayCopyText(raw);
  if (!t.trim()) return "";
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\/?[^>]+>/g, "");
  t = t.replace(/\u00a0/g, " ");
  return coerceSlideBodyCopyText(
    t
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line, i, arr) => line.length > 0 || (i > 0 && i < arr.length - 1))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Ordered on-slide copy from reviewer body or explicit per-box lines. */
export function resolveMimicSlideEditableCopyLines(slide: Record<string, unknown>): string[] {
  const onSlide = slide.on_slide_lines;
  if (Array.isArray(onSlide) && onSlide.length > 0) {
    return onSlide.map((line) => sanitizeMimicOverlayCopyText(line)).filter(Boolean);
  }
  const body = sanitizeMimicOverlayCopyText(
    slide.body ?? slide.subtitle ?? slide.cta_text ?? ""
  );
  if (!body) return [];
  return body.split("\n").map((l) => l.trim()).filter(Boolean);
}

function normalizeCopyLineForCompare(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when editable body/lines no longer match persisted `text_blocks[]` OCR text. */
export function mimicSlideEditableCopyDiffersFromTextBlocks(
  slide: Record<string, unknown>,
  editableLines?: string[]
): boolean {
  const lines = editableLines ?? resolveMimicSlideEditableCopyLines(slide);
  if (lines.length === 0) return false;
  const blocks = slide.text_blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return true;
  const blockTexts: string[] = [];
  for (const item of blocks) {
    const rec = asRecord(item);
    if (!rec) continue;
    const t = sanitizeMimicOverlayCopyText(rec.text);
    if (t) blockTexts.push(t);
  }
  if (lines.length !== blockTexts.length) return true;
  for (let i = 0; i < lines.length; i++) {
    if (normalizeCopyLineForCompare(lines[i]!) !== normalizeCopyLineForCompare(blockTexts[i]!)) {
      return true;
    }
  }
  return false;
}
