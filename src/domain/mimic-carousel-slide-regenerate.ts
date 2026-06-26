/** `render_state.phase` while mimic carousel slide image regen (Flux/Qwen) is in flight. */
export const MIMIC_CAROUSEL_SLIDE_REGENERATE_PHASE = "carousel_slide_regenerate";

/** Job statuses that should stay in the human review queue during slide image regen. */
export function isReviewRetainStatusDuringCarouselSlideRegenerate(
  status: string | null | undefined
): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return s === "IN_REVIEW" || s === "READY_FOR_REVIEW" || s === "GENERATED";
}

export function pickRenderStateRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export function isCarouselSlideRegenerateInProgress(renderState: unknown): boolean {
  const rs = pickRenderStateRecord(renderState);
  if (!rs) return false;
  const phase = String(rs.phase ?? "").trim();
  const status = String(rs.status ?? "").trim().toLowerCase();
  return phase === MIMIC_CAROUSEL_SLIDE_REGENERATE_PHASE && status === "pending";
}

export function carouselSlideRegenerateSummary(renderState: unknown): {
  active: boolean;
  failed: boolean;
  status: string | null;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
} {
  const rs = pickRenderStateRecord(renderState);
  if (!rs || String(rs.phase ?? "").trim() !== MIMIC_CAROUSEL_SLIDE_REGENERATE_PHASE) {
    return {
      active: false,
      failed: false,
      status: null,
      error: null,
      requested_at: null,
      completed_at: null,
      slide_indices: null,
    };
  }
  const status = String(rs.status ?? "").trim().toLowerCase();
  const slideRaw = rs.slide_indices;
  const slide_indices =
    slideRaw === "all"
      ? "all"
      : Array.isArray(slideRaw)
        ? slideRaw.map((n) => String(n)).join(", ")
        : slideRaw != null
          ? String(slideRaw)
          : null;
  return {
    active: status === "pending",
    failed: status === "failed",
    status: status || null,
    error: typeof rs.error === "string" ? rs.error : null,
    requested_at: typeof rs.requested_at === "string" ? rs.requested_at : null,
    completed_at: typeof rs.completed_at === "string" ? rs.completed_at : null,
    slide_indices,
  };
}
