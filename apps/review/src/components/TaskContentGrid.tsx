"use client";

import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";
import { resolveQueueRowPreview } from "@/lib/marketer/preview-resolver";
import { PreviewMediaCard } from "@/components/marketer/PreviewMediaCard";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { taskReviewHref } from "@/lib/task-links";
import {
  displayReviewStatus,
  displayTaskTitle,
  humanizePlatform,
  marketerFormatLabel,
} from "@/lib/review-queue-display";

export interface TaskContentGridProps {
  items: ReviewQueueRow[];
  contentSlug?: "t" | "content";
  showProjectColumn?: boolean;
  onRowSelect?: (row: ReviewQueueRow) => void;
  marketerMode?: boolean;
}

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

export function TaskContentGrid({
  items,
  contentSlug = "t",
  showProjectColumn = false,
  onRowSelect,
  marketerMode = false,
}: TaskContentGridProps) {
  const { navHref } = useReviewProject();

  return (
    <div className="content-grid">
      {items.map((row) => {
        const taskId = getVal(row, "task_id");
        const project = getVal(row, "project");
        const title = marketerMode ? displayTaskTitle(row) : getVal(row, "generated_title") || taskId;
        const platform = marketerMode ? humanizePlatform(getVal(row, "platform")) : getVal(row, "platform");
        const format = marketerMode ? marketerFormatLabel(row) : getVal(row, "flow_type");
        const reviewStatus = getVal(row, "review_status");
        const preview = resolveQueueRowPreview(row);
        const taskHref = navHref(
          taskReviewHref(contentSlug, taskId, showProjectColumn ? project : undefined, { marketer: marketerMode })
        );

        return (
          <article
            key={`${project}::${taskId}`}
            className="content-grid-card"
            onClick={onRowSelect ? () => onRowSelect(row) : undefined}
            role={onRowSelect ? "button" : undefined}
            tabIndex={onRowSelect ? 0 : undefined}
            onKeyDown={
              onRowSelect
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowSelect(row);
                    }
                  }
                : undefined
            }
          >
            <Link href={taskHref} className="content-grid-card__thumb" onClick={(e) => onRowSelect && e.stopPropagation()}>
              <PreviewMediaCard preview={preview} alt={title} variant="card" />
            </Link>
            <div className="content-grid-card__body">
              <Link href={taskHref} className="content-grid-card__title" onClick={(e) => onRowSelect && e.stopPropagation()}>
                {title}
              </Link>
              <p className="content-grid-card__meta">
                {platform}
                {format ? ` · ${format}` : ""}
              </p>
              <span className={`badge content-grid-card__status badge-review`}>
                {displayReviewStatus(reviewStatus, marketerMode)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
