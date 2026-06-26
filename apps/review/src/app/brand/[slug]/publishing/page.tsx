"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { PublishingView } from "@/components/marketer/PublishingView";
import type { BrandSummary } from "@/lib/marketer/types";

export default function BrandPublishingPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null))
      .catch(() => setBrand(null));
  }, [slug]);

  return (
    <div className="brand-section-page" data-agent-id="publishing-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle="Schedule and track posts across platforms"
      />
      <PublishingView slug={slug} />
    </div>
  );
}
