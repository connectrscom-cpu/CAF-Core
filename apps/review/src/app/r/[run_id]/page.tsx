"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable } from "@/components/TaskTable";
import type { ReviewQueueRow } from "@/lib/types";
import { taskReviewHref } from "@/lib/task-links";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

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
  const [facets, setFacets] = useState<{
    project?: string[];
    run_id?: string[];
    run_display_names?: Record<string, string>;
    platform?: string[];
    flow_type?: string[];
    recommended_route?: string[];
  }>({});
  const [loading, setLoading] = useState(true);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewValidator, setReviewValidator] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

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

  const projectFromQuery = (searchParams.get("project") ?? "").trim();
  const projectFromRows = (data?.items?.[0]?.project ?? "").trim();
  const effectiveProjectSlug = useMemo(() => {
    if (projectFromQuery) return projectFromQuery;
    if (!reviewUsesAllProjects() && PROJECT_SLUG) return PROJECT_SLUG;
    return projectFromRows || reviewQueueFallbackSlug();
  }, [projectFromQuery, projectFromRows]);

  const loadRunReview = useCallback(async () => {
    if (!run_id || !effectiveProjectSlug) return;
    setReviewLoading(true);
    setReviewMsg(null);
    try {
      const qs = new URLSearchParams({ run_id, project_slug: effectiveProjectSlug });
      const res = await fetch(`/api/run-output-review?${qs}`);
      const json = (await res.json()) as { ok?: boolean; review?: { body?: string; validator?: string | null } | null; error?: string };
      if (!res.ok) throw new Error(json.error || "Load failed");
      setReviewBody((json.review?.body ?? "").toString());
      setReviewValidator((json.review?.validator ?? "").toString());
    } catch (e) {
      setReviewMsg(e instanceof Error ? e.message : "Could not load run review");
    } finally {
      setReviewLoading(false);
    }
  }, [run_id, effectiveProjectSlug]);

  useEffect(() => {
    void loadRunReview();
  }, [loadRunReview]);

  const saveRunReview = async (mode: "save" | "clear" = "save") => {
    if (!run_id || !effectiveProjectSlug) return;
    const bodyText = mode === "clear" ? "" : reviewBody;
    const valText = mode === "clear" ? "" : reviewValidator;
    setReviewSaving(true);
    setReviewMsg(null);
    try {
      const res = await fetch("/api/run-output-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id,
          project_slug: effectiveProjectSlug,
          body: bodyText,
          validator: valText.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; deleted?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Save failed");
      setReviewMsg(json.deleted ? "Review cleared." : "Saved. Included in the next editorial analysis for this project.");
      if (json.deleted || mode === "clear") {
        setReviewBody("");
        setReviewValidator("");
      }
    } catch (e) {
      setReviewMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setReviewSaving(false);
    }
  };

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

  const runTitle = facets.run_display_names?.[run_id]?.trim();

  const downloadExport = (format: "md" | "json") => {
    if (!effectiveProjectSlug || !run_id) return;
    const qs = new URLSearchParams({ run_id, project_slug: effectiveProjectSlug, format });
    window.location.href = `/api/runs/export?${qs.toString()}`;
  };

  const copyExportToClipboard = async () => {
    if (!effectiveProjectSlug || !run_id) return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const qs = new URLSearchParams({ run_id, project_slug: effectiveProjectSlug, format: "md" });
      const res = await fetch(`/api/runs/export?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setExportMsg("Copied run export (Markdown) to clipboard.");
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{runTitle ?? `Run: ${run_id}`}</h2>
          <span className="page-header-sub" style={{ display: "block", marginTop: 4 }}>
            {runTitle ? (
              <>
                <span className="mono">{run_id}</span>
                <span style={{ display: "block", marginTop: 4 }}>Tasks belonging to this run</span>
              </>
            ) : (
              "Tasks belonging to this run"
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {effectiveProjectSlug && (
            <>
              <button type="button" className="btn-ghost" disabled={exportBusy} onClick={() => void copyExportToClipboard()}>
                {exportBusy ? "Copying…" : "Copy export"}
              </button>
              <button type="button" className="btn-ghost" disabled={exportBusy} onClick={() => downloadExport("md")}>
                Download export (MD)
              </button>
              <button type="button" className="btn-ghost" disabled={exportBusy} onClick={() => downloadExport("json")}>
                Download export (JSON)
              </button>
            </>
          )}
          {firstReadyLink && (
            <button type="button" className="btn-primary" onClick={reviewNext}>
              Review next pending
            </button>
          )}
        </div>
      </div>
      {exportMsg && (
        <div style={{ padding: "0 28px", marginTop: -10, marginBottom: 12, color: exportMsg.includes("fail") ? "var(--red)" : "var(--muted)", fontSize: 13 }}>
          {exportMsg}
        </div>
      )}

      <div
        className="card"
        style={{
          margin: "0 28px 20px",
          padding: "16px 20px",
          border: "1px solid var(--border)",
          borderRadius: 12,
          maxWidth: 920,
        }}
      >
        <div style={{ fontWeight: 650, marginBottom: 8 }}>Run output review</div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.45 }}>
          Overall feedback on this run is stored in Core and merged into <strong>editorial analysis</strong> (engineering brief + optional
          OpenAI synthesis), using the same rolling window as the analysis job.
        </p>
        {!effectiveProjectSlug && (
          <p style={{ fontSize: 13, color: "var(--yellow)" }}>
            Set a <span className="mono">project</span> filter or open a task from this run so we know which tenant to write to.
          </p>
        )}
        {effectiveProjectSlug && (
          <>
            <label className="filter-label" style={{ display: "block", marginBottom: 6 }}>
              Review
            </label>
            <textarea
              className="filter-input"
              style={{ width: "100%", minHeight: 140, resize: "vertical", marginBottom: 12 }}
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              disabled={reviewLoading || reviewSaving}
              placeholder="Batch quality, coherence, what to fix next run…"
            />
            <label className="filter-label" style={{ display: "block", marginBottom: 6 }}>
              Your name (optional)
            </label>
            <input
              className="filter-input"
              style={{ width: "100%", maxWidth: 360, marginBottom: 12 }}
              value={reviewValidator}
              onChange={(e) => setReviewValidator(e.target.value)}
              disabled={reviewLoading || reviewSaving}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="button" className="btn-primary" disabled={reviewLoading || reviewSaving} onClick={() => void saveRunReview("save")}>
                {reviewSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={reviewLoading || reviewSaving}
                onClick={() => void saveRunReview("clear")}
              >
                Clear
              </button>
              {reviewLoading && <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>Loading…</span>}
            </div>
            {reviewMsg && (
              <p style={{ fontSize: 13, marginTop: 10, color: reviewMsg.includes("fail") ? "var(--red)" : "var(--muted)" }}>{reviewMsg}</p>
            )}
          </>
        )}
      </div>

      <div className="workbench">
        <div className="workbench-filters">
          <WorkbenchFilters
            basePath={`/r/${encodeURIComponent(run_id)}`}
            projectValues={facets.project ?? []}
            runIdValues={facets.run_id ?? []}
            runDisplayNames={facets.run_display_names}
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
