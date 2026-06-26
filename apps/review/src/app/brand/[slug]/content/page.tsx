"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { WorkbenchView } from "@/components/WorkbenchView";
import { MARKETER_LABELS } from "@/lib/marketer/language";
import type { BrandSummary } from "@/lib/marketer/types";

export default function BrandContentPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null));
  }, [slug]);

  const tabBase = `/brand/${encodeURIComponent(slug)}/content`;

  return (
    <div className="brand-section-page brand-content-page" data-agent-id="content-page">
      {brand && (
        <BrandPageHeader
          displayName={brand.displayName}
          slug={slug}
          accentColor={brand.accentColor}
          subtitle={MARKETER_LABELS.contentReview}
        />
      )}
      <WorkbenchView mode="marketer" brandSlug={slug} tabBasePath={tabBase} />
    </div>
  );
}
