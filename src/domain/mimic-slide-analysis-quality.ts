/**
 * Detect when Nemotron / SIL slide analysis is too thin for Why Mimic reinterpretation
 * or analysis_t2i image generation. Callers fall back to reference_edit when a usable
 * archived frame exists.
 */
import type { MimicPayloadV1 } from "./mimic-payload.js";
import { sourceSlideIndexForMimicOutput } from "./mimic-output-slide-index.js";
import type { SlideIntelligenceBundleV1 } from "./slide-intelligence.js";
import type { WhyMimicFluxSlideInput } from "./why-mimic-execution.js";

/** Default minimum length for per-slide `why_it_works` (~3 sentences). Override via `SIL_WHY_IT_WORKS_MIN_CHARS`. */
export const SIL_WHY_IT_WORKS_MIN_CHARS_DEFAULT = 144;
/** Default minimum length for deck `strategic_thesis`. Override via `SIL_STRATEGIC_THESIS_MIN_CHARS`. */
export const SIL_STRATEGIC_THESIS_MIN_CHARS_DEFAULT = 240;
/** Default minimum length for per-slide `visual_description`. Override via `SIL_VISUAL_DESCRIPTION_MIN_CHARS`. */
export const SIL_VISUAL_DESCRIPTION_MIN_CHARS_DEFAULT = 96;

/** Values Nemotron (and normalizers) emit when a field has no usable signal. */
const NA_PLACEHOLDER =
  /^(?:n\s*\/\s*a|na|none|unknown|not applicable|not available|no visual|text[- ]only|content[- ]only|unavailable|missing|please specify|tbd|todo|n\/a)\b[\s\-—.:,()]*/i;

export function isNaOrPlaceholderAnalysisValue(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return true;
  return NA_PLACEHOLDER.test(t);
}

export type SlideIntelligenceTextQualityOpts = {
  whyMinChars?: number;
  thesisMinChars?: number;
  visualMinChars?: number;
  /** When true (default in audits), reject heuristic template padding for Why Mimic readiness. */
  requireSubstantive?: boolean;
  /** Fraction of slides that must have non-template why + visual (0–1). Default 1. */
  minSubstantiveSlideRatio?: number;
};

/** Heuristic `synthesizeSlideWhyItWorks()` markers — passes length checks but not reinterpretation-grade. */
const SYNTHESIZED_WHY_MARKERS = [
  /must keep its narrative job/i,
  /new variants should pair fresh visuals with the same persuasion function/i,
  /mechanisms to preserve:/i,
  /do not echo the deck thesis verbatim or copy reference subjects literally/i,
  /reference imagery:/i,
] as const;

/** Heuristic `ensureMinVisualDescription()` / synthesize padding markers. */
const SYNTHESIZED_VISUAL_MARKERS = [
  /art-only instagram carousel .+ plate \(slide \d+ of \d+\)/i,
  /smooth overlay-safe regions and no readable text in the frame/i,
  /supports narrative job:/i,
] as const;

/** True when `why_it_works` was padded by heuristic enrichment, not Nemotron vision analysis. */
export function isSynthesizedSilWhyItWorks(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  let hits = 0;
  for (const re of SYNTHESIZED_WHY_MARKERS) {
    if (re.test(t)) hits += 1;
  }
  return hits >= 2 || (/must keep its narrative job/i.test(t) && /reference imagery:/i.test(t));
}

/** True when `visual_description` was padded by heuristic enrichment. */
export function isSynthesizedSilVisualDescription(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  for (const re of SYNTHESIZED_VISUAL_MARKERS) {
    if (re.test(t)) return true;
  }
  return /photo role:/i.test(t) && /visual role:/i.test(t) && /overlay-safe regions/i.test(t);
}

function effectiveVisualMinChars(opts?: SlideIntelligenceTextQualityOpts): number {
  const n = opts?.visualMinChars;
  return typeof n === "number" && n >= 0 ? n : SIL_VISUAL_DESCRIPTION_MIN_CHARS_DEFAULT;
}

function normalizeCompareText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** True when a slide's why is just the deck thesis copied verbatim (not slide-specific). */
export function isDeckThesisEchoOnSlide(
  slideWhy: string | null | undefined,
  strategicThesis: string | null | undefined
): boolean {
  const why = normalizeCompareText(slideWhy);
  const thesis = normalizeCompareText(strategicThesis);
  if (!why || !thesis) return false;
  if (why === thesis) return true;
  if (why.length >= 24 && thesis.length >= 24 && (why.includes(thesis) || thesis.includes(why))) {
    return true;
  }
  return false;
}

/** Per-slide reference imagery description meets minimum length. */
export function isSlideIntelligenceVisualDescriptionSufficient(
  raw: string | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts
): boolean {
  const t = String(raw ?? "").trim();
  if (isNaOrPlaceholderAnalysisValue(t)) return false;
  return t.length >= effectiveVisualMinChars(opts);
}

function effectiveWhyMinChars(opts?: SlideIntelligenceTextQualityOpts): number {
  const n = opts?.whyMinChars;
  return typeof n === "number" && n >= 0 ? n : SIL_WHY_IT_WORKS_MIN_CHARS_DEFAULT;
}

function effectiveThesisMinChars(opts?: SlideIntelligenceTextQualityOpts): number {
  const n = opts?.thesisMinChars;
  return typeof n === "number" && n >= 0 ? n : SIL_STRATEGIC_THESIS_MIN_CHARS_DEFAULT;
}

/** Per-slide `why_it_works` meets minimum length and is not a placeholder. */
export function isSlideIntelligenceWhyItWorksSufficient(
  raw: string | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts & { strategicThesis?: string | null }
): boolean {
  const t = String(raw ?? "").trim();
  if (isNaOrPlaceholderAnalysisValue(t)) return false;
  if (isDeckThesisEchoOnSlide(t, opts?.strategicThesis ?? null)) return false;
  return t.length >= effectiveWhyMinChars(opts);
}

/** Why Mimic–grade per-slide why: sufficient length and not heuristic template padding. */
export function isSlideIntelligenceWhyItWorksSubstantive(
  raw: string | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts & { strategicThesis?: string | null }
): boolean {
  if (!isSlideIntelligenceWhyItWorksSufficient(raw, opts)) return false;
  if (opts?.requireSubstantive === false) return true;
  return !isSynthesizedSilWhyItWorks(raw);
}

/** Why Mimic–grade per-slide visual: sufficient length and not heuristic template padding. */
export function isSlideIntelligenceVisualDescriptionSubstantive(
  raw: string | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts
): boolean {
  if (!isSlideIntelligenceVisualDescriptionSufficient(raw, opts)) return false;
  if (opts?.requireSubstantive === false) return true;
  return !isSynthesizedSilVisualDescription(raw);
}

/** Deck-level strategic thesis meets minimum length and is not a placeholder. */
export function isSlideIntelligenceStrategicThesisSufficient(
  raw: string | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts
): boolean {
  const t = String(raw ?? "").trim();
  if (isNaOrPlaceholderAnalysisValue(t)) return false;
  return t.length >= effectiveThesisMinChars(opts);
}

export type SlideIntelligenceWhyQualityIssue = {
  slide_index: number;
  field: "why_it_works" | "visual_description";
  reason: "missing" | "placeholder" | "too_short" | "deck_thesis_echo" | "synthesized_template";
  char_count: number;
  min_chars: number;
  preview: string | null;
};

export type SlideIntelligenceBundleQualityReport = {
  sufficient_for_reinterpretation: boolean;
  why_min_chars: number;
  visual_min_chars: number;
  strategic_thesis_min_chars: number;
  slide_count: number;
  slides_with_sufficient_why: number;
  slides_with_sufficient_visual: number;
  slides_with_substantive_why: number;
  slides_with_substantive_visual: number;
  thin_slides: SlideIntelligenceWhyQualityIssue[];
  strategic_thesis: {
    sufficient: boolean;
    reason: "ok" | "missing" | "placeholder" | "too_short";
    char_count: number;
    min_chars: number;
    preview: string | null;
  };
};

export type WhyMimicSilPlanningEvaluation = {
  eligible: boolean;
  report: SlideIntelligenceBundleQualityReport;
};

/** Whether a SIL bundle is ready to plan Why Mimic jobs (substantive per-slide + deck thesis). */
export function evaluateWhyMimicSilPlanning(
  bundle: SlideIntelligenceBundleV1 | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts & {
    minSlidePassRatio?: number;
    minSubstantiveSlideRatio?: number;
  }
): WhyMimicSilPlanningEvaluation | null {
  const report = auditSlideIntelligenceWhyQuality(bundle, {
    ...opts,
    requireSubstantive: opts?.requireSubstantive !== false,
    minSubstantiveSlideRatio: opts?.minSubstantiveSlideRatio ?? 1,
  });
  if (!report) return null;
  return { eligible: report.sufficient_for_reinterpretation, report };
}

/** Audit a SIL bundle for Why Mimic reinterpretation readiness. */
export function auditSlideIntelligenceWhyQuality(
  bundle: SlideIntelligenceBundleV1 | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts & {
    /** Fraction of slides that must pass (0–1). Default 1 = all slides. */
    minSlidePassRatio?: number;
  }
): SlideIntelligenceBundleQualityReport | null {
  if (!bundle) return null;

  const whyMin = effectiveWhyMinChars(opts);
  const visualMin = effectiveVisualMinChars(opts);
  const thesisMin = effectiveThesisMinChars(opts);
  const minRatio = Math.min(1, Math.max(0, opts?.minSlidePassRatio ?? 1));
  const thesis = bundle.why_analysis?.strategic_thesis ?? null;

  const thin_slides: SlideIntelligenceWhyQualityIssue[] = [];
  let slides_with_sufficient_why = 0;
  let slides_with_sufficient_visual = 0;
  let slides_with_substantive_why = 0;
  let slides_with_substantive_visual = 0;
  const whyOpts = { ...opts, strategicThesis: thesis };
  const requireSubstantive = opts?.requireSubstantive !== false;

  for (const slide of bundle.slides) {
    const whyRaw = slide.why_it_works;
    const whyPreview = whyRaw ? whyRaw.slice(0, 120) : null;
    const whyChars = String(whyRaw ?? "").trim().length;

    if (!whyRaw || !String(whyRaw).trim()) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "why_it_works",
        reason: "missing",
        char_count: whyChars,
        min_chars: whyMin,
        preview: whyPreview,
      });
    } else if (isDeckThesisEchoOnSlide(whyRaw, thesis)) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "why_it_works",
        reason: "deck_thesis_echo",
        char_count: whyChars,
        min_chars: whyMin,
        preview: whyPreview,
      });
    } else if (isNaOrPlaceholderAnalysisValue(whyRaw)) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "why_it_works",
        reason: "placeholder",
        char_count: whyChars,
        min_chars: whyMin,
        preview: whyPreview,
      });
    } else if (whyChars < whyMin) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "why_it_works",
        reason: "too_short",
        char_count: whyChars,
        min_chars: whyMin,
        preview: whyPreview,
      });
    } else if (requireSubstantive && isSynthesizedSilWhyItWorks(whyRaw)) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "why_it_works",
        reason: "synthesized_template",
        char_count: whyChars,
        min_chars: whyMin,
        preview: whyPreview,
      });
    } else {
      slides_with_sufficient_why += 1;
      if (isSlideIntelligenceWhyItWorksSubstantive(whyRaw, whyOpts)) {
        slides_with_substantive_why += 1;
      }
    }

    const visRaw = slide.visual_description;
    const visPreview = visRaw ? visRaw.slice(0, 120) : null;
    const visChars = String(visRaw ?? "").trim().length;
    if (!visRaw || !String(visRaw).trim()) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "visual_description",
        reason: "missing",
        char_count: visChars,
        min_chars: visualMin,
        preview: visPreview,
      });
    } else if (isNaOrPlaceholderAnalysisValue(visRaw)) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "visual_description",
        reason: "placeholder",
        char_count: visChars,
        min_chars: visualMin,
        preview: visPreview,
      });
    } else if (visChars < visualMin) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "visual_description",
        reason: "too_short",
        char_count: visChars,
        min_chars: visualMin,
        preview: visPreview,
      });
    } else if (requireSubstantive && isSynthesizedSilVisualDescription(visRaw)) {
      thin_slides.push({
        slide_index: slide.slide_index,
        field: "visual_description",
        reason: "synthesized_template",
        char_count: visChars,
        min_chars: visualMin,
        preview: visPreview,
      });
    } else {
      slides_with_sufficient_visual += 1;
      if (isSlideIntelligenceVisualDescriptionSubstantive(visRaw, opts)) {
        slides_with_substantive_visual += 1;
      }
    }
  }

  const thesisRaw = bundle.why_analysis?.strategic_thesis ?? null;
  const thesisChars = String(thesisRaw ?? "").trim().length;
  let thesisReason: SlideIntelligenceBundleQualityReport["strategic_thesis"]["reason"] = "ok";
  if (!thesisRaw || !String(thesisRaw).trim()) thesisReason = "missing";
  else if (isNaOrPlaceholderAnalysisValue(thesisRaw)) thesisReason = "placeholder";
  else if (thesisChars < thesisMin) thesisReason = "too_short";

  const slideCount = Math.max(bundle.slides.length, 1);
  const whyPassRatio = slides_with_sufficient_why / slideCount;
  const visualPassRatio = slides_with_sufficient_visual / slideCount;
  const substantiveRatio = Math.min(1, Math.max(0, opts?.minSubstantiveSlideRatio ?? 1));
  const substantiveWhyRatio = slides_with_substantive_why / slideCount;
  const substantiveVisualRatio = slides_with_substantive_visual / slideCount;
  const thesisOk = isSlideIntelligenceStrategicThesisSufficient(thesisRaw, opts);
  const substantiveOk =
    !requireSubstantive ||
    (substantiveWhyRatio >= substantiveRatio && substantiveVisualRatio >= substantiveRatio);

  return {
    sufficient_for_reinterpretation:
      thesisOk && whyPassRatio >= minRatio && visualPassRatio >= minRatio && substantiveOk,
    why_min_chars: whyMin,
    visual_min_chars: visualMin,
    strategic_thesis_min_chars: thesisMin,
    slide_count: bundle.slides.length,
    slides_with_sufficient_why,
    slides_with_sufficient_visual,
    slides_with_substantive_why,
    slides_with_substantive_visual,
    thin_slides,
    strategic_thesis: {
      sufficient: thesisOk,
      reason: thesisReason,
      char_count: thesisChars,
      min_chars: thesisMin,
      preview: thesisRaw ? thesisRaw.slice(0, 160) : null,
    },
  };
}

function countsAsStrategicSignal(value: string | null | undefined): boolean {
  return Boolean(value && !isNaOrPlaceholderAnalysisValue(value));
}

export type MimicFluxVisualAnalysisSlice = {
  slide_purpose?: string | null;
  layout_template?: string | null;
  visual_description?: string | null;
  visual_hierarchy?: string | null;
  layout_structure?: string | null;
  deck_why_it_worked?: string | null;
  deck_aesthetic?: string | null;
};

/** Classic mimic: Nemotron visual fields must carry concrete scene/layout signal. */
export function isMimicFluxAnalysisSufficientForT2i(input: MimicFluxVisualAnalysisSlice): boolean {
  const hasVisual = !isNaOrPlaceholderAnalysisValue(input.visual_description);
  const hasLayout = !isNaOrPlaceholderAnalysisValue(input.layout_template);
  const hasComposition =
    !isNaOrPlaceholderAnalysisValue(input.visual_hierarchy) ||
    !isNaOrPlaceholderAnalysisValue(input.layout_structure);

  if (hasVisual || hasLayout || hasComposition) return true;

  const purpose = String(input.slide_purpose ?? "")
    .trim()
    .toLowerCase();
  if (
    purpose &&
    purpose !== "content" &&
    purpose !== "filler" &&
    purpose !== "listicle_item" &&
    !isNaOrPlaceholderAnalysisValue(purpose)
  ) {
    const hasDeckMood =
      !isNaOrPlaceholderAnalysisValue(input.deck_aesthetic) ||
      !isNaOrPlaceholderAnalysisValue(input.deck_why_it_worked);
    if (hasDeckMood) return true;
  }

  return false;
}

/** Why Mimic: SIL + generated copy must carry enough strategic signal without reference pixels. */
export function isWhyMimicFluxInputSufficientForT2i(
  input: WhyMimicFluxSlideInput | null | undefined,
  opts?: SlideIntelligenceTextQualityOpts
): boolean {
  if (!input) return false;

  const whyOpts = { ...opts, strategicThesis: null };
  const hasSubstantiveWhy = isSlideIntelligenceWhyItWorksSubstantive(input.why_it_works, whyOpts);
  const hasSubstantiveVisual = isSlideIntelligenceVisualDescriptionSubstantive(input.visual_description, opts);

  const strategic = [
    input.slide_role,
    input.narrative_function,
    input.psychological_trigger,
    input.persuasion_mechanism,
    input.curiosity_mechanism,
    input.attention_device,
    input.visual_role,
  ].filter((v) => countsAsStrategicSignal(v));

  if (hasSubstantiveWhy && hasSubstantiveVisual) return true;

  if (hasSubstantiveWhy) strategic.push(input.why_it_works!);
  if (hasSubstantiveVisual) strategic.push(input.visual_description!);

  if (strategic.length >= 2) return true;

  const hasCopy =
    !isNaOrPlaceholderAnalysisValue(input.generated_headline) ||
    !isNaOrPlaceholderAnalysisValue(input.generated_body);

  if (strategic.length >= 1 && hasCopy && (hasSubstantiveWhy || hasSubstantiveVisual)) return true;

  if (hasSubstantiveWhy && String(input.why_it_works).trim().length >= effectiveWhyMinChars(opts) + 20) {
    return true;
  }

  return false;
}

/** True when an archived reference frame can be fetched for this output slide. */
export function mimicSlideHasUsableReference(
  mimic: Pick<MimicPayloadV1, "reference_items" | "slide_plans" | "archive_reference_items">,
  slideIndex1Based: number
): boolean {
  const items = mimic.reference_items ?? [];
  const archive =
    mimic.archive_reference_items?.length && mimic.archive_reference_items.length > 0
      ? mimic.archive_reference_items
      : items;
  if (archive.length === 0 && items.length === 0) return false;

  const plan = mimic.slide_plans?.find((p) => p.slide_index === slideIndex1Based);
  const sourceIdx = sourceSlideIndexForMimicOutput(mimic, slideIndex1Based);

  const hasFetchable = (item: { vision_fetch_url?: string; bucket?: string | null; object_path?: string | null }) => {
    if (String(item.vision_fetch_url ?? "").trim()) return true;
    return Boolean(String(item.bucket ?? "").trim() && String(item.object_path ?? "").trim());
  };

  for (const pool of [archive, items]) {
    const bySource = pool.find((r) => r.source_slide_index === sourceIdx);
    if (bySource && hasFetchable(bySource)) return true;

    if (sourceIdx >= 1 && sourceIdx <= pool.length) {
      const positional = pool[sourceIdx - 1];
      if (positional && hasFetchable(positional)) return true;
    }

    if (slideIndex1Based >= 1 && slideIndex1Based <= pool.length) {
      const positional = pool[slideIndex1Based - 1];
      if (positional && hasFetchable(positional)) return true;
    }
  }

  return items.some((r) => hasFetchable(r));
}
