/** `render_state.phase` while mimic carousel copy is being recomposited on stored plates. */
export const MIMIC_TEXT_OVERLAY_REPRINT_PHASE = "text_overlay_reprint";

/** Job statuses that should stay in the human review queue during text-only reprint. */
export function isReviewRetainStatusDuringTextOverlayReprint(status: string | null | undefined): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return s === "IN_REVIEW" || s === "READY_FOR_REVIEW" || s === "GENERATED";
}

export function pickRenderStateRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export function isTextOverlayReprintInProgress(renderState: unknown): boolean {
  const rs = pickRenderStateRecord(renderState);
  if (!rs) return false;
  const phase = String(rs.phase ?? "").trim();
  const status = String(rs.status ?? "").trim().toLowerCase();
  return phase === MIMIC_TEXT_OVERLAY_REPRINT_PHASE && status === "pending";
}

function looksLikeTextOverlayReprintRenderState(rs: Record<string, unknown>): boolean {
  const phase = String(rs.phase ?? "").trim();
  if (phase === MIMIC_TEXT_OVERLAY_REPRINT_PHASE) return true;
  const requestedAt = typeof rs.requested_at === "string" ? rs.requested_at.trim() : "";
  const failedAt = typeof rs.failed_at === "string" ? rs.failed_at.trim() : "";
  return Boolean(requestedAt || failedAt);
}

export function textOverlayReprintSummary(renderState: unknown): {
  active: boolean;
  failed: boolean;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
} {
  const rs = pickRenderStateRecord(renderState);
  if (!rs || !looksLikeTextOverlayReprintRenderState(rs)) {
    return {
      active: false,
      failed: false,
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
    error: typeof rs.error === "string" ? rs.error : null,
    requested_at: typeof rs.requested_at === "string" ? rs.requested_at : null,
    completed_at: typeof rs.completed_at === "string" ? rs.completed_at : null,
    slide_indices,
  };
}
