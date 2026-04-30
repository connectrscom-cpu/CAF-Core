"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";
import { isVideoUrl } from "@/lib/media-url";
import { formatDecisionHttpError } from "@/lib/format-decision-http-error";
import { taskReviewHref } from "@/lib/task-links";

export type GroupBy = "" | "project" | "platform" | "flow_type" | "recommended_route";

export interface TaskTableProps {
  items: ReviewQueueRow[];
  groupBy: GroupBy;
  page: number;
  limit: number;
  total: number;
  missingPreviewCount?: number;
  statusCounts?: Record<string, number>;
  contentSlug?: "t" | "content";
  /** Cross-project workbench: show tenant column and disambiguate task links. */
  showProjectColumn?: boolean;
  /** Compact mode for narrow screens/pages (e.g. Publish). */
  hideTitleColumn?: boolean;
  /** Hide the final "Open" action column (useful when rows are selectable). */
  hideOpenColumn?: boolean;
  /** When set, row click loads the row (links stop propagation). */
  onRowSelect?: (row: ReviewQueueRow) => void;
  /** `project::task_id` when `showProjectColumn`, else `task_id` — for selection highlight. */
  selectedRowKey?: string;
  /** “Waiting for Approval” tab: row-level Approve without opening the task. */
  showQuickApprove?: boolean;
  /** Called after a successful quick Approve (e.g. refresh queue). */
  onAfterDecision?: () => void;
}

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

function statusBadge(status: string) {
  const s = status.toUpperCase().replace(/\s+/g, "_");
  let cls = "badge ";
  if (s === "APPROVED") cls += "badge-approved";
  else if (s === "REJECTED") cls += "badge-rejected";
  else if (s === "NEEDS_EDIT") cls += "badge-needs-edit";
  else if (s === "IN_REVIEW" || s === "IN REVIEW") cls += "badge-review";
  else if (s === "QC" || s === "READY") cls += "badge-qc";
  else cls += "badge-review";
  return <span className={cls}>{status || "—"}</span>;
}

function TaskRow({
  row,
  contentSlug = "t",
  showProjectColumn = false,
  hideTitleColumn = false,
  hideOpenColumn = false,
  onRowSelect,
  selected = false,
  showQuickApprove = false,
  approvingTaskId = null,
  onQuickApprove,
}: {
  row: ReviewQueueRow;
  contentSlug?: "t" | "content";
  showProjectColumn?: boolean;
  hideTitleColumn?: boolean;
  hideOpenColumn?: boolean;
  onRowSelect?: (row: ReviewQueueRow) => void;
  selected?: boolean;
  showQuickApprove?: boolean;
  approvingTaskId?: string | null;
  onQuickApprove?: (row: ReviewQueueRow) => void;
}) {
  const taskId = getVal(row, "task_id");
  const project = getVal(row, "project");
  const platform = getVal(row, "platform");
  const flowType = getVal(row, "flow_type");
  const reviewStatus = getVal(row, "review_status");
  const decision = getVal(row, "decision");
  const title = getVal(row, "generated_title") || taskId;
  const thumb = getVal(row, "preview_url");
  const taskHref = taskReviewHref(contentSlug, taskId, showProjectColumn ? project : undefined);

  return (
    <tr
      onClick={onRowSelect ? () => onRowSelect(row) : undefined}
      style={{
        cursor: onRowSelect ? "pointer" : undefined,
        background: selected ? "rgba(99, 102, 241, 0.08)" : undefined,
      }}
    >
      <td className="task-thumb-cell" style={{ width: 72, verticalAlign: "middle" }}>
        {thumb ? (
          isVideoUrl(thumb) ? (
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                objectFit: "cover",
                background: "#111",
                display: "block",
              }}
            />
          ) : (
            <img
              src={thumb}
              alt=""
              width={56}
              height={56}
              style={{ borderRadius: 8, objectFit: "cover", display: "block", background: "#111" }}
              referrerPolicy="no-referrer"
            />
          )
        ) : (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
        )}
      </td>
      <td className="task-id-cell">
        <Link href={taskHref} onClick={(e) => onRowSelect && e.stopPropagation()}>
          {taskId}
        </Link>
      </td>
      {showProjectColumn && <td>{project || "—"}</td>}
      {!hideTitleColumn && (
        <td className="hook-cell" title={title}>
          {title}
        </td>
      )}
      <td>{platform || "—"}</td>
      <td>{flowType || "—"}</td>
      <td>{statusBadge(reviewStatus)}</td>
      <td>{decision ? statusBadge(decision) : "—"}</td>
      <td>{getVal(row, "recommended_route") || "—"}</td>
      {!hideOpenColumn && (
        <td style={{ whiteSpace: "nowrap" }}>
          {showQuickApprove && (
            <button
              type="button"
              className="btn-approve-row"
              disabled={approvingTaskId === taskId}
              title="Approve without opening the task"
              onClick={(e) => {
                e.stopPropagation();
                onQuickApprove?.(row);
              }}
            >
              {approvingTaskId === taskId ? "…" : "Approve"}
            </button>
          )}
          <Link href={taskHref} className="btn-open-row" onClick={(e) => onRowSelect && e.stopPropagation()}>
            Open
          </Link>
        </td>
      )}
    </tr>
  );
}

function TableBody({
  items,
  groupBy,
  contentSlug = "t",
  showProjectColumn = false,
  hideTitleColumn = false,
  hideOpenColumn = false,
  onRowSelect,
  selectedRowKey,
  showQuickApprove = false,
  approvingTaskId = null,
  onQuickApprove,
}: {
  items: ReviewQueueRow[];
  groupBy: GroupBy;
  contentSlug?: "t" | "content";
  showProjectColumn?: boolean;
  hideTitleColumn?: boolean;
  hideOpenColumn?: boolean;
  onRowSelect?: (row: ReviewQueueRow) => void;
  selectedRowKey?: string;
  showQuickApprove?: boolean;
  approvingTaskId?: string | null;
  onQuickApprove?: (row: ReviewQueueRow) => void;
}) {
  const colSpan =
    (showProjectColumn ? 10 : 9) - (hideTitleColumn ? 1 : 0) - (hideOpenColumn ? 1 : 0);
  const rowKey = (row: ReviewQueueRow) =>
    `${getVal(row, "project")}::${getVal(row, "task_id")}`;

  const isSel = (row: ReviewQueueRow) =>
    selectedRowKey != null && selectedRowKey !== "" && rowKey(row) === selectedRowKey;

  if (!groupBy) {
    return (
      <tbody>
        {items.map((row) => (
          <TaskRow
            key={rowKey(row)}
            row={row}
            contentSlug={contentSlug}
            showProjectColumn={showProjectColumn}
            hideTitleColumn={hideTitleColumn}
            hideOpenColumn={hideOpenColumn}
            onRowSelect={onRowSelect}
            selected={isSel(row)}
            showQuickApprove={showQuickApprove}
            approvingTaskId={approvingTaskId}
            onQuickApprove={onQuickApprove}
          />
        ))}
      </tbody>
    );
  }
  const groups = new Map<string, ReviewQueueRow[]>();
  for (const row of items) {
    const key = getVal(row, groupBy) || "(empty)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  return (
    <tbody>
      {sortedGroups.map(([groupKey, rows]) => (
        <React.Fragment key={groupKey}>
          <tr><td colSpan={colSpan} className="group-header">{groupBy}: {groupKey}</td></tr>
          {rows.map((row) => (
            <TaskRow
              key={rowKey(row)}
              row={row}
              contentSlug={contentSlug}
              showProjectColumn={showProjectColumn}
              hideTitleColumn={hideTitleColumn}
              hideOpenColumn={hideOpenColumn}
              onRowSelect={onRowSelect}
              selected={isSel(row)}
              showQuickApprove={showQuickApprove}
              approvingTaskId={approvingTaskId}
              onQuickApprove={onQuickApprove}
            />
          ))}
        </React.Fragment>
      ))}
    </tbody>
  );
}

export function TaskTable({
  items,
  groupBy,
  page,
  limit,
  total,
  missingPreviewCount = 0,
  statusCounts = {},
  contentSlug = "t",
  showProjectColumn = false,
  hideTitleColumn = false,
  hideOpenColumn = false,
  onRowSelect,
  selectedRowKey,
  showQuickApprove = false,
  onAfterDecision,
}: TaskTableProps) {
  const [approvingTaskId, setApprovingTaskId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const handleQuickApprove = useCallback(
    async (row: ReviewQueueRow) => {
      const taskId = getVal(row, "task_id");
      if (!taskId) return;
      setApprovingTaskId(taskId);
      setApproveError(null);
      try {
        const project = getVal(row, "project");
        const res = await fetch("/api/task/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            ...(project ? { project_slug: project } : {}),
            decision: "APPROVED",
          }),
        });
        if (!res.ok) throw new Error(await formatDecisionHttpError(res));
        onAfterDecision?.();
      } catch (e) {
        setApproveError(e instanceof Error ? e.message : "Approve failed");
      } finally {
        setApprovingTaskId(null);
      }
    },
    [onAfterDecision]
  );

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = total === 0 ? 0 : Math.min(page * limit, total);
  const rangeLabel =
    total === 0 ? "No results" : `Showing ${start}–${end} of ${total}`;

  return (
    <div>
      {approveError && (
        <div style={{ color: "var(--red)", marginBottom: 12, fontSize: 13 }} role="alert">
          {approveError}
        </div>
      )}
      <div className="flex items-center justify-between mb-3" style={{ fontSize: 13, color: "var(--muted)" }}>
        <span>{rangeLabel}</span>
        <div className="flex gap-2">
          {Object.entries(statusCounts).map(([k, v]) => (<span key={k}>{k}: {v}</span>))}
          {missingPreviewCount > 0 && <span style={{ color: "var(--yellow)" }}>Missing preview: {missingPreviewCount}</span>}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 72 }}>Preview</th>
            <th>Task ID</th>
            {showProjectColumn && <th>Project</th>}
            {!hideTitleColumn && <th>Title / Hook</th>}
            <th>Platform</th>
            <th>Flow type</th>
            <th>Status</th>
            <th>Decision</th>
            <th>Route</th>
            {!hideOpenColumn && <th>{showQuickApprove ? "Actions" : ""}</th>}
          </tr>
        </thead>
        <TableBody
          items={items}
          groupBy={groupBy}
          contentSlug={contentSlug}
          showProjectColumn={showProjectColumn}
          hideTitleColumn={hideTitleColumn}
          hideOpenColumn={hideOpenColumn}
          onRowSelect={onRowSelect}
          selectedRowKey={selectedRowKey}
          showQuickApprove={showQuickApprove}
          approvingTaskId={approvingTaskId}
          onQuickApprove={showQuickApprove ? handleQuickApprove : undefined}
        />
      </table>
      {items.length === 0 && <div className="table-empty">No tasks match the current filters</div>}
    </div>
  );
}
