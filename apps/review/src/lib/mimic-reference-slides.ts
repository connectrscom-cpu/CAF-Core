/** Reference slide image URLs from mimic_v1 (original Instagram frames). */

import {
  templateBgSlideIndicesForSlot,
  templateBgSlotForSlide,
} from "@/lib/mimic-template-bg";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickUrl(item: Record<string, unknown>): string {
  for (const key of ["vision_fetch_url", "public_url", "preview_url", "source_url"]) {
    const u = String(item[key] ?? "").trim();
    if (u) return u;
  }
  return "";
}

function referenceItemsFromMimicV1(mimicV1: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!mimicV1) return [];
  const primary = Array.isArray(mimicV1.reference_items) ? mimicV1.reference_items : [];
  const archive = Array.isArray(mimicV1.archive_reference_items) ? mimicV1.archive_reference_items : [];
  const items = primary.length > 0 ? primary : archive;
  return items.map((raw) => asRec(raw)).filter(Boolean) as Record<string, unknown>[];
}

function sourceSlideIndex(item: Record<string, unknown>, fallback1Based: number): number {
  const src = Number(item.source_slide_index ?? item.index);
  return Number.isFinite(src) && src >= 1 ? src : fallback1Based;
}

function referenceUrlForArchiveIndex(
  mimicV1: Record<string, unknown>,
  refIndex1Based: number
): string | undefined {
  const items = referenceItemsFromMimicV1(mimicV1);
  if (items.length === 0 || refIndex1Based < 1) return undefined;

  const byIndex = items.find((item) => Number(item.index) === refIndex1Based);
  if (byIndex) {
    const url = pickUrl(byIndex);
    if (url) return url;
  }

  const bySource = items.find((item) => sourceSlideIndex(item, 0) === refIndex1Based);
  if (bySource) {
    const url = pickUrl(bySource);
    if (url) return url;
  }

  if (refIndex1Based >= 1 && refIndex1Based <= items.length) {
    const cycled = items[refIndex1Based - 1];
    return cycled ? pickUrl(cycled) || undefined : undefined;
  }
  return undefined;
}

/** template_bg: compare against the archived frame used for OCR on this slot (middle slides share one). */
function templateBgReferenceIndexForSlide(
  mimicV1: Record<string, unknown>,
  slideIndex1Based: number,
  totalSlides: number
): number {
  const slot = templateBgSlotForSlide(slideIndex1Based, totalSlides);
  const anchorSlides = templateBgSlideIndicesForSlot(slot, totalSlides);
  const anchorSlide = anchorSlides[0] ?? slideIndex1Based;
  const plans = Array.isArray(mimicV1.slide_plans) ? mimicV1.slide_plans : [];
  const plan = plans.map((p) => asRec(p)).find((p) => p && Number(p.slide_index) === anchorSlide);
  const fromPlan = Number(plan?.reference_index ?? plan?.source_slide_index);
  if (Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;
  return anchorSlide;
}

/** 1-based slide index → original reference frame URL (if archived). */
export function mimicReferenceUrlForSlide(
  mimicV1: Record<string, unknown> | null | undefined,
  slideIndex1Based: number,
  totalSlides?: number
): string | undefined {
  const items = referenceItemsFromMimicV1(mimicV1 ?? null);
  if (items.length === 0 || slideIndex1Based < 1) return undefined;

  const mode = String(mimicV1?.mode ?? "").trim();
  if (mode === "template_bg" && totalSlides != null && totalSlides > 0) {
    const refIdx = templateBgReferenceIndexForSlide(mimicV1!, slideIndex1Based, totalSlides);
    const slotUrl = referenceUrlForArchiveIndex(mimicV1!, refIdx);
    if (slotUrl) return slotUrl;
  }

  const byOutputIndex = items[slideIndex1Based - 1];
  if (byOutputIndex) {
    const url = pickUrl(byOutputIndex);
    if (url) return url;
  }

  const slidePlans = Array.isArray(mimicV1?.slide_plans) ? mimicV1!.slide_plans : [];
  const plan = slidePlans
    .map((p) => asRec(p))
    .find((p) => p && Number(p.slide_index) === slideIndex1Based);
  const sourceIdx = plan ? Number(plan.source_slide_index) : slideIndex1Based;

  const bySource = items.find((item) => sourceSlideIndex(item, 0) === sourceIdx);
  if (bySource) {
    const url = pickUrl(bySource);
    if (url) return url;
  }

  const cycled = items[(slideIndex1Based - 1) % items.length];
  return cycled ? pickUrl(cycled) || undefined : undefined;
}

/** All reference URLs aligned to output slide positions (1 per slide). */
export function mimicReferenceUrlsBySlide(
  mimicV1: Record<string, unknown> | null | undefined,
  slideCount: number
): (string | undefined)[] {
  return Array.from({ length: Math.max(0, slideCount) }, (_, i) =>
    mimicReferenceUrlForSlide(mimicV1 ?? null, i + 1, slideCount)
  );
}
