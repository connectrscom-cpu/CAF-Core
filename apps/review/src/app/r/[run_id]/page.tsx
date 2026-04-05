"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable } from "@/components/TaskTable";
import { Button } from "@/components/ui/button";
import type { ReviewQueueRow } from "@/lib/types";

interface TasksResponse {
  items: ReviewQueueRow[];
  total: number;
  page: number;
  limit: number;
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

  const firstReadyTaskId = useMemo(() => {
    if (!data?.items) return null;
    const pending = data.items.find((row) =>
      ["READY", "IN_REVIEW", "in review", "in_review"].includes((row.review_status ?? "").trim())
    );
    return pending ? (pending.task_id ?? "").trim() : (data.items[0]?.task_id ?? "").trim();
  }, [data?.items]);

  const reviewNext = () => {
    if (firstReadyTaskId) router.push(`/t/${encodeURIComponent(firstReadyTaskId)}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Workbench
          </Link>
          <h1 className="truncate text-base font-semibold text-card-foreground sm:text-xl">Run: {run_id}</h1>
          {firstReadyTaskId && (
            <Button size="sm" onClick={reviewNext} className="shrink-0">
              Review next pending
            </Button>
          )}
        </div>
      </header>

      <main className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-6 sm:p-6">
        <div className="w-full shrink-0 sm:w-64">
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
        <div className="min-w-0 flex-1 overflow-hidden">
          {loading && !data && <div className="text-muted-foreground">Loading…</div>}
          {data && !loading && (
            <TaskTable
              items={data.items}
              groupBy=""
              page={data.page}
              limit={data.limit}
              total={data.total}
              missingPreviewCount={data.missingPreviewCount}
              statusCounts={data.statusCounts}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default function RunPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card px-6 py-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground">← Workbench</Link>
        </header>
        <main className="p-6"><div className="text-muted-foreground">Loading…</div></main>
      </div>
    }>
      <RunContent />
    </Suspense>
  );
}
