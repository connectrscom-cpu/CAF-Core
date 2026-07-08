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
import { kindPipelineLabel, type ReviewBackgroundJobStep } from "@/lib/review-background-job-detail";
import { taskReviewHref } from "@/lib/task-links";

function taskHref(job: ReviewBackgroundJob): string {
  return taskReviewHref("t", job.taskId, job.project);
}

function statusIcon(job: ReviewBackgroundJob): string {
  if (job.status === "pending") return "…";
  if (job.status === "done") return "✓";
  return "!";
}

function stepIcon(step: ReviewBackgroundJobStep): string {
  if (step.status === "done") return "✓";
  if (step.status === "failed") return "✕";
  if (step.status === "active") return "●";
  return "○";
}

function progressPercent(done: number | null, total: number | null): number | null {
  if (done == null || total == null || total <= 0) return null;
  return Math.min(100, Math.round((done / total) * 100));
}

export function ReviewBackgroundJobToasts() {
  const [jobs, setJobs] = useState<ReviewBackgroundJob[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      {visible.map((job) => {
        const expanded = expandedId === job.id;
        const detail = job.detail;
        const summary =
          job.status === "pending"
            ? job.message ??
              "Running in the background — you can leave this page. We'll notify you when it's done."
            : job.message ?? (job.status === "done" ? "Finished." : "Failed.");
        const pct = progressPercent(detail?.progressDone ?? null, detail?.progressTotal ?? null);

        return (
          <div
            key={job.id}
            className={`review-job-toast review-job-toast--${job.status}${expanded ? " review-job-toast--expanded" : ""}`}
          >
            <div className="review-job-toast__icon" aria-hidden>
              {job.status === "pending" ? <span className="review-job-toast__spinner" /> : statusIcon(job)}
            </div>
            <div className="review-job-toast__main">
              <button
                type="button"
                className="review-job-toast__toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedId((prev) => (prev === job.id ? null : job.id))}
              >
                <p className="review-job-toast__title">{job.label}</p>
                <p className="review-job-toast__message">{summary}</p>
                {!expanded ? (
                  <span className="review-job-toast__hint">Click for behind-the-scenes details</span>
                ) : null}
              </button>

              {expanded ? (
                <div className="review-job-toast__detail">
                  <p className="review-job-toast__detail-headline">
                    {detail?.headline ?? kindPipelineLabel(job.kind)}
                  </p>
                  {detail?.progressLabel ? (
                    <p className="review-job-toast__detail-progress">{detail.progressLabel}</p>
                  ) : null}
                  {pct != null ? (
                    <div className="review-job-toast__progress" aria-hidden>
                      <div className="review-job-toast__progress-bar" style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  {detail?.steps?.length ? (
                    <ol className="review-job-toast__steps">
                      {detail.steps.map((step) => (
                        <li
                          key={step.id}
                          className={`review-job-toast__step review-job-toast__step--${step.status}`}
                        >
                          <span className="review-job-toast__step-icon" aria-hidden>
                            {stepIcon(step)}
                          </span>
                          <span className="review-job-toast__step-body">
                            <span className="review-job-toast__step-label">{step.label}</span>
                            {step.hint ? (
                              <span className="review-job-toast__step-hint">{step.hint}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {detail?.facts?.length ? (
                    <dl className="review-job-toast__facts">
                      {detail.facts.map((fact) => (
                        <div key={fact.label} className="review-job-toast__fact">
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {detail?.error ? (
                    <p className="review-job-toast__detail-error">{detail.error}</p>
                  ) : null}
                  <Link className="review-job-toast__link" href={taskHref(job)}>
                    Open task
                  </Link>
                </div>
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
        );
      })}
    </div>
  );
}
