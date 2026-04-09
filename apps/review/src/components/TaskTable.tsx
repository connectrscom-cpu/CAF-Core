"use client";

import React from "react";
import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";
import { isVideoUrl } from "@/lib/media-url";

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
}: {
  row: ReviewQueueRow;
  contentSlug?: "t" | "content";
  showProjectColumn?: boolean;
}) {
  const taskId = getVal(row, "task_id");
  const project = getVal(row, "project");
  const platform = getVal(row, "platform");
  const flowType = getVal(row, "flow_type");
  const reviewStatus = getVal(row, "review_status");
  const decision = getVal(row, "decision");
  const title = getVal(row, "generated_title") || taskId;
  const thumb = getVal(row, "preview_url");
  const taskHref =
    showProjectColumn && project
      ? `/${contentSlug}/${encodeURIComponent(taskId)}?project=${encodeURIComponent(project)}`
      : `/${contentSlug}/${encodeURIComponent(taskId)}`;

  return (
    <tr>
      <td className="task-thumb-cell" style={{ width: 72, verticalAlign: "middle" }}>
        {thumb ? (
          isVideoUrl(thumb) ? (
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", background: "#111", display: "block" }}
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
        <Link href={taskHref}>{taskId}</Link>
      </td>
      {showProjectColumn && <td>{project || "—"}</td>}
      <td className="hook-cell" title={title}>{title}</td>
      <td>{platform || "—"}</td>
      <td>{flowType || "—"}</td>
      <td>{statusBadge(reviewStatus)}</td>
      <td>{decision ? statusBadge(decision) : "—"}</td>
      <td>{getVal(row, "recommended_route") || "—"}</td>
      <td>
        <Link href={taskHref} className="btn-open-row">Open</Link>
      </td>
    </tr>
  );
}

function TableBody({
  items,
  groupBy,
  contentSlug = "t",
  showProjectColumn = false,
}: {
  items: ReviewQueueRow[];
  groupBy: GroupBy;
  contentSlug?: "t" | "content";
  showProjectColumn?: boolean;
}) {
  const colSpan = showProjectColumn ? 10 : 9;
  const rowKey = (row: ReviewQueueRow) =>
    `${getVal(row, "project")}::${getVal(row, "task_id")}`;

  if (!groupBy) {
    return (
      <tbody>
        {items.map((row) => (
          <TaskRow key={rowKey(row)} row={row} contentSlug={contentSlug} showProjectColumn={showProjectColumn} />
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
            <TaskRow key={rowKey(row)} row={row} contentSlug={contentSlug} showProjectColumn={showProjectColumn} />
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
}: TaskTableProps) {
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = total === 0 ? 0 : Math.min(page * limit, total);
  const rangeLabel =
    total === 0 ? "No results" : `Showing ${start}–${end} of ${total}`;

  return (
    <div>
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
            <th>Title / Hook</th>
            <th>Platform</th>
            <th>Flow type</th>
            <th>Status</th>
            <th>Decision</th>
            <th>Route</th>
            <th></th>
          </tr>
        </thead>
        <TableBody
          items={items}
          groupBy={groupBy}
          contentSlug={contentSlug}
          showProjectColumn={showProjectColumn}
        />
      </table>
      {items.length === 0 && <div className="table-empty">No tasks match the current filters</div>}
    </div>
  );
}
