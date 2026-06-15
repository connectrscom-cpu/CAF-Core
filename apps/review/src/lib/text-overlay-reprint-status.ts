export type TextOverlayReprintUiState = {
  active: boolean;
  failed: boolean;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
};

function renderStateRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Mirror Core `textOverlayReprintSummary` for Review UI. */
export function textOverlayReprintUiState(renderState: unknown): TextOverlayReprintUiState {
  const rs = renderStateRecord(renderState);
  if (!rs || String(rs.phase ?? "").trim() !== "text_overlay_reprint") {
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
      ? "all slides"
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

export function textOverlayReprintBannerMessage(state: TextOverlayReprintUiState): string | null {
  if (state.active) {
    const slides = state.slide_indices ? ` (${state.slide_indices})` : "";
    return `Text overlay reprint in progress${slides} — job stays in review. Refresh preview in a minute.`;
  }
  if (state.failed && state.error) {
    return `Text overlay reprint failed: ${state.error}`;
  }
  if (state.completed_at && !state.active && !state.failed) {
    const when = new Date(state.completed_at);
    const label = Number.isFinite(when.getTime()) ? when.toLocaleString() : state.completed_at;
    return `Last text overlay reprint completed ${label}.`;
  }
  if (state.requested_at && !state.active && !state.failed && !state.completed_at) {
    return "Text overlay reprint was requested — waiting for render worker.";
  }
  return null;
}
