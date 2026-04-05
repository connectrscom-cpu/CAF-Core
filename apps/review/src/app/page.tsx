"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable } from "@/components/TaskTable";
import type { ReviewQueueRow } from "@/lib/types";
import type { GroupBy } from "@/components/TaskTable";

interface TasksResponse {
  items: ReviewQueueRow[];
  total: number;
  page: number;
  limit: number;
  statusCounts?: Record<string, number>;
  missingPreviewCount?: number;
}

interface FacetsResponse {
  project?: string[];
  run_id?: string[];
  platform?: string[];
  flow_type?: string[];
  recommended_route?: string[];
}

function WorkbenchContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [facets, setFacets] = useState<FacetsResponse>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = (searchParams.get("status") ?? "in_review") as string;
  const validStatus = ["in_review", "approved", "rejected", "needs_edit"].includes(status) ? status : "in_review";

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    searchParams.forEach((v, k) => q.set(k, v));
    if (!q.has("status")) q.set("status", "in_review");
    return q.toString();
  }, [searchParams]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?${queryString}`);
      if (!res.ok) throw new Error(await res.text());
      const json: TasksResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/facets")
      .then((r) => r.ok ? r.json() : {})
      .then((f: FacetsResponse) => { if (!cancelled) setFacets(f); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const groupBy = (searchParams.get("group") ?? "") as GroupBy;

  const tabStatuses = [
    { key: "in_review" as const, label: "In Review" },
    { key: "needs_edit" as const, label: "Waiting for Rework" },
    { key: "approved" as const, label: "Approved" },
    { key: "rejected" as const, label: "Rejected" },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Review Console</h2>
          <span className="page-header-sub">Workbench</span>
        </div>
      </div>

      <div className="tabs">
        {tabStatuses.map(({ key, label }) => {
          const isActive = validStatus === key;
          const q = new URLSearchParams(searchParams.toString());
          q.set("status", key);
          const count = data?.statusCounts?.[key];
          return (
            <Link key={key} href={`/?${q.toString()}`} className={`tab ${isActive ? "active" : ""}`}>
              {label}
              {count !== undefined && <span className="tab-count">{count}</span>}
            </Link>
          );
        })}
      </div>

      <div className="workbench">
        <div className="workbench-filters">
          <WorkbenchFilters
            projectValues={facets.project ?? []}
            runIdValues={facets.run_id ?? []}
            platformValues={facets.platform ?? []}
            flowTypeValues={facets.flow_type ?? []}
            recommendedRouteValues={facets.recommended_route ?? []}
            reviewStatusValues={data?.statusCounts ? Object.keys(data.statusCounts) : undefined}
          />
        </div>
        <div className="workbench-table">
          {error && <div style={{ color: "var(--red)", marginBottom: 16, fontSize: 13 }}>{error}</div>}
          {loading && !data && <div style={{ color: "var(--muted)" }}>Loading…</div>}
          {data && !loading && (
            <TaskTable
              items={data.items}
              groupBy={groupBy}
              page={data.page}
              limit={data.limit}
              total={data.total}
              missingPreviewCount={data.missingPreviewCount}
              statusCounts={data.statusCounts}
              contentSlug={validStatus === "in_review" ? "t" : "content"}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default function WorkbenchPage() {
  return (
    <Suspense fallback={
      <div>
        <div className="page-header"><h2>Review Console</h2></div>
        <div style={{ padding: "28px", color: "var(--muted)" }}>Loading…</div>
      </div>
    }>
      <WorkbenchContent />
    </Suspense>
  );
}
