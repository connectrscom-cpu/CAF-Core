/**
 * Heuristics for Document AI / Nemotron OCR noise that should not appear as on-slide copy.
 */

const LATEXish_RE =
  /\\(?:neg|cap|sum|frac|sqrt|left|right|cdot|times|alpha|beta|gamma|theta|pi)\b|[{}^_=]|\\[a-zA-Z]{2,}/;
const MATH_EXPR_RE =
  /\d+\s*[*×/]\s*\d+|m\s*=\s*x\s*[+\-]|P\s*\(\s*[A-Z]\s*\)\s*=|[+\-*/^=]{2,}|\b\d{3,}\s*[*×]\s*\d+/;
const HIGH_SYMBOL_RATIO_RE = /[^\w\s@#.,!?'"():;\-–—…]/g;

/** True when text is almost certainly OCR/layout noise, not intentional carousel copy. */
export function isLikelyOcrGarbageText(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  if (/^@[\w.]{2,30}$/.test(t.replace(/\s+/g, ""))) return false;
  if (t.length <= 2 && /[^\w@]/.test(t)) return true;

  if (LATEXish_RE.test(t)) return true;
  if (MATH_EXPR_RE.test(t)) return true;

  const symbols = t.match(HIGH_SYMBOL_RATIO_RE) ?? [];
  const alpha = (t.match(/[a-zA-Z]/g) ?? []).length;
  const digits = (t.match(/\d/g) ?? []).length;
  if (symbols.length >= 3 && symbols.length > alpha) return true;
  if (digits >= 4 && alpha <= 2 && symbols.length >= 1) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const weird = words.filter((w) => {
      const core = w.replace(/^["'([{]+|["')\]}.,!?;:]+$/g, "");
      return core.length > 0 && /^\W|\W$/.test(w) && !/^[@#]/.test(w) && core.length < 3;
    }).length;
    if (weird >= Math.ceil(words.length * 0.45)) return true;
  }

  return false;
}

/** True when per-box copy looks fragmented or contaminated — candidate for coherence LLM pass. */
export function slideCopyBlocksNeedCoherence(blockTexts: string[]): boolean {
  const lines = blockTexts.map((b) => String(b ?? "").trim()).filter(Boolean);
  if (lines.length === 0) return false;
  if (lines.some(isLikelyOcrGarbageText)) return true;
  if (lines.length < 2) return false;

  const shortOpen = lines.filter(
    (l) => l.length < 32 && !/[.!?]["']?\s*$/.test(l) && !looksLikeInstagramHandle(l)
  );
  if (shortOpen.length >= 2 && shortOpen.length >= Math.ceil(lines.length * 0.5)) return true;

  const joined = lines.join(" ");
  if (joined.length >= 24 && shortOpen.length >= 2) {
    const endsMidPhrase = lines.some((l, i) => i < lines.length - 1 && /\b(a|an|the|to|for|of|is|are|be)\s*$/i.test(l));
    if (endsMidPhrase) return true;
  }

  return false;
}

function looksLikeInstagramHandle(text: string): boolean {
  return /^@[\w.]{2,30}$/.test(text.replace(/\s+/g, ""));
}
