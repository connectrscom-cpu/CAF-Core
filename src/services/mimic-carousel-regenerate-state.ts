import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { pickRenderStateRecord } from "../domain/mimic-text-overlay-reprint.js";

export type CarouselRegenerateSlideStatus = "pending" | "rendering" | "completed" | "failed";

export type CarouselRegenerateState = {
  status: "in_progress" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  slide_indices: number[];
  slides: Record<string, CarouselRegenerateSlideStatus>;
  done_count: number;
  failed_count: number;
  error?: string | null;
};

async function readRenderState(db: Pool, jobId: string): Promise<Record<string, unknown>> {
  const row = await qOne<{ render_state: unknown }>(
    db,
    `SELECT render_state FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  return pickRenderStateRecord(row?.render_state) ?? {};
}

async function writeRenderStateMerge(db: Pool, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const current = await readRenderState(db, jobId);
  await db.query(
    `UPDATE caf_core.content_jobs
     SET render_state = COALESCE(render_state, '{}'::jsonb) || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify({ ...current, ...patch }), jobId]
  );
}

export function initCarouselRegenerateState(slideIndices1Based: number[]): CarouselRegenerateState {
  const indices = [...new Set(slideIndices1Based.map((i) => Math.floor(i)).filter((i) => i >= 1))].sort(
    (a, b) => a - b
  );
  const slides: Record<string, CarouselRegenerateSlideStatus> = {};
  for (const i of indices) slides[String(i)] = "pending";
  return {
    status: "in_progress",
    started_at: new Date().toISOString(),
    slide_indices: indices,
    slides,
    done_count: 0,
    failed_count: 0,
    error: null,
  };
}

export async function markCarouselRegenerateStarted(
  db: Pool,
  jobId: string,
  slideIndices1Based: number[]
): Promise<void> {
  const carousel_regenerate = initCarouselRegenerateState(slideIndices1Based);
  await writeRenderStateMerge(db, jobId, {
    carousel_regenerate,
    status: "pending",
    phase: "carousel_slide_regenerate",
  });
}

export async function markCarouselRegenerateSlideProgress(
  db: Pool,
  jobId: string,
  slideIndex1Based: number,
  slideStatus: CarouselRegenerateSlideStatus
): Promise<void> {
  const rs = await readRenderState(db, jobId);
  const raw = rs.carousel_regenerate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const state = { ...(raw as CarouselRegenerateState) };
  const slides = { ...(state.slides ?? {}) };
  slides[String(slideIndex1Based)] = slideStatus;
  state.slides = slides;
  const values = Object.values(slides);
  state.done_count = values.filter((s) => s === "completed").length;
  state.failed_count = values.filter((s) => s === "failed").length;
  await writeRenderStateMerge(db, jobId, { carousel_regenerate: state });
}

export async function markCarouselRegenerateFinished(
  db: Pool,
  jobId: string,
  ok: boolean,
  error?: string | null
): Promise<void> {
  const rs = await readRenderState(db, jobId);
  const raw = rs.carousel_regenerate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const state = { ...(raw as CarouselRegenerateState) };
  state.status = ok ? "completed" : "failed";
  state.completed_at = new Date().toISOString();
  if (error) state.error = error;
  await writeRenderStateMerge(db, jobId, {
    carousel_regenerate: state,
    status: ok ? "completed" : "failed",
    phase: "carousel_slide_regenerate",
    ...(error ? { error } : {}),
  });
}

export function pickCarouselRegenerateState(renderState: unknown): CarouselRegenerateState | null {
  const rs = pickRenderStateRecord(renderState);
  const raw = rs?.carousel_regenerate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as CarouselRegenerateState;
}
