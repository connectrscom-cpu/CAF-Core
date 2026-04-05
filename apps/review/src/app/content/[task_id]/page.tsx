"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ReviewQueueRow } from "@/lib/types";

interface ContentResponse {
  data: ReviewQueueRow;
}

export default function ContentPage() {
  const params = useParams();
  const task_id = typeof params.task_id === "string" ? params.task_id : "";
  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContent = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${encodeURIComponent(task_id)}`);
      if (res.status === 404) { setError("Content not found"); setData(null); return; }
      if (!res.ok) throw new Error(await res.text());
      const json: ContentResponse = await res.json();
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load content");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [task_id]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Workbench</Link>
          <h1 className="min-w-0 truncate text-base font-semibold text-card-foreground sm:text-lg">Content: {task_id}</h1>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        {error && (<div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>)}
        {loading && !data && (<div className="text-muted-foreground">Loading…</div>)}
        {data && !loading && (
          <div className="w-full max-w-4xl space-y-4">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Task Details</h2>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-background p-4 text-xs">{JSON.stringify(data, null, 2)}</pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
