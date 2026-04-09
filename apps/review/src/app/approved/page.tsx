"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TaskTable } from "@/components/TaskTable";
import type { ReviewQueueRow } from "@/lib/types";

interface ApprovedResponse {
  items: ReviewQueueRow[];
  total: number;
  scope?: "all" | "single";
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
    <>
      <div className="page-header">
        <div>
          <h2>Approved Content</h2>
          <span className="page-header-sub">Tasks with status Approved</span>
        </div>
      </div>

      <div style={{ padding: "20px 28px 28px" }}>
        <Link href="/" className="detail-back" style={{ padding: 0, marginBottom: 16, display: "inline-block" }}>← Review Console</Link>
        {error && <div style={{ color: "var(--red)", marginBottom: 16, fontSize: 13 }}>{error}</div>}
        {loading && !data && <div style={{ color: "var(--muted)" }}>Loading…</div>}
        {data && !loading && (
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No approved content yet.</p>
          ) : (
            <TaskTable
              items={data.items}
              groupBy=""
              page={1}
              limit={data.total}
              total={data.total}
              contentSlug="content"
              showProjectColumn={data.scope === "all"}
            />
          )
        )}
      </div>
    </>
  );
}
