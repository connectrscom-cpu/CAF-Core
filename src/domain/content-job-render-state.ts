/**
 * Typed readers for `content_jobs.render_state`.
 *
 * `render_state` is a JSONB column holding provider-specific progress for the
 * current render (HeyGen, Sora, scene pipeline). Two things matter here:
 *
 *   1. **Safe extraction** — the column can be `null`, an array, a number, or
 *      a well-formed object. The pipeline currently repeats this guard a dozen
 *      times with `typeof === "object" && !Array.isArray(...)`. Centralizing it
 *      removes drift.
 *   2. **Provider idempotency** — the pipeline must NOT re-submit a HeyGen
 *      render when a `video_id` or `session_id` is already persisted
 *      (see comments in `src/services/job-pipeline.ts`). That rule lives in a
 *      local helper today; promoting it to a named function makes it a
 *      grep-able invariant and lets future code reuse the check without
 *      copy-pasting the field names.
 *
 * This module is DB-free. It takes a `render_state` value (whatever the pool
 * gave us) and returns structured information.
 */

/** Narrow view of the persisted render state. All fields are optional. */
export interface RenderStateView {
  /** Lower-cased `phase` if present (e.g. "starting", "submitted", "polling"). */
  phase: string;
  /** Provider video id when the provider has already accepted the job. */
  video_id: string;
  /** Provider session id when applicable. */
  session_id: string;
  /** Raw object for callers that need other keys (e.g. slide_index). */
  raw: Record<string, unknown>;
}

/** Safe extraction: null/array/primitive → empty view. */
export function pickRenderState(
  renderState: unknown
): RenderStateView {
  const raw =
    renderState && typeof renderState === "object" && !Array.isArray(renderState)
      ? (renderState as Record<string, unknown>)
      : {};
  return {
    phase: String(raw.phase ?? "").trim().toLowerCase(),
    video_id: String(raw.video_id ?? "").trim(),
    session_id: String(raw.session_id ?? "").trim(),
    raw,
  };
}

/**
 * True when a provider (HeyGen/Sora) has already accepted this job and we
 * must NOT re-submit. The pipeline uses this to avoid double-billing and
 * orphan videos on worker retries.
 *
 * Rule (from `job-pipeline.ts` comments):
 *   - `video_id` set → provider owns this render
 *   - `session_id` set → provider owns this render
 */
export function hasActiveProviderSession(renderState: unknown): boolean {
  const v = pickRenderState(renderState);
  return v.video_id !== "" || v.session_id !== "";
}

/**
 * True when the current render phase implies the provider *should* already
 * hold a resume key. Re-entering these phases without a `video_id` /
 * `session_id` usually means the worker died mid-submit; the caller may
 * choose to fail-fast or to start fresh.
 */
export function isMidProviderPhase(phase: string): boolean {
  const p = (phase || "").toLowerCase();
  return p === "submitted" || p === "polling" || p === "sora_polling";
}
