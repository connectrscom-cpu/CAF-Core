"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { IdeasBoard } from "@/components/marketer/IdeasBoard";
import type { BrandSummary } from "@/lib/marketer/types";

function IdeasPageInner() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands?lite=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null))
      .catch(() => setBrand(null));
  }, [slug]);

  return (
    <div className="brand-section-page" data-agent-id="ideas-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle="Curated content concepts — pick what to create"
      />
      <IdeasBoard slug={slug} />
    </div>
  );
}

export default function BrandIdeasPage() {
  return (
    <Suspense fallback={<p className="workspace-muted">Loading ideas…</p>}>
      <IdeasPageInner />
    </Suspense>
  );
}
