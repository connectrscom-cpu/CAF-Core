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

const TEXT_OVERLAY_DECK_CUES = [
  "text over",
  "text overlay",
  "centered text",
  "overlay text",
  "layer text",
  "typography overlay",
  "on-screen text",
  "text centrally",
  "text on ",
];

function deckVisualSystem(entry: Record<string, unknown>): Record<string, unknown> | null {
  return (
    asRecord(entry.deck_visual_system) ??
    asRecord(asRecord(entry.aesthetic_analysis_json)?.deck_visual_system)
  );
}

/**
 * Vision pack rows often omit per-slide transcripts but still describe text-on-background decks
 * (e.g. "centered text over celestial backgrounds").
 */
export function isTextOverlayDeckFromGuideline(entry: Record<string, unknown>): boolean {
  const haystacks: string[] = [];
  const dvs = deckVisualSystem(entry);
  if (dvs) {
    for (const key of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const v = String(dvs[key] ?? "").trim();
      if (v) haystacks.push(v.toLowerCase());
    }
  }
  const consistency = String(entry.visual_consistency ?? "").trim();
  if (consistency) haystacks.push(consistency.toLowerCase());

  const blueprint = asRecord(entry.replication_blueprint);
  const steps = Array.isArray(blueprint?.steps_to_remake) ? blueprint!.steps_to_remake : [];
  for (const step of steps) {
    const t = String(step ?? "").trim();
    if (t) haystacks.push(t.toLowerCase());
  }

  const combined = haystacks.join(" ");
  if (!combined) return false;
  return TEXT_OVERLAY_DECK_CUES.some((cue) => combined.includes(cue));
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
  if (isTextOverlayDeckFromGuideline(entry)) return true;
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
