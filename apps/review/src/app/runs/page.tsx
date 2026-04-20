"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useReviewProject } from "@/components/ReviewProjectContext";

interface RunsApiItem {
  id: string;
  run_id: string;
  project_slug: string;
  status: string;
  source_window: string | null;
  signal_pack_id: string | null;
  display_name: string | null;
  total_jobs: number;
  jobs_completed: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  has_context_snapshot: boolean;
  has_prompt_snapshot: boolean;
}

interface RunsApiResponse {
  items: RunsApiItem[];
  total: number;
  scope?: "all" | "single";
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "var(--green, #22c55e)";
    case "FAILED":
    case "CANCELLED":
      return "var(--red, #ef4444)";
    case "PLANNING":
    case "PLANNED":
    case "GENERATING":
    case "RENDERING":
    case "REVIEWING":
      return "var(--yellow, #eab308)";
    default:
      return "var(--muted, #9ca3af)";
  }
}

export default function RunsPage() {
  const { activeProjectSlug, lockedSlug } = useReviewProject();
  const [data, setData] = useState<RunsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "100");
      const active = (activeProjectSlug || lockedSlug || "").trim();
      if (active) qs.set("project", active);
      const res = await fetch(`/api/runs?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json: RunsApiResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeProjectSlug, lockedSlug]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const items = data?.items ?? [];

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) if (r.project_slug) set.add(r.project_slug);
    return Array.from(set).sort();
  }, [items]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) if (r.status) set.add(r.status);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (projectFilter && r.project_slug !== projectFilter) return false;
      return true;
    });
  }, [items, statusFilter, projectFilter]);

  const showProjectColumn = data?.scope === "all";

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Run Logs</h2>
          <span className="page-header-sub">
            History of every run, with prompt / context snapshot indicators. Click a run to open its review queue.
          </span>
        </div>
        <button className="button" onClick={fetchRuns} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div style={{ padding: "20px 28px 28px" }}>
        {error && (
          <div style={{ color: "var(--red)", marginBottom: 16, fontSize: 13 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "4px 8px" }}
            >
              <option value="">All</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {showProjectColumn && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              Project
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                style={{ padding: "4px 8px" }}
              >
                <option value="">All</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
            {filtered.length} run{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {loading && !data && <div style={{ color: "var(--muted)" }}>Loading…</div>}

        {data && !loading && filtered.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No runs found for this scope.</p>
        )}

        {filtered.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border, #2a2a2a)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-2, #151515)" }}>
                  {showProjectColumn && <Th>Project</Th>}
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Jobs</Th>
                  <Th>Started</Th>
                  <Th>Completed</Th>
                  <Th>Snapshots</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={`${r.project_slug}:${r.id}`}
                    style={{ borderTop: "1px solid var(--border, #2a2a2a)" }}
                  >
                    {showProjectColumn && <Td>{r.project_slug}</Td>}
                    <Td>
                      <Link
                        href={`/r/${encodeURIComponent(r.run_id)}${
                          r.project_slug ? `?project=${encodeURIComponent(r.project_slug)}` : ""
                        }`}
                        className="detail-back"
                        style={{ padding: 0, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
                      >
                        {r.display_name || r.run_id}
                      </Link>
                      {r.display_name && (
                        <div style={{ color: "var(--muted)", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                          {r.run_id}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: statusColor(r.status), fontWeight: 600 }}>{r.status}</span>
                    </Td>
                    <Td>
                      {r.jobs_completed} / {r.total_jobs}
                    </Td>
                    <Td>{fmt(r.started_at)}</Td>
                    <Td>{fmt(r.completed_at)}</Td>
                    <Td>
                      <span
                        title="Prompt version snapshot recorded at plan time"
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          marginRight: 4,
                          borderRadius: 4,
                          fontSize: 11,
                          background: r.has_prompt_snapshot ? "rgba(34,197,94,0.15)" : "rgba(107,114,128,0.15)",
                          color: r.has_prompt_snapshot ? "var(--green, #22c55e)" : "var(--muted)",
                        }}
                      >
                        prompts
                      </span>
                      <span
                        title="Full generation context snapshot (brand+strategy+learning fingerprints)"
                        style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          background: r.has_context_snapshot ? "rgba(34,197,94,0.15)" : "rgba(107,114,128,0.15)",
                          color: r.has_context_snapshot ? "var(--green, #22c55e)" : "var(--muted)",
                        }}
                      >
                        context
                      </span>
                    </Td>
                    <Td>{fmt(r.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, fontSize: 12, color: "var(--muted)" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "top" }}>{children}</td>;
}
