import { buildReviewBackgroundJobDetail, type ReviewBackgroundJobDetail } from "@/lib/review-background-job-detail";
import { taskApiQuery, LONG_TASK_ID_PATH_THRESHOLD } from "@/lib/task-links";
import { resolveTextOverlayReprintUiState } from "@/lib/text-overlay-reprint-status";

export type { ReviewBackgroundJobDetail } from "@/lib/review-background-job-detail";

export type ReviewBackgroundJobKind = "text_reprint" | "image_regenerate";

export type ReviewBackgroundJobStatus = "pending" | "done" | "failed";

export type ReviewBackgroundJob = {
  id: string;
  kind: ReviewBackgroundJobKind;
  taskId: string;
  project: string;
  label: string;
  slideIndices?: number[];
  startedAt: string;
  status: ReviewBackgroundJobStatus;
  message?: string;
  /** Carousel asset public_url by position (0-based) at job start — image regen only. */
  baselineAssetUrls?: Record<number, string>;
  /** Live status from the poller — shown when the toast is expanded. */
  detail?: ReviewBackgroundJobDetail;
};

const STORAGE_KEY = "caf-review-background-jobs";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;

export const REVIEW_JOBS_CHANGED_EVENT = "caf-review-jobs-changed";
export const REVIEW_JOB_COMPLETED_EVENT = "caf-review-job-completed";

function newJobId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function loadReviewBackgroundJobs(): ReviewBackgroundJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReviewBackgroundJob[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((job) => {
      const t = Date.parse(job.startedAt);
      return Number.isFinite(t) && t >= cutoff;
    });
  } catch {
    return [];
  }
}

function saveReviewBackgroundJobs(jobs: ReviewBackgroundJob[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function notifyJobsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REVIEW_JOBS_CHANGED_EVENT));
}

function notifyJobCompleted(job: ReviewBackgroundJob): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(REVIEW_JOB_COMPLETED_EVENT, {
      detail: { taskId: job.taskId, project: job.project, kind: job.kind },
    })
  );
}

export function dismissReviewBackgroundJob(id: string): void {
  const next = loadReviewBackgroundJobs().filter((job) => job.id !== id);
  saveReviewBackgroundJobs(next);
  notifyJobsChanged();
}

export function slideIndicesLabel(indices: number[] | undefined, allLabel = "all slides"): string {
  if (!indices || indices.length === 0) return allLabel;
  if (indices.length === 1) return `slide ${indices[0]}`;
  return `slides ${indices.join(", ")}`;
}

async function snapshotCarouselAssetUrls(
  taskId: string,
  project: string,
  slideIndices?: number[]
): Promise<Record<number, string>> {
  const qs = taskApiQuery(taskId, project);
  const res = await fetch(`/api/task/assets?${qs}`, { cache: "no-store" });
  if (!res.ok) return {};
  const json = (await res.json()) as {
    assets?: Array<{ asset_type?: string | null; public_url?: string | null; position: number }>;
  };
  const targets =
    slideIndices && slideIndices.length > 0 ? new Set(slideIndices.map((i) => i - 1)) : null;
  const out: Record<number, string> = {};
  for (const asset of json.assets ?? []) {
    const pos = asset.position;
    if (targets && !targets.has(pos)) continue;
    const type = String(asset.asset_type ?? "").toLowerCase();
    if (
      type !== "carousel_slide" &&
      type !== "mimic_background" &&
      type !== "mimic_visual_plate"
    ) {
      continue;
    }
    const url = String(asset.public_url ?? "").trim();
    if (url) out[pos] = url;
  }
  return out;
}

export async function registerReviewBackgroundJob(input: {
  kind: ReviewBackgroundJobKind;
  taskId: string;
  project: string;
  slideIndices?: number[];
  startedMessage?: string;
}): Promise<ReviewBackgroundJob> {
  const label =
    input.kind === "text_reprint"
      ? `Text reprint · ${slideIndicesLabel(input.slideIndices)}`
      : `Image regenerate · ${slideIndicesLabel(input.slideIndices)}`;

  const baselineAssetUrls =
    input.kind === "image_regenerate" || input.kind === "text_reprint"
      ? await snapshotCarouselAssetUrls(input.taskId, input.project, input.slideIndices)
      : undefined;

  const job: ReviewBackgroundJob = {
    id: newJobId(),
    kind: input.kind,
    taskId: input.taskId.trim(),
    project: input.project.trim(),
    label,
    slideIndices: input.slideIndices,
    startedAt: new Date().toISOString(),
    status: "pending",
    message: input.startedMessage,
    baselineAssetUrls,
  };

  const jobs = loadReviewBackgroundJobs().filter(
    (row) =>
      !(
        row.status === "pending" &&
        row.taskId === job.taskId &&
        row.kind === job.kind &&
        JSON.stringify(row.slideIndices ?? []) === JSON.stringify(job.slideIndices ?? [])
      )
  );
  jobs.push(job);
  saveReviewBackgroundJobs(jobs);
  notifyJobsChanged();
  return job;
}

function patchReviewBackgroundJob(id: string, patch: Partial<ReviewBackgroundJob>): void {
  const jobs = loadReviewBackgroundJobs();
  const idx = jobs.findIndex((job) => job.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx]!, ...patch };
  saveReviewBackgroundJobs(jobs);
  notifyJobsChanged();
}

function finishJob(id: string, status: ReviewBackgroundJobStatus, message: string): void {
  const jobs = loadReviewBackgroundJobs();
  const idx = jobs.findIndex((job) => job.id === id);
  if (idx < 0) return;
  const job = { ...jobs[idx]!, status, message };
  jobs[idx] = job;
  saveReviewBackgroundJobs(jobs);
  notifyJobsChanged();
  if (status === "done") notifyJobCompleted(job);
}

export type TextReprintPollState = {
  active: boolean;
  failed: boolean;
  status: string | null;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
  slide_index: number | null;
  slide_total: number | null;
  deck_slide_index: number | null;
};

function parseTextReprintSlideProgress(renderState: unknown): {
  slide_index: number;
  slide_total: number;
  deck_slide_index: number | null;
} | null {
  const rs =
    renderState && typeof renderState === "object" && !Array.isArray(renderState)
      ? (renderState as Record<string, unknown>)
      : null;
  if (!rs) return null;
  const deck_slide_index = Math.floor(Number(rs.slide_index));
  const batch_total = Math.floor(Number(rs.slide_batch_total));
  const batch_index = Math.floor(Number(rs.slide_batch_index));
  if (Number.isFinite(batch_total) && batch_total >= 1 && Number.isFinite(batch_index) && batch_index >= 1) {
    return {
      slide_index: batch_index,
      slide_total: batch_total,
      deck_slide_index: Number.isFinite(deck_slide_index) && deck_slide_index >= 1 ? deck_slide_index : null,
    };
  }
  const slide_total = Math.floor(Number(rs.slide_total));
  const slide_index = Math.floor(Number(rs.slide_index));
  if (!Number.isFinite(slide_total) || slide_total < 1) return null;
  if (!Number.isFinite(slide_index) || slide_index < 1) return null;
  return { slide_index, slide_total, deck_slide_index: null };
}

function parseTaskReprintState(
  data: Record<string, string | undefined>,
  renderState?: unknown
): TextReprintPollState {
  const resolved = resolveTextOverlayReprintUiState(renderState, data);
  const slideProgress = parseTextReprintSlideProgress(renderState);
  const status = (resolved.status ?? data.text_overlay_reprint_status ?? "").trim().toLowerCase() || null;
  const active =
    resolved.active ||
    data.text_overlay_reprint_active === "true" ||
    (status === "pending" && Boolean(resolved.requested_at || slideProgress));
  return {
    active,
    failed: resolved.failed || data.text_overlay_reprint_active === "failed" || status === "failed",
    status,
    error: resolved.error ?? data.text_overlay_reprint_error ?? null,
    requested_at: resolved.requested_at ?? data.text_overlay_reprint_requested_at ?? null,
    completed_at: resolved.completed_at ?? data.text_overlay_reprint_completed_at ?? null,
    slide_indices: resolved.slide_indices ?? data.text_overlay_reprint_slides ?? null,
    slide_index: slideProgress?.slide_index ?? null,
    slide_total: slideProgress?.slide_total ?? null,
    deck_slide_index: slideProgress?.deck_slide_index ?? null,
  };
}

function parseTaskRegenState(data: Record<string, string | undefined>) {
  const status = (data.carousel_regenerate_status ?? "").trim().toLowerCase() || null;
  return {
    active: data.carousel_regenerate_active === "true",
    failed: data.carousel_regenerate_active === "failed" || status === "failed",
    status,
    error: data.carousel_regenerate_error ?? null,
    done: Number(data.carousel_regenerate_done ?? 0),
    total: Number(data.carousel_regenerate_total ?? 0),
  };
}

async function fetchTaskAssetsForJob(
  taskId: string,
  project: string,
  slideIndices?: number[]
): Promise<Record<number, string>> {
  const qs = taskApiQuery(taskId, project);
  const res = await fetch(`/api/task/assets?${qs}`, { cache: "no-store" });
  if (!res.ok) return {};
  const json = (await res.json()) as {
    assets?: Array<{ asset_type?: string | null; public_url?: string | null; position: number }>;
  };
  return assetUrlsForSlides(json.assets ?? [], slideIndices);
}

function applyJobDetail(
  job: ReviewBackgroundJob,
  input: {
    reprintState?: TextReprintPollState | null;
    regenState?: ReturnType<typeof parseTaskRegenState> | null;
    currentAssetUrls?: Record<number, string>;
  }
): void {
  const detail = buildReviewBackgroundJobDetail({
    job,
    reprintState: input.reprintState ?? null,
    regenState: input.regenState ?? null,
    currentAssetUrls: input.currentAssetUrls ?? {},
  });
  const message =
    job.status === "pending" && detail.progressLabel ? detail.progressLabel : job.message;
  patchReviewBackgroundJob(job.id, { detail, ...(message ? { message } : {}) });
}

function reprintRequestedAfterJobStart(requestedAt: string | null, startedMs: number): boolean {
  if (!requestedAt) return false;
  const reqMs = Date.parse(requestedAt);
  return Number.isFinite(reqMs) && reqMs >= startedMs - 5000;
}

function textReprintLooksComplete(
  job: ReviewBackgroundJob,
  state: TextReprintPollState,
  startedMs: number
): boolean {
  if (state.failed) return false;
  if (state.status === "completed") {
    if (reprintRequestedAfterJobStart(state.requested_at, startedMs)) return true;
    if (state.completed_at) {
      const completedMs = Date.parse(state.completed_at);
      if (Number.isFinite(completedMs) && completedMs >= startedMs - 5000) return true;
    }
  }
  if (!state.active && state.completed_at && reprintRequestedAfterJobStart(state.requested_at, startedMs)) {
    return true;
  }
  return false;
}

function assetUrlsForSlides(
  assets: Array<{ asset_type?: string | null; public_url?: string | null; position: number }>,
  slideIndices?: number[]
): Record<number, string> {
  const targets =
    slideIndices && slideIndices.length > 0 ? new Set(slideIndices.map((i) => i - 1)) : null;
  const out: Record<number, string> = {};
  for (const asset of assets) {
    const pos = asset.position;
    if (targets && !targets.has(pos)) continue;
    const type = String(asset.asset_type ?? "").toLowerCase();
    if (
      type !== "carousel_slide" &&
      type !== "mimic_background" &&
      type !== "mimic_visual_plate"
    ) {
      continue;
    }
    const url = String(asset.public_url ?? "").trim();
    if (url) out[pos] = url;
  }
  return out;
}

function imageRegenLooksComplete(
  job: ReviewBackgroundJob,
  current: Record<number, string>
): boolean {
  const baseline = job.baselineAssetUrls ?? {};
  const positions =
    job.slideIndices && job.slideIndices.length > 0
      ? job.slideIndices.map((i) => i - 1)
      : Object.keys(current).map((k) => Number(k));

  if (positions.length === 0) {
    return Object.keys(current).length > 0 && JSON.stringify(current) !== JSON.stringify(baseline);
  }

  let changed = 0;
  for (const pos of positions) {
    const nextUrl = current[pos] ?? "";
    const prevUrl = baseline[pos] ?? "";
    if (nextUrl && nextUrl !== prevUrl) changed += 1;
  }
  return changed >= positions.length;
}

async function pollReviewBackgroundJob(job: ReviewBackgroundJob): Promise<void> {
  const startedMs = Date.parse(job.startedAt);
  if (!Number.isFinite(startedMs)) {
    finishJob(job.id, "failed", "Invalid job timestamp.");
    return;
  }
  if (Date.now() - startedMs > POLL_TIMEOUT_MS) {
    finishJob(
      job.id,
      "failed",
      "Still running after 12 minutes — open the task and refresh the preview manually."
    );
    return;
  }

  const qs = taskApiQuery(job.taskId, job.project);
  const taskPath =
    job.taskId.length >= LONG_TASK_ID_PATH_THRESHOLD
      ? `/api/task?${qs}&include_job=1`
      : `/api/task/${encodeURIComponent(job.taskId)}?${qs}&include_job=1`;

  const taskRes = await fetch(taskPath, { cache: "no-store" });
  if (!taskRes.ok) return;
  const taskJson = (await taskRes.json()) as {
    data?: Record<string, string | undefined>;
    job?: { render_state?: unknown };
  };
  const taskData = taskJson.data ?? {};
  const renderState = taskJson.job?.render_state;
  const currentAssets = await fetchTaskAssetsForJob(job.taskId, job.project, job.slideIndices);

  if (job.kind === "text_reprint") {
    const state = parseTaskReprintState(taskData, renderState);
    applyJobDetail(job, { reprintState: state, currentAssetUrls: currentAssets });
    if (state.failed) {
      finishJob(job.id, "failed", state.error ?? "Text reprint failed.");
      return;
    }
    if (textReprintLooksComplete(job, state, startedMs)) {
      finishJob(job.id, "done", `${job.label} finished — refresh the preview to see updates.`);
    }
    return;
  }

  const regenState = parseTaskRegenState(taskData);
  applyJobDetail(job, { regenState, currentAssetUrls: currentAssets });

  if (regenState.failed) {
    finishJob(job.id, "failed", regenState.error ?? "Image regenerate failed.");
    return;
  }
  if (regenState.active && regenState.total > 0 && regenState.done >= regenState.total) {
    finishJob(job.id, "done", `${job.label} finished — ${regenState.done}/${regenState.total} slides updated.`);
    return;
  }
  if (regenState.status === "completed") {
    finishJob(job.id, "done", `${job.label} finished — new images are ready.`);
    return;
  }

  if (imageRegenLooksComplete(job, currentAssets)) {
    finishJob(job.id, "done", `${job.label} finished — new images are ready.`);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function ensureReviewBackgroundJobPoller(): void {
  if (typeof window === "undefined" || pollTimer) return;
  const tick = () => {
    const pending = loadReviewBackgroundJobs().filter((job) => job.status === "pending");
    for (const job of pending) {
      void pollReviewBackgroundJob(job).catch(() => {
        /* next tick */
      });
    }
  };
  void tick();
  pollTimer = setInterval(tick, 5_000);
}
