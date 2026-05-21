/** On-screen transcript length above which copy must be finalized before gpt-image-1 mimic. */
export const MIMIC_ON_SCREEN_TEXT_CHAR_THRESHOLD = 200;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function aestheticSlideRecords(entry: Record<string, unknown>): Record<string, unknown>[] {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const slides = aes.slides;
  if (!Array.isArray(slides)) return [];
  return slides.map((s) => asRecord(s)).filter((x): x is Record<string, unknown> => x != null);
}

export function slideOnScreenTextChars(slide: Record<string, unknown>): number {
  return String(
    slide.on_screen_text_transcript ?? slide.on_image_text ?? slide.body ?? slide.headline ?? ""
  ).trim().length;
}

export function referenceHasHeavyOnScreenText(slides: Record<string, unknown>[]): boolean {
  return slides.some((s) => slideOnScreenTextChars(s) >= MIMIC_ON_SCREEN_TEXT_CHAR_THRESHOLD);
}

export function isListicleLikeFormatPattern(formatPattern: string): boolean {
  const fp = formatPattern.toLowerCase().trim();
  if (!fp) return false;
  return fp === "listicle" || fp === "educational" || fp.includes("list");
}

/**
 * Listicle decks and text-heavy references must complete LLM copy (template overlay path)
 * before any gpt-image-1 visual mimic runs.
 */
export function requiresCopyBeforeVisualMimic(entry: Record<string, unknown>): boolean {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const formatPattern = String(aes.format_pattern ?? entry.format_pattern ?? "");
  const slides = aestheticSlideRecords(entry);

  if (isListicleLikeFormatPattern(formatPattern)) return true;
  if (referenceHasHeavyOnScreenText(slides)) return true;
  return false;
}

export function targetSlideCountFromReference(
  referenceFrameCount: number,
  guidelineEntry: Record<string, unknown>
): number | null {
  const analyzed = aestheticSlideRecords(guidelineEntry).length;
  const n = Math.max(referenceFrameCount, analyzed);
  return n > 0 ? n : null;
}
