"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-lg font-semibold text-card-foreground sm:text-xl">CAF Review Console</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">Workbench</p>
        <div className="mt-3 flex gap-2 border-t border-border/50 pt-3">
          {tabStatuses.map(({ key, label }) => {
            const isActive = validStatus === key;
            const q = new URLSearchParams(searchParams.toString());
            q.set("status", key);
            return (
              <a key={key} href={`/?${q.toString()}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium no-underline ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}>
                {label}
              </a>
            );
          })}
        </div>
      </header>
      <main className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-6 sm:p-6">
        <div className="w-full shrink-0 sm:w-64">
          <WorkbenchFilters
            projectValues={facets.project ?? []}
            runIdValues={facets.run_id ?? []}
            platformValues={facets.platform ?? []}
            flowTypeValues={facets.flow_type ?? []}
            recommendedRouteValues={facets.recommended_route ?? []}
            reviewStatusValues={data?.statusCounts ? Object.keys(data.statusCounts) : undefined}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {error && (<div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>)}
          {loading && !data && (<div className="text-muted-foreground">Loading…</div>)}
          {data && !loading && (
            <TaskTable items={data.items} groupBy={groupBy} page={data.page} limit={data.limit} total={data.total} missingPreviewCount={data.missingPreviewCount} statusCounts={data.statusCounts} contentSlug={validStatus === "in_review" ? "t" : "content"} />
          )}
        </div>
      </main>
    </div>
  );
}

export default function WorkbenchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card px-6 py-4">
          <h1 className="text-xl font-semibold">CAF Review Console</h1>
          <p className="text-sm text-muted-foreground">Workbench</p>
        </header>
        <main className="flex gap-6 p-6"><div className="text-muted-foreground">Loading…</div></main>
      </div>
    }>
      <WorkbenchContent />
    </Suspense>
  );
}
