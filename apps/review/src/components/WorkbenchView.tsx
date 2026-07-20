"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable } from "@/components/TaskTable";
import { ChromePanelToggle } from "@/components/ChromePanelToggle";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { useReviewChromeLayout } from "@/lib/review-chrome-layout";
import { useMobileLayout, usePhoneLayout } from "@/lib/use-mobile-layout";
import { taskReviewHref } from "@/lib/task-links";
import { MARKETER_LABELS } from "@/lib/marketer/language";
import { LoadingWithTip, PageTip } from "@/components/marketer/PageTip";
import type { ReviewQueueRow } from "@/lib/types";
import type { GroupBy } from "@/components/TaskTable";
import { useRouter } from "next/navigation";

interface TasksResponse {
  items: ReviewQueueRow[];
  total: number;
  page: number;
  limit: number;
  scope?: "all" | "single";
  tabCounts?: { in_review: number; approved: number; rejected: number; needs_edit: number };
  statusCounts?: Record<string, number>;
  missingPreviewCount?: number;
}

interface FacetsResponse {
  project?: string[];
  run_id?: string[];
  run_display_names?: Record<string, string>;
  platform?: string[];
  flow_type?: string[];
  recommended_route?: string[];
}

export interface WorkbenchViewProps {
  mode?: "operator" | "marketer";
  /** When set, scopes the queue to this brand and hides the project column. */
  brandSlug?: string;
  /** Base path for status tabs (no query). */
  tabBasePath?: string;
}

function WorkbenchInner({ mode = "operator", brandSlug, tabBasePath = "/review" }: WorkbenchViewProps) {
  const marketer = mode === "marketer";
  const router = useRouter();
  const { multiProject, activeProjectSlug, lockedSlug, navHref } = useReviewProject();
  const { layout, ready: chromeReady, toggleWorkbenchFilters } = useReviewChromeLayout();
  const isMobile = useMobileLayout();
  const isPhone = usePhoneLayout();
  const hideFilters = chromeReady && layout.hideWorkbenchFilters;
  const searchParams = useSearchParams();
  const embeddedInAdmin = searchParams.get("embed") === "admin";
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
    if (brandSlug) q.set("project", brandSlug);
    return q.toString();
  }, [searchParams, brandSlug]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?${queryString}`);
      if (!res.ok) throw new Error(await res.text());
      const json: TasksResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load content");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    let cancelled = false;
    const facetsUrl = brandSlug ? `/api/facets?project=${encodeURIComponent(brandSlug)}` : "/api/facets";
    fetch(facetsUrl)
      .then((r) => (r.ok ? r.json() : {}))
      .then((f: FacetsResponse) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandSlug]);

  useEffect(() => {
    if (!(isMobile && !hideFilters && !embeddedInAdmin)) return;
    const prev = document.body.style.overflow;
    document.body.classList.add("body-scroll-locked");
    document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("body-scroll-locked");
      document.body.style.overflow = prev;
    };
  }, [embeddedInAdmin, hideFilters, isMobile]);

  const groupBy = (searchParams.get("group") ?? "") as GroupBy;

  const openTaskRow = useCallback(
    (row: ReviewQueueRow) => {
      const taskId = String(row.task_id ?? "").trim();
      if (!taskId) return;
      const project = String(row.project ?? brandSlug ?? "").trim();
      const href = navHref(
        taskReviewHref(validStatus === "in_review" ? "t" : "content", taskId, project || undefined, {
          marketer,
        })
      );
      router.push(href);
    },
    [brandSlug, marketer, navHref, router, validStatus]
  );

  const projectSlugForRework =
    brandSlug || (searchParams.get("project") ?? "").trim() || activeProjectSlug || lockedSlug || "";
  const runFilter = (searchParams.get("run_id") ?? "").trim();
  const needsEditCount = data?.tabCounts?.needs_edit ?? 0;
  const [reworkBusy, setReworkBusy] = useState(false);
  const [reworkMsg, setReworkMsg] = useState<string | null>(null);
  const contentViewKey = brandSlug ? `caf-review-content-view-${brandSlug}` : "caf-review-content-view";
  const [contentViewMode, setContentViewMode] = useState<"list" | "grid">("list");

  useEffect(() => {
    if (!marketer || typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(contentViewKey);
      if (stored === "grid" || stored === "list") setContentViewMode(stored);
    } catch {
      /* ignore */
    }
  }, [contentViewKey, marketer]);

  function toggleContentViewMode() {
    setContentViewMode((prev) => {
      const next = prev === "list" ? "grid" : "list";
      try {
        localStorage.setItem(contentViewKey, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function triggerPendingRework() {
    if (!projectSlugForRework) {
      setReworkMsg(marketer ? "Select a brand first." : "Select a project first.");
      return;
    }
    const scope = runFilter ? `cycle ${runFilter}` : marketer ? `brand ${projectSlugForRework}` : `project ${projectSlugForRework}`;
    const n = needsEditCount > 0 ? needsEditCount : "all";
    if (
      !window.confirm(
        `Trigger rework for ${n} item(s) needing edits in ${scope}?\n\nWork runs in the background. Refresh to watch progress.`
      )
    ) {
      return;
    }
    setReworkBusy(true);
    setReworkMsg(null);
    try {
      const res = await fetch("/api/rework/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_slug: projectSlugForRework,
          ...(runFilter ? { run_id: runFilter } : {}),
          limit: 200,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; queued?: number; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${res.status}`);
      setReworkMsg(j.message || `Queued ${j.queued ?? 0} rework job(s).`);
      void fetchTasks();
    } catch (e) {
      setReworkMsg(e instanceof Error ? e.message : "Rework request failed");
    } finally {
      setReworkBusy(false);
    }
  }

  const tabStatuses = marketer
    ? [
        { key: "in_review" as const, label: "Needs review" },
        { key: "needs_edit" as const, label: "Needs edits" },
        { key: "approved" as const, label: "Approved" },
        { key: "rejected" as const, label: "Rejected" },
      ]
    : [
        { key: "in_review" as const, label: "Waiting for Approval" },
        { key: "needs_edit" as const, label: "Waiting for Rework" },
        { key: "approved" as const, label: "Approved" },
        { key: "rejected" as const, label: "Rejected" },
      ];

  return (
    <>
      {!marketer && (
        <div className="page-header">
          <div>
            <h2>Review Console</h2>
            <span className="page-header-sub">
              Workbench
              {multiProject ? (
                <>
                  {" · "}
                  <span className="page-header-tenant">
                    {activeProjectSlug ? (
                      <>
                        Viewing <strong>{activeProjectSlug}</strong>
                      </>
                    ) : (
                      <>
                        Viewing <strong>all projects</strong>
                      </>
                    )}
                  </span>
                </>
              ) : lockedSlug ? (
                <>
                  {" · "}
                  <span className="page-header-tenant">
                    Tenant <strong>{lockedSlug}</strong>
                  </span>
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}

      <div className="tabs">
        {tabStatuses.map(({ key, label }) => {
          const isActive = validStatus === key;
          const q = new URLSearchParams(searchParams.toString());
          q.set("status", key);
          if (brandSlug) q.set("project", brandSlug);
          const count = data?.tabCounts?.[key];
          return (
            <Link
              key={key}
              href={`${tabBasePath}?${q.toString()}`}
              className={`tab tab--${key} ${isActive ? "active" : ""}`}
            >
              {label}
              {count !== undefined && <span className="tab-count">{count}</span>}
            </Link>
          );
        })}
      </div>

      <div className={`workbench${hideFilters ? " workbench--filters-hidden" : ""}${isMobile && !hideFilters ? " workbench--filters-drawer-open" : ""}`}>
        {hideFilters && !embeddedInAdmin && !isMobile ? (
          <ChromePanelToggle
            expanded={false}
            onClick={toggleWorkbenchFilters}
            title="Show filters"
            variant="strip"
            className="chrome-panel-expand--filters"
          />
        ) : null}
        {isMobile && !hideFilters && !embeddedInAdmin ? (
          <button
            type="button"
            className="workbench-filters-overlay"
            aria-label="Close filters"
            onClick={toggleWorkbenchFilters}
          />
        ) : null}
        {!hideFilters ? (
          <div className="workbench-filters">
            <WorkbenchFilters
              basePath={tabBasePath}
              hideProjectFilter={!!brandSlug}
              marketerMode={marketer}
              projectValues={facets.project ?? []}
              runIdValues={facets.run_id ?? []}
              runDisplayNames={facets.run_display_names}
              platformValues={facets.platform ?? []}
              flowTypeValues={facets.flow_type ?? []}
              recommendedRouteValues={facets.recommended_route ?? []}
              reviewStatusValues={data?.statusCounts ? Object.keys(data.statusCounts) : undefined}
              showCollapseToggle={!embeddedInAdmin}
              onCollapseFilters={toggleWorkbenchFilters}
            />
          </div>
        ) : null}
        <div className="workbench-table">
          {isMobile && hideFilters && !embeddedInAdmin ? (
            <div className="workbench-mobile-toolbar">
              <button type="button" className="btn-ghost btn-sm" onClick={toggleWorkbenchFilters}>
                Filters
              </button>
            </div>
          ) : null}
          <div className="workbench-table-inner">
            {validStatus === "needs_edit" && !marketer && (
              <div className="caf-toolbar surface-warn" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={reworkBusy || !projectSlugForRework}
                  onClick={() => void triggerPendingRework()}
                >
                  {reworkBusy ? "Queuing…" : runFilter ? "Rework all NEEDS_EDIT in run" : "Rework all NEEDS_EDIT"}
                </button>
                {reworkMsg ? (
                  <span style={{ fontSize: 12, color: reworkMsg.includes("failed") ? "var(--red)" : "var(--green)" }}>
                    {reworkMsg}
                  </span>
                ) : null}
              </div>
            )}
            {error && <div style={{ color: "var(--red)", marginBottom: 16, fontSize: 13 }}>{error}</div>}
            {loading && !data && (
              marketer ? (
                <LoadingWithTip page="content" label="Loading…" />
              ) : (
                <div style={{ color: "var(--muted)" }}>Loading…</div>
              )
            )}
            {data && !loading && data.items.length === 0 && (
              <div className="workspace-empty workspace-empty--compact workbench-empty">
                <h3>
                  {validStatus === "in_review"
                    ? "Nothing waiting for review"
                    : validStatus === "needs_edit"
                      ? "No edits requested"
                      : validStatus === "approved"
                        ? "No approved content yet"
                        : "No rejected content"}
                </h3>
                <p>
                  {validStatus === "in_review"
                    ? "When CAF finishes generating content, drafts appear here for your approval."
                    : validStatus === "approved"
                      ? "Approved pieces move to Publishing when you are ready to schedule."
                      : "Content in this state will show up here as your pipeline progresses."}
                </p>
                {validStatus === "in_review" && brandSlug && (
                  <Link href={`/brand/${encodeURIComponent(brandSlug)}/ideas`} className="btn-primary btn-sm">
                    Browse ideas
                  </Link>
                )}
                {marketer ? <PageTip page="content" salt="empty" compact /> : null}
              </div>
            )}
            {data && !loading && data.items.length > 0 && (
              <>
                {marketer && !isPhone && (
                  <div className="workbench-view-toggle">
                    <span className="workbench-view-toggle__label">View</span>
                    <button
                      type="button"
                      className={`btn-ghost btn-sm${contentViewMode === "list" ? " active" : ""}`}
                      onClick={() => contentViewMode !== "list" && toggleContentViewMode()}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      className={`btn-ghost btn-sm${contentViewMode === "grid" ? " active" : ""}`}
                      onClick={() => contentViewMode !== "grid" && toggleContentViewMode()}
                    >
                      Grid
                    </button>
                  </div>
                )}
                <TaskTable
                  items={data.items}
                  groupBy={groupBy}
                  page={data.page}
                  limit={data.limit}
                  total={data.total}
                  missingPreviewCount={data.missingPreviewCount}
                  statusCounts={data.statusCounts}
                  showProjectColumn={!brandSlug && data.scope === "all"}
                  contentSlug={validStatus === "in_review" ? "t" : "content"}
                  showQuickApprove={validStatus === "in_review"}
                  marketerMode={marketer}
                  viewMode={marketer ? (isPhone ? "grid" : contentViewMode) : "list"}
                  hideTitleColumn={marketer}
                  onRowSelect={openTaskRow}
                  onAfterDecision={fetchTasks}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function WorkbenchView(props: WorkbenchViewProps) {
  const title = props.mode === "marketer" ? MARKETER_LABELS.contentReview : "Review Console";
  return (
    <Suspense
      fallback={
        <div>
          <div className="page-header">
            <h2>{title}</h2>
          </div>
          <div style={{ padding: "28px", color: "var(--muted)" }}>Loading…</div>
        </div>
      }
    >
      <WorkbenchInner {...props} />
    </Suspense>
  );
}
