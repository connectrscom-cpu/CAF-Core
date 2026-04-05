"use client";

import React from "react";
import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";

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

function TaskRow({ row, contentSlug = "t" }: { row: ReviewQueueRow; contentSlug?: "t" | "content" }) {
  const taskId = getVal(row, "task_id");
  const platform = getVal(row, "platform");
  const flowType = getVal(row, "flow_type");
  const reviewStatus = getVal(row, "review_status");
  const decision = getVal(row, "decision");
  const title = getVal(row, "generated_title") || taskId;
  const taskHref = `/${contentSlug}/${encodeURIComponent(taskId)}`;

  return (
    <tr>
      <td className="task-id-cell">
        <Link href={taskHref}>{taskId}</Link>
      </td>
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

function TableBody({ items, groupBy, contentSlug = "t" }: { items: ReviewQueueRow[]; groupBy: GroupBy; contentSlug?: "t" | "content" }) {
  if (!groupBy) {
    return (<tbody>{items.map((row) => (<TaskRow key={getVal(row, "task_id")} row={row} contentSlug={contentSlug} />))}</tbody>);
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
          <tr><td colSpan={8} className="group-header">{groupBy}: {groupKey}</td></tr>
          {rows.map((row) => (<TaskRow key={getVal(row, "task_id")} row={row} contentSlug={contentSlug} />))}
        </React.Fragment>
      ))}
    </tbody>
  );
}

export function TaskTable({ items, groupBy, page, limit, total, missingPreviewCount = 0, statusCounts = {}, contentSlug = "t" }: TaskTableProps) {
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div>
      <div className="flex items-center justify-between mb-3" style={{ fontSize: 13, color: "var(--muted)" }}>
        <span>Showing {start}–{end} of {total}</span>
        <div className="flex gap-2">
          {Object.entries(statusCounts).map(([k, v]) => (<span key={k}>{k}: {v}</span>))}
          {missingPreviewCount > 0 && <span style={{ color: "var(--yellow)" }}>Missing preview: {missingPreviewCount}</span>}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Task ID</th>
            <th>Title / Hook</th>
            <th>Platform</th>
            <th>Flow type</th>
            <th>Status</th>
            <th>Decision</th>
            <th>Route</th>
            <th></th>
          </tr>
        </thead>
        <TableBody items={items} groupBy={groupBy} contentSlug={contentSlug} />
      </table>
      {items.length === 0 && <div className="table-empty">No tasks match the current filters</div>}
    </div>
  );
}
