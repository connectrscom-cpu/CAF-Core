"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TaskTable } from "@/components/TaskTable";
import type { ReviewQueueRow } from "@/lib/types";

interface ApprovedResponse {
  items: ReviewQueueRow[];
  total: number;
}

export default function ApprovedPage() {
  const [data, setData] = useState<ApprovedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApproved = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approved");
      if (!res.ok) throw new Error(await res.text());
      const json: ApprovedResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approved content");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchApproved(); }, [fetchApproved]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-lg font-semibold text-card-foreground sm:text-xl">Approved content</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">Tasks with status Approved.</p>
      </header>
      <main className="flex flex-col gap-4 p-4 sm:p-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Review Console</Link>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}
        {loading && !data && <div className="text-muted-foreground">Loading…</div>}
        {data && !loading && (
          data.items.length === 0 ? (
            <p className="text-muted-foreground">No approved content yet.</p>
          ) : (
            <TaskTable items={data.items} groupBy="" page={1} limit={data.total} total={data.total} contentSlug="content" />
          )
        )}
      </main>
    </div>
  );
}
