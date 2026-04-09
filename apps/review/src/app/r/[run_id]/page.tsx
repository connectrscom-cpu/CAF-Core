"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable } from "@/components/TaskTable";
import type { ReviewQueueRow } from "@/lib/types";
import { taskReviewHref } from "@/lib/task-links";

interface TasksResponse {
  items: ReviewQueueRow[];
  total: number;
  page: number;
  limit: number;
  scope?: "all" | "single";
  statusCounts?: Record<string, number>;
  missingPreviewCount?: number;
}

function RunContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const run_id = typeof params.run_id === "string" ? params.run_id : "";

  const [data, setData] = useState<TasksResponse | null>(null);
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const queryString = useMemo(() => {
    const q = new URLSearchParams(searchParams.toString());
    q.set("run_id", run_id);
    return q.toString();
  }, [run_id, searchParams]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?${queryString}`);
      if (!res.ok) throw new Error(await res.text());
      const json: TasksResponse = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/facets")
      .then((r) => (r.ok ? r.json() : {}))
      .then(setFacets)
      .catch(() => {});
  }, []);

  const firstReadyLink = useMemo(() => {
    if (!data?.items?.length) return null;
    const pending = data.items.find((row) => {
      const s = (row.review_status ?? "").trim();
      return ["READY", "IN_REVIEW", "GENERATED", "READY_FOR_REVIEW", "in review", "in_review"].includes(s);
    });
    const row = pending ?? data.items[0];
    if (!row) return null;
    const tid = (row.task_id ?? "").trim();
    if (!tid) return null;
    const proj = (row.project ?? "").trim();
    return { href: taskReviewHref("t", tid, proj || undefined) };
  }, [data?.items]);

  const reviewNext = () => {
    if (firstReadyLink) router.push(firstReadyLink.href);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Run: {run_id}</h2>
          <span className="page-header-sub">Tasks belonging to this run</span>
        </div>
        {firstReadyLink && (
          <button type="button" className="btn-primary" onClick={reviewNext}>
            Review next pending
          </button>
        )}
      </div>

      <div className="workbench">
        <div className="workbench-filters">
          <WorkbenchFilters
            basePath={`/r/${encodeURIComponent(run_id)}`}
            projectValues={facets.project ?? []}
            runIdValues={facets.run_id ?? []}
            platformValues={facets.platform ?? []}
            flowTypeValues={facets.flow_type ?? []}
            recommendedRouteValues={facets.recommended_route ?? []}
            reviewStatusValues={data?.statusCounts ? Object.keys(data.statusCounts) : undefined}
          />
        </div>
        <div className="workbench-table">
          {loading && !data && <div style={{ color: "var(--muted)" }}>Loading…</div>}
          {data && !loading && (
            <TaskTable
              items={data.items}
              groupBy=""
              page={data.page}
              limit={data.limit}
              total={data.total}
              missingPreviewCount={data.missingPreviewCount}
              statusCounts={data.statusCounts}
              showProjectColumn={data.scope === "all"}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default function RunPage() {
  return (
    <Suspense fallback={
      <div>
        <div className="page-header"><h2>Run</h2></div>
        <div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>
      </div>
    }>
      <RunContent />
    </Suspense>
  );
}
