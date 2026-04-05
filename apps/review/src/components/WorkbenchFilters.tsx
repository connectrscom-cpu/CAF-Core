"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const QUERY_KEYS = [
  "project", "run_id", "platform", "flow_type", "review_status",
  "decision", "recommended_route", "qc_status", "risk_score_min",
  "has_preview", "search", "sort", "page", "limit",
] as const;

const REVIEW_STATUS_FALLBACK = ["", "READY", "IN_REVIEW", "SUBMITTED", "APPROVED", "NEEDS_EDIT", "REJECTED"];
const DECISION_OPTIONS = ["", "APPROVED", "NEEDS_EDIT", "REJECTED"];
const GROUP_OPTIONS = ["", "project", "platform", "flow_type", "recommended_route"] as const;

export interface WorkbenchFiltersProps {
  className?: string;
  basePath?: string;
  projectValues?: string[];
  runIdValues?: string[];
  platformValues?: string[];
  flowTypeValues?: string[];
  recommendedRouteValues?: string[];
  reviewStatusValues?: string[];
}

export function WorkbenchFilters({
  className,
  basePath = "/",
  projectValues = [],
  runIdValues = [],
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
    <aside className={cn("flex flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filters</h3>
        <Button variant="ghost" size="sm" onClick={saveView}>Save view</Button>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Search</Label>
        <Input placeholder="task_id, title, caption..." value={params.search ?? ""} onChange={(e) => setParam("search", e.target.value)} className="h-9" />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Project</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.project ?? ""} onChange={(e) => setParam("project", e.target.value)}>
          <option value="">All</option>
          {projectValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Run</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.run_id ?? ""} onChange={(e) => setParam("run_id", e.target.value)}>
          <option value="">All</option>
          {runIdValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Platform</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.platform ?? ""} onChange={(e) => setParam("platform", e.target.value)}>
          <option value="">All</option>
          {platformValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Flow type</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.flow_type ?? ""} onChange={(e) => setParam("flow_type", e.target.value)}>
          <option value="">All</option>
          {flowTypeValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Review status</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.review_status ?? ""} onChange={(e) => setParam("review_status", e.target.value)}>
          {reviewStatusOptions.map((v) => (<option key={v} value={v}>{v === "" ? "All" : v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Decision</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.decision ?? ""} onChange={(e) => setParam("decision", e.target.value)}>
          {DECISION_OPTIONS.map((v) => (<option key={v} value={v}>{v === "" ? "Any" : v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Recommended route</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.recommended_route ?? ""} onChange={(e) => setParam("recommended_route", e.target.value)}>
          <option value="">All</option>
          {recommendedRouteValues.map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">QC status</Label>
        <Input placeholder="e.g. PASS" value={params.qc_status ?? ""} onChange={(e) => setParam("qc_status", e.target.value)} className="h-9" />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Risk score (min)</Label>
        <Input type="number" min={0} max={1} step={0.1} placeholder="0–1" value={params.risk_score_min ?? ""} onChange={(e) => setParam("risk_score_min", e.target.value)} className="h-9" />
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Has preview</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.has_preview ?? ""} onChange={(e) => setParam("has_preview", e.target.value)}>
          <option value="">Any</option>
          <option value="true">Yes</option>
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Group by</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.group ?? ""} onChange={(e) => setParam("group", e.target.value)}>
          <option value="">None</option>
          {GROUP_OPTIONS.filter(Boolean).map((v) => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Sort</Label>
        <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={params.sort ?? "task_id"} onChange={(e) => setParam("sort", e.target.value)}>
          <option value="task_id">Task ID</option>
          <option value="-submitted_at">Submitted (newest)</option>
          <option value="submitted_at">Submitted (oldest)</option>
          <option value="-review_status">Review status</option>
        </select>
      </div>
    </aside>
  );
}
