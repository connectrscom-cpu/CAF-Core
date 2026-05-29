"use client";

import { useCallback, useState } from "react";
import {
  buildTaskDebugBundle,
  formatTaskDebugBundleForClipboard,
  type TaskDebugBundleReviewerUi,
} from "@/lib/build-task-debug-bundle";
import { taskApiQuery } from "@/lib/task-links";
import type { TaskAssetPreview } from "@/lib/media-url";

export interface CopyTaskDebugBundleButtonProps {
  taskId: string;
  projectSlug: string;
  page?: "task_review" | "content_review";
  workbenchRow: Record<string, string | undefined> | null;
  fullJob: Record<string, unknown> | null;
  taskAssets: TaskAssetPreview[];
  upstreamLineage?: Record<string, unknown> | null;
  heygenSubmit?: Record<string, unknown> | null;
  /** When true, fetches mimic Qwen audit rows before copying. */
  fetchMimicAudits?: boolean;
  reviewerUi?: TaskDebugBundleReviewerUi;
  disabled?: boolean;
  /** `bar` = header row; `compact` = inline next to preview links (no helper text). */
  variant?: "bar" | "compact";
}

export function CopyTaskDebugBundleButton({
  taskId,
  projectSlug,
  page = "task_review",
  workbenchRow,
  fullJob,
  taskAssets,
  upstreamLineage,
  heygenSubmit,
  fetchMimicAudits = false,
  reviewerUi,
  disabled = false,
  variant = "bar",
}: CopyTaskDebugBundleButtonProps) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const onCopy = useCallback(async () => {
    if (!taskId.trim() || disabled) return;
    setBusy(true);
    setHint(null);
    try {
      const qs = taskApiQuery(taskId, projectSlug);
      let jobForBundle = fullJob;
      const gp = jobForBundle?.generation_payload;
      if (!gp || typeof gp !== "object") {
        const jobRes = await fetch(`/api/task/${encodeURIComponent(taskId)}?${qs}&include_job=1`, {
          cache: "no-store",
        });
        if (jobRes.ok) {
          const j = (await jobRes.json()) as { job?: Record<string, unknown> };
          if (j.job && typeof j.job === "object") jobForBundle = j.job;
        }
      }

      let lineageForBundle = upstreamLineage ?? null;
      let heygenForBundle = heygenSubmit ?? null;
      let mimicImageAudits: unknown[] | null = null;

      const extraFetches: Promise<void>[] = [];
      if (!lineageForBundle) {
        extraFetches.push(
          fetch(`/api/task/lineage?${qs}`, { cache: "no-store" }).then(async (res) => {
            if (!res.ok) return;
            const json = (await res.json()) as { lineage?: Record<string, unknown> };
            lineageForBundle = json.lineage ?? null;
          })
        );
      }
      if (!heygenForBundle) {
        extraFetches.push(
          fetch(`/api/task/heygen-prompt?${qs}`, { cache: "no-store" }).then(async (res) => {
            if (!res.ok) return;
            const json = (await res.json()) as { submit?: Record<string, unknown> };
            heygenForBundle = json.submit ?? null;
          })
        );
      }
      if (fetchMimicAudits) {
        extraFetches.push(
          fetch(`/api/task/mimic-image-audits?${qs}`, { cache: "no-store" }).then(async (res) => {
            if (!res.ok) return;
            const json = (await res.json()) as { audits?: unknown[] };
            mimicImageAudits = Array.isArray(json.audits) ? json.audits : [];
          })
        );
      }
      if (extraFetches.length > 0) await Promise.all(extraFetches);

      const bundle = buildTaskDebugBundle({
        taskId,
        projectSlug,
        page,
        workbenchRow,
        fullJob: jobForBundle,
        taskAssets,
        upstreamLineage: lineageForBundle,
        heygenSubmit: heygenForBundle,
        mimicImageAudits,
        reviewerUi,
      });
      const text = formatTaskDebugBundleForClipboard(bundle);
      await navigator.clipboard.writeText(text);
      setHint("Copied — paste into Cursor");
      window.setTimeout(() => setHint(null), 2800);
    } catch {
      setHint("Copy failed");
      window.setTimeout(() => setHint(null), 2800);
    } finally {
      setBusy(false);
    }
  }, [
    taskId,
    projectSlug,
    page,
    workbenchRow,
    fullJob,
    taskAssets,
    upstreamLineage,
    heygenSubmit,
    fetchMimicAudits,
    reviewerUi,
    disabled,
  ]);

  const label = busy ? "Gathering…" : "Copy debug bundle for Cursor";

  const button = (
    <button
      type="button"
      className="btn-primary"
      style={{ fontSize: variant === "compact" ? 12 : 13, padding: variant === "compact" ? "6px 12px" : "8px 14px" }}
      disabled={disabled || busy || !taskId.trim()}
      onClick={() => void onCopy()}
      title="Copy task_id, asset URLs, generation_payload, draft/mimic packages, validation JSON, lineage, and more for Cursor debugging"
    >
      {label}
    </button>
  );

  if (variant === "compact") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {button}
        {hint ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</span> : null}
      </span>
    );
  }

  return (
    <div className="debug-bundle-bar">
      {button}
      {hint ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>
      ) : (
        <span style={{ fontSize: 12, color: "var(--muted)", maxWidth: 420, lineHeight: 1.4 }}>
          IDs, asset URLs, generation_payload, mimic packages, QC, reviews, lineage
        </span>
      )}
    </div>
  );
}
