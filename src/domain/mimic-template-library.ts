/**
 * Template library eligibility — whether a top-performer deck's backgrounds
 * should be persisted for reuse across future carousel jobs (vs job-only plates).
 */
import type { MimicEvaluation, TemplateStorageQuality } from "./mimic-carousel-package.js";

export type { TemplateStorageQuality };
import type { MimicPayloadV1 } from "./mimic-payload.js";
import { resolveEffectiveContentSlideIndices } from "./mimic-content-slide-indices.js";
import {
  aestheticSlideRecords,
  deckUsesUnifiedBackgroundPlate,
  referenceSlideExceedsOnScreenTextLimit,
} from "./mimic-text-heavy.js";

export interface TemplateStorageDecision {
  quality: TemplateStorageQuality;
  reason: string;
  /** True when backgrounds may be written under mimic_template_library/{project}/{insights}/ */
  eligible_for_library: boolean;
  /** Pin evidence .hbs on the project for future implicit picks */
  pin_project_template: boolean;
}

const VALID_STORAGE_QUALITY = new Set<TemplateStorageQuality>(["reusable", "job_only", "reject"]);

const THEME_SPECIFIC_BG_CUES = [
  "zodiac",
  "horoscope",
  "astrology",
  "product mockup",
  "book cover",
  "ebook",
  "phone screen",
  "device mockup",
  "app screenshot",
  "brand logo",
  "creator face",
  "specific person",
  "meme character",
];

const PROMO_PURPOSES = new Set(["self_promo", "product_pitch"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function pickMimicEvaluationFromEntry(entry: Record<string, unknown>): MimicEvaluation | null {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const raw = asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
  if (!raw) return null;
  const mode = typeof raw.recommended_mode === "string" ? raw.recommended_mode.trim() : null;
  if (!mode && !raw.background_replicability) return null;
  return {
    recommended_mode: mode,
    mode_reason: typeof raw.mode_reason === "string" ? raw.mode_reason.trim() : null,
    background_replicability:
      typeof raw.background_replicability === "string" ? raw.background_replicability.trim() : null,
    background_description:
      typeof raw.background_description === "string" ? raw.background_description.trim() : null,
    template_consistency:
      typeof raw.template_consistency === "string" ? raw.template_consistency.trim() : null,
    content_slide_indices: Array.isArray(raw.content_slide_indices)
      ? raw.content_slide_indices.filter((v): v is number => typeof v === "number")
      : [],
    skip_slide_indices: Array.isArray(raw.skip_slide_indices)
      ? raw.skip_slide_indices.filter((v): v is number => typeof v === "number")
      : [],
    skip_reason: typeof raw.skip_reason === "string" ? raw.skip_reason.trim() : null,
    replication_difficulty:
      typeof raw.replication_difficulty === "string" ? raw.replication_difficulty.trim() : null,
    template_storage_quality: normalizeStorageQuality(raw.template_storage_quality),
    template_storage_reason:
      typeof raw.template_storage_reason === "string" ? raw.template_storage_reason.trim() : null,
  };
}

export function pickMimicEvaluationFromMimic(mimic: MimicPayloadV1): MimicEvaluation | null {
  const vg = mimic.visual_guideline ?? {};
  return pickMimicEvaluationFromEntry({ ...vg, aesthetic_analysis_json: vg });
}

function normalizeStorageQuality(raw: unknown): TemplateStorageQuality | null {
  const q = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (q === "reusable" || q === "job_only" || q === "reject") return q;
  if (q === "job-only" || q === "jobonly") return "job_only";
  if (q === "library" || q === "store" || q === "storable") return "reusable";
  return null;
}

function backgroundLooksThemeSpecific(eval_: MimicEvaluation | null): boolean {
  const hay = String(eval_?.background_description ?? "").toLowerCase();
  if (!hay) return false;
  return THEME_SPECIFIC_BG_CUES.some((cue) => hay.includes(cue));
}

function slideIsPromotionalForLibrary(slide: Record<string, unknown>): boolean {
  const purpose = String(slide.slide_purpose ?? "").trim().toLowerCase();
  const brand = String(slide.brand_specificity ?? "").trim().toLowerCase();
  if (PROMO_PURPOSES.has(purpose) || brand === "high") return true;
  return false;
}

function deckPromotionalDensity(entry: Record<string, unknown>): number {
  const slides = aestheticSlideRecords(entry);
  if (slides.length === 0) return 0;
  let hasTags = false;
  let promoCount = 0;
  for (const s of slides) {
    const purpose = String(s.slide_purpose ?? "").trim().toLowerCase();
    const brand = String(s.brand_specificity ?? "").trim().toLowerCase();
    if (purpose || brand) hasTags = true;
    if (PROMO_PURPOSES.has(purpose) || brand === "high") promoCount++;
  }
  if (!hasTags) return 0;
  return promoCount / slides.length;
}

function referenceSlideIndexWithinTextLimit(
  entry: Record<string, unknown>,
  slideIndex1Based: number
): boolean {
  const slides = aestheticSlideRecords(entry);
  const slide =
    slides.find((s) => Number(s.slide_index) === slideIndex1Based) ?? slides[slideIndex1Based - 1];
  if (!slide) return true;
  return !referenceSlideExceedsOnScreenTextLimit(slide);
}

/** 1-based slide indices suitable as cover/body/cta extraction sources. */
export function contentReferenceIndicesForTemplate(
  entry: Record<string, unknown>,
  totalRefs: number
): number[] {
  const base = resolveEffectiveContentSlideIndices(entry, totalRefs);
  const slides = aestheticSlideRecords(entry);
  const nonPromo = base.filter((idx) => {
    const slide = asRecord(slides.find((s) => Number(s.slide_index) === idx) ?? slides[idx - 1]);
    if (!slide) return true;
    return !slideIsPromotionalForLibrary(slide);
  });
  return nonPromo.length > 0 ? nonPromo : base;
}

export type TemplateBgSlot = "cover" | "body" | "cta";

/** Output slide index → cover / body / CTA slot for template_bg mimic decks. */
export function templateBgSlotForIndex(slideIndex: number, totalSlides: number): TemplateBgSlot {
  if (slideIndex === 1) return "cover";
  if (totalSlides > 2 && slideIndex === totalSlides) return "cta";
  return "body";
}

/**
 * Pick a non-promotional reference index for cover / body / CTA extraction.
 */
export function referenceIndexForTemplateSlot(
  entry: Record<string, unknown>,
  slot: TemplateBgSlot,
  totalRefs: number
): number {
  const candidates = contentReferenceIndicesForTemplate(entry, totalRefs);
  if (candidates.length === 0) return 1;

  if (slot === "cover") return candidates[0]!;
  if (slot === "cta") return candidates[candidates.length - 1]!;
  const bodyPick = candidates.length >= 3 ? candidates[Math.floor(candidates.length / 2)] : candidates[0];
  return bodyPick ?? 1;
}

/** Slide plan reference frame for template_bg — maps cover/body/cta slots to archive geometry. */
export function templateBgSlidePlanRef(
  entry: Record<string, unknown>,
  slideIndex: number,
  totalSlides: number,
  refFrameCount: number,
  unifiedBg: boolean
): { reference_index: number; source_slide_index?: number } {
  if (!unifiedBg) {
    const refSlot = refFrameCount > 0 ? ((slideIndex - 1) % refFrameCount) + 1 : 1;
    return { reference_index: refSlot };
  }
  const slot = templateBgSlotForIndex(slideIndex, totalSlides);
  const refIdx = referenceIndexForTemplateSlot(entry, slot, refFrameCount || totalSlides);
  return { reference_index: refIdx, source_slide_index: refIdx };
}

function programmaticStorageQuality(
  entry: Record<string, unknown>,
  mimicMode: string | null
): { quality: TemplateStorageQuality; reason: string } {
  const eval_ = pickMimicEvaluationFromEntry(entry);
  const mode = String(eval_?.recommended_mode ?? "").toLowerCase();
  const promoDensity = deckPromotionalDensity(entry);

  if (mode === "not_suitable") {
    return { quality: "reject", reason: "Nemotron marked deck not_suitable for mimic replication." };
  }
  if (promoDensity > 0.5) {
    return {
      quality: "reject",
      reason: "More than half of slides are promotional or brand-locked.",
    };
  }

  const isTemplatePath =
    mimicMode === "template_bg" || mode === "text_on_template" || deckUsesUnifiedBackgroundPlate(entry);

  if (!isTemplatePath) {
    return {
      quality: "job_only",
      reason: "Deck is visual-led (full_bleed path); no shared template library needed.",
    };
  }

  if (eval_?.background_replicability === "low") {
    return { quality: "reject", reason: "Background/frame is not convincingly replicable by image-gen." };
  }

  if (backgroundLooksThemeSpecific(eval_)) {
    return {
      quality: "job_only",
      reason: "Background description is theme- or product-specific; use job plates only.",
    };
  }

  if (
    eval_?.template_consistency === "uniform" &&
    eval_?.background_replicability === "high" &&
    promoDensity <= 0.25 &&
    mode !== "not_suitable"
  ) {
    return {
      quality: "reusable",
      reason:
        "Uniform template, high background replicability, low promo density — safe to store generic plates for reuse.",
    };
  }

  if (eval_?.template_consistency === "varied") {
    return {
      quality: "job_only",
      reason: "Slides use varied unique backgrounds; not a single reusable template.",
    };
  }

  return {
    quality: "job_only",
    reason: "Template path but missing uniform layout or high background replicability.",
  };
}

/** Merge Nemotron template_storage_quality with programmatic rules (stricter wins). */
export function resolveTemplateStorageDecision(
  entry: Record<string, unknown>,
  mimicMode?: string | null
): TemplateStorageDecision {
  const eval_ = pickMimicEvaluationFromEntry(entry);
  const programmatic = programmaticStorageQuality(entry, mimicMode ?? null);
  const nemotronQ = eval_?.template_storage_quality;
  const nemotronReason = eval_?.template_storage_reason ?? "";

  const rank: Record<TemplateStorageQuality, number> = { reusable: 0, job_only: 1, reject: 2 };
  let quality = programmatic.quality;
  let reason = programmatic.reason;

  if (nemotronQ && VALID_STORAGE_QUALITY.has(nemotronQ)) {
    if (rank[nemotronQ] > rank[quality]) {
      quality = nemotronQ;
      reason = nemotronReason || `Nemotron template_storage_quality=${nemotronQ}`;
    } else if (nemotronQ === "reusable" && quality === "job_only") {
      quality = "reusable";
      reason = nemotronReason || programmatic.reason;
    }
  }

  const eligible_for_library = quality === "reusable";
  return {
    quality,
    reason,
    eligible_for_library,
    pin_project_template: eligible_for_library,
  };
}

export function resolveTemplateStorageFromMimic(mimic: MimicPayloadV1): TemplateStorageDecision {
  const entry = { ...(mimic.visual_guideline ?? {}), aesthetic_analysis_json: mimic.visual_guideline ?? {} };
  return resolveTemplateStorageDecision(entry, mimic.mode);
}

/** Supabase object path for a reusable library plate (cover | body | cta). */
export function mimicTemplateLibraryObjectPath(
  projectId: string,
  sourceInsightsId: string,
  slot: TemplateBgSlot,
  ext: "png" | "jpg" = "png"
): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36);
  const safeIns = sourceInsightsId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `mimic_template_library/${safeProject}/${safeIns}/${slot}_v1.${ext}`;
}
