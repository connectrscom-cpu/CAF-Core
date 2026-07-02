"use client";

import { useState } from "react";
import {
  marketerRenderFailureHeadline,
  parseFailedSlideFromError,
} from "@/lib/slide-render-status";

export interface RenderFailureBannerProps {
  headline?: string;
  technical: string | null;
  failedSlide?: number | null;
  kind?: "text_reprint" | "image_regen" | "job";
  active?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  retryBusy?: boolean;
}

export function RenderFailureBanner({
  headline,
  technical,
  failedSlide,
  kind = "job",
  active = false,
  onRetry,
  retryLabel = "Retry",
  retryBusy = false,
}: RenderFailureBannerProps) {
  const [open, setOpen] = useState(false);
  const slide = failedSlide ?? parseFailedSlideFromError(technical);
  const title =
    headline ??
    marketerRenderFailureHeadline({
      failedSlide: slide,
      kind,
    });

  if (!title && !technical) return null;

  return (
    <div
      className={`task-reprint-banner${active ? " task-reprint-banner--active" : " task-reprint-banner--failed"}`}
      role="status"
    >
      <div className="render-failure-banner__main">
        <p className="render-failure-banner__headline">{title}</p>
        {technical ? (
          <button
            type="button"
            className="render-failure-banner__diag-toggle btn-ghost btn-sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide technical details" : "Show technical details"}
          </button>
        ) : null}
        {onRetry ? (
          <button type="button" className="btn-primary btn-sm" disabled={retryBusy} onClick={onRetry}>
            {retryBusy ? "Retrying…" : retryLabel}
          </button>
        ) : null}
      </div>
      {open && technical ? (
        <pre className="render-failure-banner__diag">{technical}</pre>
      ) : null}
    </div>
  );
}
