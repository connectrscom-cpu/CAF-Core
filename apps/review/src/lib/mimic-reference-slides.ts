/** Reference slide image URLs from mimic_v1 (original Instagram frames). */

import { sourceSlideIndexForMimicOutput } from "@caf-core-carousel/mimic-output-slide-index";
import {
  templateBgSlideIndicesForSlot,
  templateBgSlotForSlide,
} from "@/lib/mimic-template-bg";

export type MimicReferenceSlideLookupOptions = {
  /** Full top-performer carousel frame list from evidence inspection (when mimic archive is sparse). */
  referenceFrameUrls?: string[];
};

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
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const raw of [...primary, ...archive]) {
    const item = asRec(raw);
    if (!item) continue;
    const key = `${String(item.index ?? "")}:${String(item.source_slide_index ?? "")}:${pickUrl(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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

function referenceUrlFromFrameList(
  frames: string[],
  sourceIdx1Based: number,
  outputSlideIndex1Based: number
): string | undefined {
  const trimmed = frames.map((u) => u.trim()).filter(Boolean);
  if (trimmed.length === 0) return undefined;
  const sourceIdx = Math.max(0, sourceIdx1Based - 1);
  if (sourceIdx < trimmed.length) return trimmed[sourceIdx];
  const outputIdx = Math.max(0, outputSlideIndex1Based - 1);
  if (outputIdx < trimmed.length) return trimmed[outputIdx];
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
  totalSlides?: number,
  opts?: MimicReferenceSlideLookupOptions
): string | undefined {
  if (slideIndex1Based < 1) return undefined;

  const items = referenceItemsFromMimicV1(mimicV1 ?? null);
  const slidePlans = Array.isArray(mimicV1?.slide_plans) ? mimicV1!.slide_plans : [];
  const plan = slidePlans.map((p) => asRec(p)).find((p) => p && Number(p.slide_index) === slideIndex1Based);
  const sourceIdx = mimicV1
    ? sourceSlideIndexForMimicOutput(mimicV1 as Parameters<typeof sourceSlideIndexForMimicOutput>[0], slideIndex1Based)
    : slideIndex1Based;

  const mode = String(mimicV1?.mode ?? "").trim();
  if (mode === "template_bg" && totalSlides != null && totalSlides > 0 && mimicV1) {
    const refIdx = templateBgReferenceIndexForSlide(mimicV1, slideIndex1Based, totalSlides);
    const slotUrl = referenceUrlForArchiveIndex(mimicV1, refIdx);
    if (slotUrl) return slotUrl;
  }

  if (mimicV1) {
    const refIndexFromPlan = plan ? Number(plan.reference_index) : NaN;
    if (Number.isFinite(refIndexFromPlan) && refIndexFromPlan > 0) {
      const fromPlanRef = referenceUrlForArchiveIndex(mimicV1, refIndexFromPlan);
      if (fromPlanRef) return fromPlanRef;
    }

    if (items.length > 0) {
      const bySource = items.find((item) => sourceSlideIndex(item, 0) === sourceIdx);
      if (bySource) {
        const url = pickUrl(bySource);
        if (url) return url;
      }

      const byIndex = items.find((item) => Number(item.index) === sourceIdx);
      if (byIndex) {
        const url = pickUrl(byIndex);
        if (url) return url;
      }

      const fromArchiveIdx = referenceUrlForArchiveIndex(mimicV1, sourceIdx);
      if (fromArchiveIdx) return fromArchiveIdx;
    }
  }

  // Prefer source-deck frame list when mimic archive is sparse (map output → source, not raw output index).
  const frameUrl = referenceUrlFromFrameList(
    opts?.referenceFrameUrls ?? [],
    sourceIdx,
    slideIndex1Based
  );
  if (frameUrl) return frameUrl;

  // Never cycle a sparse archive by output index — that maps slide 3 → wrong sign when slide 1 was dropped.
  if (items.length === 1) {
    return pickUrl(items[0]!) || undefined;
  }

  return undefined;
}

/** All reference URLs aligned to output slide positions (1 per slide). */
export function mimicReferenceUrlsBySlide(
  mimicV1: Record<string, unknown> | null | undefined,
  slideCount: number,
  opts?: MimicReferenceSlideLookupOptions
): (string | undefined)[] {
  return Array.from({ length: Math.max(0, slideCount) }, (_, i) =>
    mimicReferenceUrlForSlide(mimicV1 ?? null, i + 1, slideCount, opts)
  );
}
