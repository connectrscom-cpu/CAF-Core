"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { ResearchBoard } from "@/components/marketer/ResearchBoard";
import type { BrandSummary } from "@/lib/marketer/types";

export default function BrandResearchPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null));
  }, [slug]);

  return (
    <div className="brand-section-page" data-agent-id="research-page">
      {brand && (
        <BrandPageHeader
          displayName={brand.displayName}
          slug={slug}
          accentColor={brand.accentColor}
          subtitle="Accounts, hashtags, competitors — and your research briefs"
        />
      )}
      <ResearchBoard slug={slug} />
    </div>
  );
}
