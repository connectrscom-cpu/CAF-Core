"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  dismissReviewBackgroundJob,
  ensureReviewBackgroundJobPoller,
  loadReviewBackgroundJobs,
  REVIEW_JOBS_CHANGED_EVENT,
  type ReviewBackgroundJob,
} from "@/lib/review-background-jobs";
import { taskReviewHref } from "@/lib/task-links";

function taskHref(job: ReviewBackgroundJob): string {
  return taskReviewHref("t", job.taskId, job.project);
}

function statusIcon(job: ReviewBackgroundJob): string {
  if (job.status === "pending") return "…";
  if (job.status === "done") return "✓";
  return "!";
}

export function ReviewBackgroundJobToasts() {
  const [jobs, setJobs] = useState<ReviewBackgroundJob[]>([]);

  const refresh = useCallback(() => {
    setJobs(loadReviewBackgroundJobs());
  }, []);

  useEffect(() => {
    refresh();
    ensureReviewBackgroundJobPoller();
    window.addEventListener(REVIEW_JOBS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REVIEW_JOBS_CHANGED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const job of jobs) {
      if (job.status === "done" || job.status === "failed") {
        timers.push(
          setTimeout(() => {
            dismissReviewBackgroundJob(job.id);
          }, 12_000)
        );
      }
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [jobs]);

  const visible = jobs.filter((job) => job.status === "pending" || job.status === "done" || job.status === "failed");
  if (visible.length === 0) return null;

  return (
    <div className="review-job-toasts" aria-live="polite" aria-label="Background render jobs">
      {visible.map((job) => (
        <div
          key={job.id}
          className={`review-job-toast review-job-toast--${job.status}`}
          role="status"
        >
          <div className="review-job-toast__icon" aria-hidden>
            {job.status === "pending" ? <span className="review-job-toast__spinner" /> : statusIcon(job)}
          </div>
          <div className="review-job-toast__body">
            <p className="review-job-toast__title">{job.label}</p>
            <p className="review-job-toast__message">
              {job.status === "pending"
                ? job.message ??
                  "Running in the background — you can leave this page. We'll notify you when it's done."
                : job.message ?? (job.status === "done" ? "Finished." : "Failed.")}
            </p>
            {job.status !== "pending" ? (
              <Link className="review-job-toast__link" href={taskHref(job)}>
                Open task
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            className="review-job-toast__dismiss"
            aria-label="Dismiss"
            onClick={() => dismissReviewBackgroundJob(job.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
