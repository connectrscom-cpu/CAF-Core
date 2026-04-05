"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { Facets } from "@/lib/caf-core-client";

interface Props {
  facets: Facets;
}

export function FilterPanel({ facets }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = useCallback(
    (key: string) => searchParams.get(key) ?? "",
    [searchParams]
  );

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="workbench-filters">
      <div className="filter-header">
        <h3>Filters</h3>
        <button className="filter-save-btn">Save view</button>
      </div>

      <div className="filter-group">
        <label className="filter-label">Search</label>
        <input
          type="text"
          className="filter-input"
          placeholder="Task ID, hook, content..."
          defaultValue={current("search")}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilter("search", e.currentTarget.value);
          }}
          onBlur={(e) => setFilter("search", e.currentTarget.value)}
        />
      </div>

      <SelectFilter label="Project" filterKey="project" value={current("project")} options={[]} onChange={setFilter} />
      <SelectFilter label="Run" filterKey="run_id" value={current("run_id")} options={facets.runs} onChange={setFilter} />
      <SelectFilter label="Platform" filterKey="platform" value={current("platform")} options={facets.platforms} onChange={setFilter} />
      <SelectFilter label="Flow type" filterKey="flow_type" value={current("flow_type")} options={facets.flow_types} onChange={setFilter} />

      <div className="filter-divider" />

      <SelectFilter
        label="Review status"
        filterKey="review_status"
        value={current("review_status")}
        options={facets.statuses}
        onChange={setFilter}
      />
      <SelectFilter
        label="Decision"
        filterKey="decision"
        value={current("decision")}
        options={["APPROVED", "NEEDS_EDIT", "REJECTED"]}
        onChange={setFilter}
        placeholder="Any"
      />
      <SelectFilter
        label="Recommended route"
        filterKey="recommended_route"
        value={current("recommended_route")}
        options={facets.routes}
        onChange={setFilter}
      />

      <div className="filter-group">
        <label className="filter-label">QC status</label>
        <input
          type="text"
          className="filter-input"
          placeholder=""
          defaultValue={current("qc_status")}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilter("qc_status", e.currentTarget.value);
          }}
          onBlur={(e) => setFilter("qc_status", e.currentTarget.value)}
        />
      </div>

      <div className="filter-group">
        <label className="filter-label">Risk score (min)</label>
        <input
          type="number"
          className="filter-input"
          placeholder=""
          defaultValue={current("risk_score_min")}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilter("risk_score_min", e.currentTarget.value);
          }}
          onBlur={(e) => setFilter("risk_score_min", e.currentTarget.value)}
        />
      </div>

      <SelectFilter
        label="Has preview"
        filterKey="has_preview"
        value={current("has_preview")}
        options={["true"]}
        labels={["Yes"]}
        onChange={setFilter}
        placeholder="Any"
      />

      <div className="filter-divider" />

      <SelectFilter
        label="Group by"
        filterKey="group_by"
        value={current("group_by")}
        options={["project", "platform", "flow_type", "recommended_route"]}
        labels={["Project", "Platform", "Flow type", "Recommended route"]}
        onChange={setFilter}
        placeholder="None"
      />
      <SelectFilter
        label="Sort"
        filterKey="sort"
        value={current("sort")}
        options={["task_id", "newest", "oldest", "status"]}
        labels={["Task ID", "Submitted (newest)", "Submitted (oldest)", "Review status"]}
        onChange={setFilter}
        placeholder="Default"
      />
    </div>
  );
}

function SelectFilter({
  label,
  filterKey,
  value,
  options,
  labels,
  onChange,
  placeholder = "All",
}: {
  label: string;
  filterKey: string;
  value: string;
  options: string[];
  labels?: string[];
  onChange: (key: string, value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="filter-group">
      <label className="filter-label">{label}</label>
      <select
        className="filter-select"
        value={value}
        onChange={(e) => onChange(filterKey, e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((opt, i) => (
          <option key={opt} value={opt}>
            {labels ? labels[i] : opt}
          </option>
        ))}
      </select>
    </div>
  );
}
