/** UI state for `render_state.carousel_regenerate` on mimic slide image regen. */

export type CarouselRegenerateUiState = {
  active: boolean;
  failed: boolean;
  status: string | null;
  error: string | null;
  done_count: number;
  failed_count: number;
  total: number;
  slides: Record<string, string>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function carouselRegenerateUiState(renderState: unknown): CarouselRegenerateUiState {
  const rs = asRecord(renderState);
  const raw = asRecord(rs?.carousel_regenerate);
  if (!raw) {
    return {
      active: false,
      failed: false,
      status: null,
      error: null,
      done_count: 0,
      failed_count: 0,
      total: 0,
      slides: {},
    };
  }
  const status = String(raw.status ?? "").trim();
  const slidesRaw = raw.slides;
  const slides: Record<string, string> = {};
  if (slidesRaw && typeof slidesRaw === "object" && !Array.isArray(slidesRaw)) {
    for (const [k, v] of Object.entries(slidesRaw as Record<string, unknown>)) {
      slides[k] = String(v ?? "");
    }
  }
  const indices = Array.isArray(raw.slide_indices)
    ? raw.slide_indices.map((n) => Math.floor(Number(n))).filter((n) => n >= 1)
    : Object.keys(slides).map((k) => Number(k)).filter((n) => n >= 1);
  const done = typeof raw.done_count === "number" ? raw.done_count : 0;
  const failedCount = typeof raw.failed_count === "number" ? raw.failed_count : 0;
  return {
    active: status === "in_progress",
    failed: status === "failed",
    status: status || null,
    error: typeof raw.error === "string" ? raw.error : null,
    done_count: done,
    failed_count: failedCount,
    total: indices.length || Object.keys(slides).length,
    slides,
  };
}

export function carouselRegenerateProgressLabel(state: CarouselRegenerateUiState): string | null {
  if (!state.active && !state.failed) return null;
  if (state.failed) {
    return state.error
      ? `Image regenerate failed: ${state.error}`
      : "Image regenerate failed — try again or regenerate one slide.";
  }
  if (state.total > 0) {
    return `Regenerating images… ${state.done_count}/${state.total} slides complete`;
  }
  return "Regenerating images…";
}
