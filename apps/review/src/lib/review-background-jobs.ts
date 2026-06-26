import { taskApiQuery } from "@/lib/task-links";

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

function parseTaskReprintState(data: Record<string, string | undefined>) {
  const status = (data.text_overlay_reprint_status ?? "").trim().toLowerCase() || null;
  return {
    active: data.text_overlay_reprint_active === "true",
    failed: data.text_overlay_reprint_active === "failed" || status === "failed",
    status,
    error: data.text_overlay_reprint_error ?? null,
    requested_at: data.text_overlay_reprint_requested_at ?? null,
    completed_at: data.text_overlay_reprint_completed_at ?? null,
  };
}

function reprintRequestedAfterJobStart(requestedAt: string | null, startedMs: number): boolean {
  if (!requestedAt) return false;
  const reqMs = Date.parse(requestedAt);
  return Number.isFinite(reqMs) && reqMs >= startedMs - 5000;
}

function textReprintLooksComplete(
  job: ReviewBackgroundJob,
  state: ReturnType<typeof parseTaskReprintState>,
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

  if (job.kind === "text_reprint") {
    const res = await fetch(`/api/task?${qs}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: Record<string, string | undefined> };
    const state = parseTaskReprintState(json.data ?? {});
    if (state.failed) {
      finishJob(job.id, "failed", state.error ?? "Text reprint failed.");
      return;
    }
    if (textReprintLooksComplete(job, state, startedMs)) {
      finishJob(job.id, "done", `${job.label} finished — refresh the preview to see updates.`);
    }
    return;
  }

  const res = await fetch(`/api/task/assets?${qs}`, { cache: "no-store" });
  if (!res.ok) return;
  const json = (await res.json()) as {
    assets?: Array<{ asset_type?: string | null; public_url?: string | null; position: number }>;
  };
  const current = assetUrlsForSlides(json.assets ?? [], job.slideIndices);
  if (imageRegenLooksComplete(job, current)) {
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
