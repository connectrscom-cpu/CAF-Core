import { extractSpokenScriptText } from "../services/video-gen-fields.js";

export interface VideoScriptRuntimeMismatch {
  estimated_runtime_seconds: number;
  implied_words_at_wpm: number;
  actual_word_count: number;
  words_per_minute: number;
  message: string;
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * Non-blocking QC advisory when `estimated_runtime_seconds` implies far more speech than the script contains.
 */
export function detectVideoScriptRuntimeMismatch(
  gen: Record<string, unknown>,
  opts?: { wordsPerMinute?: number; minGapRatio?: number }
): VideoScriptRuntimeMismatch | null {
  const wpm = opts?.wordsPerMinute ?? 150;
  const minGapRatio = opts?.minGapRatio ?? 0.35;

  const estRaw = gen.estimated_runtime_seconds;
  const estimated =
    typeof estRaw === "number" && Number.isFinite(estRaw) && estRaw > 0
      ? estRaw
      : typeof estRaw === "string" && estRaw.trim()
        ? Number(estRaw)
        : NaN;
  if (!Number.isFinite(estimated) || estimated <= 0) return null;

  const spoken = extractSpokenScriptText(gen, 1);
  const actualWords = countWords(spoken);
  if (actualWords < 8) return null;

  const impliedWords = Math.round((estimated * wpm) / 60);
  if (impliedWords <= actualWords) return null;

  const gapRatio = (impliedWords - actualWords) / impliedWords;
  if (gapRatio < minGapRatio) return null;

  return {
    estimated_runtime_seconds: estimated,
    implied_words_at_wpm: impliedWords,
    actual_word_count: actualWords,
    words_per_minute: wpm,
    message: `estimated_runtime_seconds is ${estimated}s (~${impliedWords} words at ${wpm} wpm) but spoken script has ${actualWords} words — render will likely be much shorter`,
  };
}
