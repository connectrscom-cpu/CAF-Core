import { aestheticSlideRecords } from "./mimic-text-heavy.js";
import type { MimicMode } from "./mimic-payload.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Nemotron sometimes marks slides as skipped for theme/planner relevance — not promo frames. */
export function isThemeOnlyMimicSkipReason(skipReason: string | null | undefined): boolean {
  const r = String(skipReason ?? "").trim().toLowerCase();
  if (!r) return false;
  return (
    r.includes("no relevance") ||
    r.includes("not relevant") ||
    r.includes("off topic") ||
    r.includes("off-topic") ||
    r.includes("unrelated") ||
    /\btheme\b/.test(r)
  );
}

/** Vision eval recommended full-bleed per-slide mimic (vs shared template plate). */
export function isFullBleedCarouselMimicEntry(entry: Record<string, unknown>): boolean {
  const raw = pickMimicEvaluationFromGuidelineEntry(entry);
  const recommended = String(raw?.recommended_mode ?? "").trim().toLowerCase();
  return recommended === "full_bleed_visual" || recommended === "not_suitable";
}

/**
 * Nemotron `skip_slide_indices` are planner hints only — not used to drop reference frames.
 * Only promotional / video filtering removes slides (`isPromotionalSourceSlide`, etc.).
 */
export function mimicEvalSkipSlideIndices(
  _entry: Record<string, unknown>,
  _opts?: { mimicMode?: MimicMode }
): number[] {
  return [];
}

export function shouldExpandThemeSkippedArchiveDeck(
  entry: Record<string, unknown>,
  fromEval: number[],
  totalRefs: number
): boolean {
  if (totalRefs < 2 || fromEval.length >= totalRefs) return false;
  const raw = pickMimicEvaluationFromGuidelineEntry(entry);
  if (!isThemeOnlyMimicSkipReason(String(raw?.skip_reason ?? ""))) return false;
  const rawSkip = Array.isArray(raw?.skip_slide_indices)
    ? raw!.skip_slide_indices.filter((v: unknown): v is number => typeof v === "number")
    : [];
  if (rawSkip.length === 0) return false;
  return rawSkip.length >= totalRefs - fromEval.length;
}

export function pickMimicEvaluationFromGuidelineEntry(
  entry: Record<string, unknown>
): Record<string, unknown> | null {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  return asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
}

/** 1-based indices of slides with non-empty on-screen text in the vision analysis. */
export function textfulSlideIndicesFromEntry(
  entry: Record<string, unknown>,
  totalRefs: number,
  skip: Set<number>
): number[] {
  const slides = aestheticSlideRecords(entry)
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => s != null);
  const textful = slides
    .map((s) => {
      const idx = Number(s.slide_index);
      const t = String(s.on_screen_text_transcript ?? s.on_image_text ?? "").trim();
      return { idx, hasText: t.length > 0 };
    })
    .filter((x) => Number.isFinite(x.idx) && x.idx >= 1 && x.idx <= totalRefs && x.hasText)
    .map((x) => x.idx);
  const unique = Array.from(new Set(textful)).sort((a, b) => a - b);
  return unique.filter((i) => !skip.has(i));
}

/**
 * True when Nemotron `content_slide_indices` is a strict subset of a uniform text deck
 * and we should mimic the full carousel (cover + body slides + CTA), not a 3-frame sample.
 */
export function shouldExpandContentIndicesToFullTextDeck(
  contentIndices: number[],
  textfulIndices: number[],
  totalRefs: number
): boolean {
  if (contentIndices.length === 0 || textfulIndices.length === 0) return false;
  if (contentIndices.length >= textfulIndices.length) return false;
  if (textfulIndices.length >= totalRefs && contentIndices.length >= totalRefs) return false;

  const textfulCount = textfulIndices.length;
  const evalCount = contentIndices.length;

  // e.g. [1,7,12] on a 12-slide listicle → expand to all text-bearing slides
  if (textfulCount >= 4 && evalCount < Math.ceil(textfulCount * 0.75)) {
    return true;
  }
  // Legacy guardrail: large decks where eval kept ≤ half the text slides
  if (textfulCount >= 8 && evalCount <= Math.max(3, Math.floor(textfulCount * 0.5))) {
    return true;
  }
  return false;
}

/**
 * Resolve which 1-based source slide indices should drive copy + reference mimic.
 * Expands undercounted Nemotron evals; honors explicit skip_slide_indices.
 */
export function resolveEffectiveContentSlideIndices(
  entry: Record<string, unknown>,
  totalRefs: number,
  opts?: { mimicMode?: MimicMode }
): number[] {
  const total = Math.max(1, Math.floor(totalRefs));
  const skip = new Set(mimicEvalSkipSlideIndices(entry, opts));
  const raw = pickMimicEvaluationFromGuidelineEntry(entry);
  const fromEval = Array.isArray(raw?.content_slide_indices)
    ? raw!.content_slide_indices.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= total
      )
    : [];

  const textful = textfulSlideIndicesFromEntry(entry, total, skip);
  const allNonSkipped = Array.from({ length: total }, (_, i) => i + 1).filter((i) => !skip.has(i));

  if (fromEval.length > 0) {
    const filtered = fromEval.filter((i) => !skip.has(i));
    const expandCandidates = textful.length > 0 ? textful : allNonSkipped;
    if (shouldExpandThemeSkippedArchiveDeck(entry, filtered, total)) {
      return allNonSkipped;
    }
    if (shouldExpandContentIndicesToFullTextDeck(filtered, expandCandidates, total)) {
      return expandCandidates;
    }
    return filtered.length > 0 ? filtered : allNonSkipped;
  }

  return textful.length > 0 ? textful : allNonSkipped;
}
