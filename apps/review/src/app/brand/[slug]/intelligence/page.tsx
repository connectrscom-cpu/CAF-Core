"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { IntelligenceBoard } from "@/components/marketer/IntelligenceBoard";
import type { BrandSummary } from "@/lib/marketer/types";

function IntelligencePageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const packId = searchParams.get("packId");
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands?lite=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null))
      .catch(() => setBrand(null));
  }, [slug]);

  return (
    <div className="brand-section-page" data-agent-id="market-intelligence-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle="Winning patterns, trends, and recommended directions"
      />
      <IntelligenceBoard slug={slug} initialPackId={packId} />
    </div>
  );
}

export default function BrandIntelligencePage() {
  return (
    <Suspense fallback={<p className="workspace-muted">Loading intelligence…</p>}>
      <IntelligencePageInner />
    </Suspense>
  );
}
