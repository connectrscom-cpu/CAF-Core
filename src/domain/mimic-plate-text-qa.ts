/**
 * Detect readable text accidentally left on mimic background plates (template_bg extract).
 */
import { isLikelyOcrGarbageText } from "./mimic-ocr-garbage.js";

export class MimicPlateTextPollutionError extends Error {
  readonly taskId: string;
  readonly slideIndex: number;
  readonly detectedText: string[];
  readonly method: string;

  constructor(args: {
    taskId: string;
    slideIndex: number;
    detectedText: string[];
    method: string;
    detail?: string;
  }) {
    const preview = args.detectedText.slice(0, 4).join(" | ");
    super(
      `Mimic background plate slide ${args.slideIndex} for ${args.taskId} failed text-free QA ` +
        `(${args.method}${preview ? `: ${preview}` : ""}${args.detail ? ` — ${args.detail}` : ""})`
    );
    this.name = "MimicPlateTextPollutionError";
    this.taskId = args.taskId;
    this.slideIndex = args.slideIndex;
    this.detectedText = args.detectedText;
    this.method = args.method;
  }
}

const NOISE_TOKEN_RE =
  /\b\d{1,3}[-–—]\d{1,3}(?:\.\d+)?%?\b|\b\d{1,2}:\d{2}\b|(?:^|\s)[A-Z]{3,}(?:\s+[A-Z]{3,}){2,}/;

const LAYOUT_COORD_OCR_RE =
  /\d{1,3}\s*[-–—]\s*\d{1,3}\s*%|\d{1,2}\s*%\s*[*×xX]\s*\d|%\s*(?:width|wicthe|witfx|wint)/i;

/** OCR noise from safe-zone % coordinates leaking into generated plates or misread from texture. */
export function isLayoutCoordinateOcrNoise(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  if (LAYOUT_COORD_OCR_RE.test(t)) return true;
  const percentTokens = t.match(/\d{1,3}\s*[-–—]\s*\d{1,3}\s*%?/g) ?? [];
  if (percentTokens.length >= 2) return true;
  const digits = (t.match(/\d/g) ?? []).length;
  const longWords = t.split(/\s+/).filter((w) => /^[a-zA-Z]{5,}$/.test(w.replace(/[^\w]/g, "")));
  if (digits >= 5 && longWords.length <= 1) return true;
  return false;
}

/** True when OCR / heuristic output looks like copy that should not remain on a clean plate. */
export function isSuspiciousPlateText(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length < 2) return false;
  if (/^@[\w.]{2,}$/.test(t.replace(/\s+/g, ""))) return false;
  if (isLikelyOcrGarbageText(t)) return true;
  if (NOISE_TOKEN_RE.test(t)) return true;
  const alpha = (t.match(/[a-zA-Z]/g) ?? []).length;
  const digits = (t.match(/\d/g) ?? []).length;
  if (digits >= 3 && alpha >= 2 && t.length <= 48) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => w.length <= 3 && /[A-Za-z]/.test(w))) return true;
  if (/(?:^|\s)[\p{Lu}À-ÿ]{4,}(?:\s+[\p{Lu}À-ÿ]{4,})+/u.test(t)) return true;
  return false;
}

/** True when OCR output indicates text/UI still baked into a background plate (not benign phantom noise). */
export function isPollutingPlateText(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length < 3 || !/[a-zA-Z0-9]/.test(t)) return false;
  if (/^@[\w.]{2,}$/.test(t.replace(/\s+/g, ""))) return false;
  if (isLayoutCoordinateOcrNoise(t)) return false;
  if (isLikelyOcrGarbageText(t)) return false;
  if (isSuspiciousPlateText(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  const longWords = words.filter((w) => /^[a-zA-Z]{4,}$/.test(w.replace(/[^\w]/g, "")));
  if (words.length >= 2 && longWords.length >= 2) return true;
  if (words.length >= 3) return true;

  const alpha = (t.match(/[a-zA-Z]/g) ?? []).length;
  if (alpha / t.length > 0.65 && t.length >= 15) return true;
  return false;
}

export function plateTextQaVerdict(detectedLines: string[]): {
  passed: boolean;
  suspicious: string[];
} {
  const suspicious = detectedLines.map((l) => l.trim()).filter(Boolean).filter(isPollutingPlateText);
  return { passed: suspicious.length === 0, suspicious };
}
