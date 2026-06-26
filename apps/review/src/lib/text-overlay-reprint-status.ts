export type TextOverlayReprintUiState = {
  active: boolean;
  failed: boolean;
  /** Raw `render_state.status` while phase is text_overlay_reprint (pending | completed | failed). */
  status: string | null;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
};

const TEXT_OVERLAY_REPRINT_PHASE = "text_overlay_reprint";

function renderStateRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function formatSlideIndicesLabel(slideRaw: unknown): string | null {
  if (slideRaw === "all") return "all slides";
  if (Array.isArray(slideRaw)) return slideRaw.map((n) => String(n)).join(", ");
  if (slideRaw != null) return String(slideRaw);
  return null;
}

function looksLikeTextOverlayReprintRenderState(rs: Record<string, unknown>): boolean {
  const phase = String(rs.phase ?? "").trim();
  if (phase === TEXT_OVERLAY_REPRINT_PHASE) return true;
  const requestedAt = typeof rs.requested_at === "string" ? rs.requested_at.trim() : "";
  const failedAt = typeof rs.failed_at === "string" ? rs.failed_at.trim() : "";
  return Boolean(requestedAt || failedAt);
}

/** Mirror Core `textOverlayReprintSummary` for Review UI. */
export function textOverlayReprintUiState(renderState: unknown): TextOverlayReprintUiState {
  const rs = renderStateRecord(renderState);
  if (!rs || !looksLikeTextOverlayReprintRenderState(rs)) {
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
  const slide_indices = formatSlideIndicesLabel(rs.slide_indices);
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

export function textOverlayReprintBannerMessage(state: TextOverlayReprintUiState): string | null {
  if (state.active) {
    const slides = state.slide_indices ? ` (${state.slide_indices})` : "";
    return `Text overlay reprint in progress${slides} — job stays in review. Refresh preview in a minute.`;
  }
  if (state.failed) {
    return state.error
      ? `Text overlay reprint failed: ${state.error}`
      : "Text overlay reprint failed — open API & LLM audit for details.";
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

function reprintStateFromFlatFields(data: Record<string, string | undefined> | null | undefined): TextOverlayReprintUiState {
  const active = data?.text_overlay_reprint_active === "true";
  const failed = data?.text_overlay_reprint_active === "failed";
  if (!active && !failed && !data?.text_overlay_reprint_completed_at && !data?.text_overlay_reprint_requested_at) {
    return textOverlayReprintUiState(null);
  }
  const statusRaw = (data?.text_overlay_reprint_status ?? "").trim().toLowerCase();
  return {
    active,
    failed: failed || statusRaw === "failed",
    status: active ? "pending" : failed || statusRaw === "failed" ? "failed" : data?.text_overlay_reprint_completed_at ? "completed" : statusRaw || null,
    error: data?.text_overlay_reprint_error ?? null,
    requested_at: data?.text_overlay_reprint_requested_at ?? null,
    completed_at: data?.text_overlay_reprint_completed_at ?? null,
    slide_indices: data?.text_overlay_reprint_slides ?? null,
  };
}

/** Prefer the strongest signal between Core `render_state` and flattened task row fields. */
export function resolveTextOverlayReprintUiState(
  renderState: unknown,
  data: Record<string, string | undefined> | null | undefined
): TextOverlayReprintUiState {
  const fromRender = textOverlayReprintUiState(renderState);
  const fromFlat = reprintStateFromFlatFields(data);
  if (fromRender.failed || fromFlat.failed) {
    return fromRender.failed ? fromRender : fromFlat;
  }
  if (fromRender.active || fromFlat.active) {
    return fromRender.active ? fromRender : fromFlat;
  }
  if (fromRender.requested_at || fromFlat.requested_at) {
    return fromRender.requested_at ? fromRender : fromFlat;
  }
  if (fromRender.completed_at || fromFlat.completed_at) {
    return fromRender.completed_at ? fromRender : fromFlat;
  }
  return fromRender;
}

export function jobRenderFailureBanner(
  reviewStatus: string | null | undefined,
  renderState: unknown
): string | null {
  const status = String(reviewStatus ?? "").trim().toUpperCase();
  if (status !== "FAILED") return null;
  const rs = renderStateRecord(renderState);
  const err = typeof rs?.error === "string" ? rs.error.trim() : "";
  return err ? `Job failed: ${err}` : "Job failed during rendering — open API & LLM audit for details.";
}
