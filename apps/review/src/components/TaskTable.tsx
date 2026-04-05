"use client";

import React from "react";
import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";
import { cn } from "@/lib/utils";

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

function TaskRow({ row, contentSlug = "t" }: { row: ReviewQueueRow; contentSlug?: "t" | "content" }) {
  const taskId = getVal(row, "task_id");
  const platform = getVal(row, "platform");
  const flowType = getVal(row, "flow_type");
  const reviewStatus = getVal(row, "review_status");
  const decision = getVal(row, "decision");
  const title = getVal(row, "generated_title") || taskId;
  const taskHref = `/${contentSlug}/${encodeURIComponent(taskId)}`;

  return (
    <tr className="border-b border-border hover:bg-muted/50">
      <td className="p-2">
        <Link href={taskHref} className="block w-14 h-14 rounded border bg-muted overflow-hidden shrink-0">
          <span className="inline-flex h-full w-full items-center justify-center text-xs text-muted-foreground">—</span>
        </Link>
      </td>
      <td className="p-2 text-sm">
        <Link href={taskHref} className="font-medium text-primary hover:underline">{taskId}</Link>
      </td>
      <td className="p-2 text-sm text-muted-foreground">{getVal(row, "run_id")}</td>
      <td className="p-2 text-sm">{platform}</td>
      <td className="p-2 text-sm">{flowType}</td>
      <td className="p-2 text-sm max-w-[200px] truncate" title={title}>{title}</td>
      <td className="p-2">
        <span className={cn(
          "rounded px-2 py-0.5 text-xs font-medium",
          reviewStatus === "READY" && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
          (reviewStatus === "IN_REVIEW" || reviewStatus === "in review" || reviewStatus === "in_review") && "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
          reviewStatus === "SUBMITTED" && "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
          reviewStatus === "APPROVED" && "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
          reviewStatus === "NEEDS_EDIT" && "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
          reviewStatus === "REJECTED" && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
          !["READY","IN_REVIEW","in review","in_review","SUBMITTED","APPROVED","NEEDS_EDIT","REJECTED"].includes(reviewStatus) && reviewStatus && "bg-muted text-muted-foreground"
        )}>{reviewStatus || "—"}</span>
      </td>
      <td className="p-2 text-sm">{decision || "—"}</td>
      <td className="p-2 text-sm">{getVal(row, "recommended_route") || "—"}</td>
      <td className="p-2 text-sm">{getVal(row, "qc_status") || "—"}</td>
      <td className="p-2 text-sm">{getVal(row, "risk_score") || "—"}</td>
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
          <tr className="bg-muted/70 font-medium"><td colSpan={11} className="p-2 text-sm">{groupBy}: {groupKey}</td></tr>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>Showing {start}–{end} of {total}</span>
        {Object.entries(statusCounts).map(([k, v]) => (<span key={k}>{k}: {v}</span>))}
        {missingPreviewCount > 0 && (<span className="text-amber-600">Missing preview: {missingPreviewCount}</span>)}
      </div>
      <div className="overflow-x-auto rounded-md border -mx-1 sm:mx-0">
        <table className="w-full min-w-[640px] text-left">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-xs font-medium w-[3.5rem]">Preview</th>
              <th className="p-2 text-xs font-medium">Task ID</th>
              <th className="p-2 text-xs font-medium">Run</th>
              <th className="p-2 text-xs font-medium">Platform</th>
              <th className="p-2 text-xs font-medium">Flow type</th>
              <th className="p-2 text-xs font-medium">Title</th>
              <th className="p-2 text-xs font-medium">Review status</th>
              <th className="p-2 text-xs font-medium">Decision</th>
              <th className="p-2 text-xs font-medium">Route</th>
              <th className="p-2 text-xs font-medium">QC</th>
              <th className="p-2 text-xs font-medium">Risk</th>
            </tr>
          </thead>
          <TableBody items={items} groupBy={groupBy} contentSlug={contentSlug} />
        </table>
      </div>
    </div>
  );
}
