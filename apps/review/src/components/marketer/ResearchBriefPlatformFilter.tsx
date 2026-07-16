"use client";

import { RESEARCH_RUN_PLATFORMS } from "@/lib/marketer/research-adapters";

interface ResearchBriefPlatformFilterProps {
  value: string;
  onChange: (platformId: string) => void;
  className?: string;
  label?: string;
}

export function ResearchBriefPlatformFilter({
  value,
  onChange,
  className,
  label = "Platform",
}: ResearchBriefPlatformFilterProps) {
  return (
    <label className={className ?? "research-brief-platform-filter"}>
      <span>{label}</span>
      <select
        value={value || "all"}
        onChange={(e) => onChange(e.target.value === "all" ? "all" : e.target.value)}
      >
        <option value="all">All platforms</option>
        {RESEARCH_RUN_PLATFORMS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
