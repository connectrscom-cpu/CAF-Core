/** Reference slide image URLs from mimic_v1 (original Instagram frames). */

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

/** 1-based slide index → original reference frame URL (if archived). */
export function mimicReferenceUrlForSlide(
  mimicV1: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): string | undefined {
  const items = referenceItemsFromMimicV1(mimicV1 ?? null);
  if (items.length === 0 || slideIndex1Based < 1) return undefined;

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
    mimicReferenceUrlForSlide(mimicV1 ?? null, i + 1)
  );
}
