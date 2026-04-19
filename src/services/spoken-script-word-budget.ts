import type { AppConfig } from "../config.js";

/** Token count for enforcement (whitespace-separated words). */
export function countWords(script: string): number {
  return script.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Maps VIDEO_TARGET_DURATION_* and SCENE_VO_WORDS_PER_MINUTE to min/max spoken word budgets for HeyGen
 * (no API duration field on avatar v3 — runtime ≈ TTS length).
 */
export function heygenSpokenScriptWordBoundsFromConfig(config: AppConfig): { minWords: number; maxWords: number } {
  const wpm = config.SCENE_VO_WORDS_PER_MINUTE;
  const loSec = Math.min(config.VIDEO_TARGET_DURATION_MIN_SEC, config.VIDEO_TARGET_DURATION_MAX_SEC);
  const hiSec = Math.max(config.VIDEO_TARGET_DURATION_MIN_SEC, config.VIDEO_TARGET_DURATION_MAX_SEC);
  const minWords = Math.max(1, Math.ceil((loSec * wpm) / 60));
  const maxWords = Math.max(minWords, Math.ceil((hiSec * wpm) / 60));
  return { minWords, maxWords };
}

export function fitSpokenScriptToWordBudget(
  script: string,
  _clipDursSec: number[],
  maxWords: number
): { script: string; trimmed: boolean; wordsBefore: number; wordsAfter: number } {
  const words = script.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const wordsBefore = words.length;
  if (words.length <= maxWords) {
    return { script, trimmed: false, wordsBefore, wordsAfter: words.length };
  }
  const cut = words.slice(0, maxWords).join(" ");
  return { script: cut, trimmed: true, wordsBefore, wordsAfter: maxWords };
}
