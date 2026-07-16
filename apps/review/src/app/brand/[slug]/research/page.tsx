"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { ResearchBoard, type ResearchMainTab } from "@/components/marketer/ResearchBoard";
import type { BrandSummary } from "@/lib/marketer/types";

function tabFromParam(tab: string | null): ResearchMainTab {
  if (tab === "analysis" || tab === "research-analysis") return "analysis";
  return "scrapers";
}

export default function BrandResearchPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [tab, setTab] = useState<ResearchMainTab>(() => tabFromParam(searchParams.get("tab")));

  useEffect(() => {
    setTab(tabFromParam(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/workspace/brands?lite=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null));
  }, [slug]);

  const base = `/brand/${encodeURIComponent(slug)}/research`;

  return (
    <div className="brand-section-page" data-agent-id="research-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle={
          tab === "analysis"
            ? "Pick a scrape run, set cutoffs, and build your research brief"
            : "Watchlists and scrapers — collect posts before analysis"
        }
      />

      <div className="tabs profile-tabs" style={{ marginBottom: 20 }}>
        <a
          href={base}
          className={`tab ${tab === "scrapers" ? "active" : ""}`}
          data-agent-id="research-tab-scrapers"
        >
          Scrapers
        </a>
        <a
          href={`${base}?tab=analysis`}
          className={`tab ${tab === "analysis" ? "active" : ""}`}
          data-agent-id="research-tab-analysis"
        >
          Research analysis
        </a>
      </div>

      <ResearchBoard slug={slug} tab={tab} />
    </div>
  );
}
