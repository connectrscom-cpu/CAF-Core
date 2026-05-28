/** On-screen transcript length above which copy must be finalized before bg extract + HBS overlay. */
export const MIMIC_ON_SCREEN_TEXT_CHAR_THRESHOLD = 200;

/** Slides at or below this length are treated as short punchy copy (whole-slide visual mimic path). */
export const MIMIC_SHORT_COPY_CHAR_THRESHOLD = 120;

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
  return fp === "listicle" || fp.includes("list");
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

const REPEATED_TEMPLATE_CUES = [
  "similar layout",
  "repeated template",
  "same background",
  "same frame",
  "consistent template",
  "uniform layout",
  "same layout",
  "uniform backdrop",
  "shared backdrop",
  "same backdrop",
  "shared background",
  "text on template",
  "text-on-template",
];

const VISUAL_LED_DECK_CUES = [
  "photo",
  "cinematic",
  "full-bleed",
  "full bleed",
  "illustration",
  "artwork",
  "graphic",
  "imagery",
  "visual storytelling",
  "high-impact visual",
];

function formatPatternFromEntry(entry: Record<string, unknown>): string {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  return String(aes.format_pattern ?? entry.format_pattern ?? "").trim();
}

function pickMimicEvaluationRecord(entry: Record<string, unknown>): Record<string, unknown> | null {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  return asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
}

/** Nemotron `mimic_evaluation` on insight or pack entry — strongest template signal. */
export function nemotronSuggestsTextOnTemplate(entry: Record<string, unknown>): boolean {
  const eval_ = pickMimicEvaluationRecord(entry);
  if (!eval_) return false;
  const mode = String(eval_.recommended_mode ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (mode === "text_on_template") return true;
  const tc = String(eval_.template_consistency ?? "")
    .trim()
    .toLowerCase();
  const bgr = String(eval_.background_replicability ?? "")
    .trim()
    .toLowerCase();
  if (tc === "uniform" && bgr !== "low") return true;
  return false;
}

function deckHaystackForCues(entry: Record<string, unknown>): string {
  const haystacks: string[] = [];
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const dvs = deckVisualSystem(entry);
  if (dvs) {
    for (const key of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const v = String(dvs[key] ?? "").trim();
      if (v) haystacks.push(v.toLowerCase());
    }
  }
  const consistency = String(entry.visual_consistency ?? aes.visual_consistency ?? "").trim();
  if (consistency) haystacks.push(consistency.toLowerCase());
  const mimicEval = pickMimicEvaluationRecord(entry);
  if (mimicEval) {
    for (const key of ["mode_reason", "background_description"] as const) {
      const v = String(mimicEval[key] ?? "").trim();
      if (v) haystacks.push(v.toLowerCase());
    }
  }
  const blueprint = asRecord(entry.replication_blueprint);
  const steps = Array.isArray(blueprint?.steps_to_remake) ? blueprint!.steps_to_remake : [];
  for (const step of steps) {
    const t = String(step ?? "").trim();
    if (t) haystacks.push(t.toLowerCase());
  }
  return haystacks.join(" ");
}

export function deckHasShortCopyThroughout(slides: Record<string, unknown>[]): boolean {
  if (slides.length === 0) return false;
  return slides.every((s) => slideOnScreenTextChars(s) <= MIMIC_SHORT_COPY_CHAR_THRESHOLD);
}

export function isVisualLedSlide(slide: Record<string, unknown>): boolean {
  const role = String(slide.image_or_photo_role ?? "").toLowerCase();
  const density = String(slide.text_density ?? "").toLowerCase();
  if (role && role !== "none") return true;
  if (density === "low") return true;
  return false;
}

export function hasVisualLedDeckCues(entry: Record<string, unknown>): boolean {
  const hay = deckHaystackForCues(entry);
  if (!hay) return false;
  return VISUAL_LED_DECK_CUES.some((cue) => hay.includes(cue));
}

/**
 * Image-led carousel with short on-slide sentences — replicate the **whole slide** (style + layout),
 * twist wording only. Not the background-extract + HBS path.
 */
export function isVisualLedShortCopyDeck(entry: Record<string, unknown>): boolean {
  const formatPattern = formatPatternFromEntry(entry);
  if (isListicleLikeFormatPattern(formatPattern)) return false;

  const slides = aestheticSlideRecords(entry);
  if (slides.length === 0) return false;
  if (referenceHasHeavyOnScreenText(slides)) return false;
  if (!deckHasShortCopyThroughout(slides)) return false;

  const anyVisualSlide = slides.some(isVisualLedSlide);
  return anyVisualSlide || hasVisualLedDeckCues(entry);
}

/** Listicles and text-overlay decks share one background plate (frame 1) across all output slides. */
export function deckUsesUnifiedBackgroundPlate(entry: Record<string, unknown>): boolean {
  const formatPattern = formatPatternFromEntry(entry);
  if (isListicleLikeFormatPattern(formatPattern)) return true;
  if (isTextOverlayDeckFromGuideline(entry)) return true;
  const hay = deckHaystackForCues(entry);
  if (hay && REPEATED_TEMPLATE_CUES.some((cue) => hay.includes(cue))) return true;
  return false;
}

export function deckUsesRepeatedVisualTemplate(entry: Record<string, unknown>): boolean {
  return deckUsesUnifiedBackgroundPlate(entry);
}

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
  if (nemotronSuggestsTextOnTemplate(entry)) return true;

  const haystacks: string[] = [];
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const dvs = deckVisualSystem(entry);
  if (dvs) {
    for (const key of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const v = String(dvs[key] ?? "").trim();
      if (v) haystacks.push(v.toLowerCase());
    }
  }
  const consistency = String(entry.visual_consistency ?? aes.visual_consistency ?? "").trim();
  if (consistency) haystacks.push(consistency.toLowerCase());

  const blueprint = asRecord(entry.replication_blueprint) ?? asRecord(aes.replication_blueprint);
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
 * Listicle / text-overlay decks → LLM copy first, then background plate + HBS overlay.
 * Visual-led short-copy decks → per-slide full mimic (same style, twisted wording).
 */
export function requiresCopyBeforeVisualMimic(entry: Record<string, unknown>): boolean {
  if (nemotronSuggestsTextOnTemplate(entry)) return true;
  if (isVisualLedShortCopyDeck(entry)) return false;

  const formatPattern = formatPatternFromEntry(entry);
  const slides = aestheticSlideRecords(entry);

  if (isListicleLikeFormatPattern(formatPattern)) return true;
  if (referenceHasHeavyOnScreenText(slides)) return true;
  if (isTextOverlayDeckFromGuideline(entry)) return true;
  if (deckUsesUnifiedBackgroundPlate(entry)) return true;
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
