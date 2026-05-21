import type { RunStatus } from "../repositories/runs.js";

export type JobStatusCounts = Record<string, number>;

export interface RunStageProgress {
  done: number;
  total: number;
}

/** Jobs with an LLM package ready (GENERATED or any downstream state). */
const PACKAGE_READY_STATUSES = [
  "GENERATED",
  "RENDERING",
  "IN_REVIEW",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_EDIT",
  "FAILED",
  "BLOCKED",
  "QC_FAILED",
] as const;

/** Jobs that finished rendering and are in (or past) human review. */
const RENDER_DONE_STATUSES = [
  "IN_REVIEW",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "NEEDS_EDIT",
  "FAILED",
  "BLOCKED",
  "QC_FAILED",
] as const;

/** Jobs with a human editorial decision recorded. */
const REVIEW_DONE_STATUSES = ["APPROVED", "REJECTED", "NEEDS_EDIT"] as const;

function countStatus(counts: JobStatusCounts, status: string): number {
  return counts[status] ?? 0;
}

function sumStatuses(counts: JobStatusCounts, statuses: readonly string[]): number {
  return statuses.reduce((sum, s) => sum + countStatus(counts, s), 0);
}

function totalFromCounts(counts: JobStatusCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * Stage-aware jobs counter for the admin Runs table.
 *
 * - Before Generate: all PLANNED → total/total
 * - During Generate: GENERATED+ downstream count → 0…total/total
 * - Before Render: all GENERATED → total/total
 * - During Render: IN_REVIEW+ count → 0…total/total
 * - During Review: APPROVED|REJECTED|NEEDS_EDIT count (all IN_REVIEW waiting → total/total)
 */
export function computeRunStageProgress(
  runStatus: RunStatus | string,
  counts: JobStatusCounts,
  plannedTotalJobs: number
): RunStageProgress {
  const jobTotal = totalFromCounts(counts);
  const total = Math.max(plannedTotalJobs, jobTotal);
  if (total <= 0) return { done: 0, total: 0 };

  const planned = countStatus(counts, "PLANNED");
  const generating = countStatus(counts, "GENERATING");
  const generated = countStatus(counts, "GENERATED");
  const rendering = countStatus(counts, "RENDERING");
  const inReview = countStatus(counts, "IN_REVIEW") + countStatus(counts, "READY_FOR_REVIEW");
  const packageReady = sumStatuses(counts, PACKAGE_READY_STATUSES);
  const renderDone = sumStatuses(counts, RENDER_DONE_STATUSES);
  const reviewed = sumStatuses(counts, REVIEW_DONE_STATUSES);

  const status = String(runStatus ?? "").toUpperCase();

  switch (status) {
    case "CREATED":
    case "PLANNING":
      return { done: 0, total };
    case "PLANNED":
      return { done: planned + generating + packageReady, total };
    case "GENERATING":
      if (packageReady === 0 && generating === 0 && planned === total) {
        return { done: total, total };
      }
      return { done: packageReady, total };
    case "RENDERING":
      if (renderDone === 0 && rendering === 0 && generated === total) {
        return { done: total, total };
      }
      return { done: renderDone, total };
    case "REVIEWING":
      if (reviewed === 0 && inReview === total) {
        return { done: total, total };
      }
      return { done: reviewed, total };
    case "COMPLETED":
      return { done: total, total };
    case "FAILED":
    case "CANCELLED":
      return { done: packageReady, total };
    default:
      return { done: packageReady, total };
  }
}
