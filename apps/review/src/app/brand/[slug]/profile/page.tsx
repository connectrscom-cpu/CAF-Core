"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { BrandProfileEditor } from "@/components/marketer/BrandProfileEditor";
import type { BrandSummary } from "@/lib/marketer/types";

export default function BrandProfilePage() {
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
    <div className="brand-section-page" data-agent-id="brand-profile-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle="Voice, audience, visual style, brand kit, and brand rules"
      />
      <BrandProfileEditor slug={slug} />
    </div>
  );
}
