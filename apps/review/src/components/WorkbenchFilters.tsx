"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const QUERY_KEYS = [
  "project", "run_id", "platform", "flow_type", "review_status",
  "decision", "recommended_route", "qc_status", "risk_score_min",
  "has_preview", "search", "sort", "page", "limit",
] as const;

const REVIEW_STATUS_FALLBACK = ["", "READY", "IN_REVIEW", "SUBMITTED", "APPROVED", "NEEDS_EDIT", "REJECTED"];
const DECISION_OPTIONS = ["", "APPROVED", "NEEDS_EDIT", "REJECTED"];
const GROUP_OPTIONS = ["", "project", "platform", "flow_type", "recommended_route"] as const;

function runOptionLabel(runId: string, names?: Record<string, string>): string {
  const label = names?.[runId]?.trim();
  if (!label) return runId;
  const short = label.length > 72 ? `${label.slice(0, 70)}…` : label;
  return `${short} — ${runId}`;
}

export interface WorkbenchFiltersProps {
  className?: string;
  basePath?: string;
  projectValues?: string[];
  runIdValues?: string[];
  /** `run_id` → `runs.metadata_json.display_name` (from Core review facets). */
  runDisplayNames?: Record<string, string>;
  platformValues?: string[];
  flowTypeValues?: string[];
  recommendedRouteValues?: string[];
  reviewStatusValues?: string[];
}

export function WorkbenchFilters({
  basePath = "/",
  projectValues = [],
  runIdValues = [],
  runDisplayNames,
  platformValues = [],
  flowTypeValues = [],
  recommendedRouteValues = [],
  reviewStatusValues,
}: WorkbenchFiltersProps) {
  const reviewStatusOptions = reviewStatusValues?.length
    ? ["", ...reviewStatusValues.sort((a, b) => (a === "(empty)" ? 1 : b === "(empty)" ? -1 : a.localeCompare(b)))]
    : REVIEW_STATUS_FALLBACK;
  const router = useRouter();
  const searchParams = useSearchParams();

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    QUERY_KEYS.forEach((k) => {
      const v = searchParams.get(k);
      if (v != null && v !== "") p[k] = v;
    });
    const group = searchParams.get("group");
    if (group) p.group = group;
    return p;
  }, [searchParams]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === "" || value == null) next.delete(key);
      else next.set(key, value);
      next.delete("page");
      const path = basePath.replace(/\/$/, "") || "/";
      router.push(`${path}?${next.toString()}`, { scroll: false });
    },
    [router, searchParams, basePath]
  );

  const saveView = useCallback(() => {
    const name = prompt("View name (optional)");
    if (name == null) return;
    const state = Object.fromEntries(searchParams.entries());
    const key = name.trim() ? `caf-view-${name.trim()}` : "caf-view-default";
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) { console.warn("localStorage save failed", e); }
  }, [searchParams]);

  return (
    <>
      <div className="filter-header">
        <h3>Filters</h3>
        <button type="button" className="filter-save-btn" onClick={saveView}>Save view</button>
      </div>

      <div className="filter-group">
        <label className="filter-label">Search</label>
        <input
          type="text"
          className="filter-input"
          placeholder="task_id, title, caption..."
          value={params.search ?? ""}
          onChange={(e) => setParam("search", e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label className="filter-label">Project</label>
        <select className="filter-select" value={params.project ?? ""} onChange={(e) => setParam("project", e.target.value)}>
          <option value="">All</option>
          {projectValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Run</label>
        <select className="filter-select" value={params.run_id ?? ""} onChange={(e) => setParam("run_id", e.target.value)}>
          <option value="">All</option>
          {runIdValues.map((v) => (
            <option key={v} value={v}>
              {runOptionLabel(v, runDisplayNames)}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Platform</label>
        <select className="filter-select" value={params.platform ?? ""} onChange={(e) => setParam("platform", e.target.value)}>
          <option value="">All</option>
          {platformValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Flow type</label>
        <select className="filter-select" value={params.flow_type ?? ""} onChange={(e) => setParam("flow_type", e.target.value)}>
          <option value="">All</option>
          {flowTypeValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Review status</label>
        <select className="filter-select" value={params.review_status ?? ""} onChange={(e) => setParam("review_status", e.target.value)}>
          {reviewStatusOptions.map((v) => (<option key={v} value={v}>{v === "" ? "All" : v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Decision</label>
        <select className="filter-select" value={params.decision ?? ""} onChange={(e) => setParam("decision", e.target.value)}>
          {DECISION_OPTIONS.map((v) => (<option key={v} value={v}>{v === "" ? "Any" : v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Recommended route</label>
        <select className="filter-select" value={params.recommended_route ?? ""} onChange={(e) => setParam("recommended_route", e.target.value)}>
          <option value="">All</option>
          {recommendedRouteValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="filter-divider" />

      <div className="filter-group">
        <label className="filter-label">QC status</label>
        <input type="text" className="filter-input" placeholder="e.g. PASS" value={params.qc_status ?? ""} onChange={(e) => setParam("qc_status", e.target.value)} />
      </div>

      <div className="filter-group">
        <label className="filter-label">Risk score (min)</label>
        <input type="number" className="filter-input" min={0} max={1} step={0.1} placeholder="0–1" value={params.risk_score_min ?? ""} onChange={(e) => setParam("risk_score_min", e.target.value)} />
      </div>

      <div className="filter-group">
        <label className="filter-label">Has preview</label>
        <select className="filter-select" value={params.has_preview ?? ""} onChange={(e) => setParam("has_preview", e.target.value)}>
          <option value="">Any</option>
          <option value="true">Yes</option>
        </select>
      </div>

      <div className="filter-divider" />

      <div className="filter-group">
        <label className="filter-label">Group by</label>
        <select className="filter-select" value={params.group ?? ""} onChange={(e) => setParam("group", e.target.value)}>
          <option value="">None</option>
          {GROUP_OPTIONS.filter(Boolean).map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Sort</label>
        <select className="filter-select" value={params.sort ?? "task_id"} onChange={(e) => setParam("sort", e.target.value)}>
          <option value="task_id">Task ID</option>
          <option value="-submitted_at">Submitted (newest)</option>
          <option value="submitted_at">Submitted (oldest)</option>
          <option value="-review_status">Review status</option>
        </select>
      </div>
    </>
  );
}
