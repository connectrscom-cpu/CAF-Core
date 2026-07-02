"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandBibleEditor } from "@/components/marketer/BrandBibleEditor";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import { BrandProfileEditor } from "@/components/marketer/BrandProfileEditor";
import type { BrandSummary } from "@/lib/marketer/types";

type ProfileTab = "profile" | "bible";

function tabFromParam(tab: string | null): ProfileTab {
  return tab === "bible" ? "bible" : "profile";
}

export default function BrandProfilePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);
  const [tab, setTab] = useState<ProfileTab>(() => tabFromParam(searchParams.get("tab")));

  useEffect(() => {
    setTab(tabFromParam(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    if (!slug) return;
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null))
      .catch(() => setBrand(null));
  }, [slug]);

  const base = `/brand/${encodeURIComponent(slug)}/profile`;

  return (
    <div className="brand-section-page" data-agent-id="brand-profile-page">
      <BrandPageHeader
        displayName={brand?.displayName ?? slug}
        slug={slug}
        accentColor={brand?.accentColor}
        subtitle={
          tab === "bible"
            ? "Brand Visual System — style bible, references, and how CAF applies your look"
            : "Voice, audience, visual style, brand kit, and brand rules"
        }
      />

      <div className="tabs profile-tabs" style={{ marginBottom: 20 }}>
        <a
          href={base}
          className={`tab ${tab === "profile" ? "active" : ""}`}
          data-agent-id="brand-profile-tab-profile"
        >
          Brand profile
        </a>
        <a
          href={`${base}?tab=bible`}
          className={`tab ${tab === "bible" ? "active" : ""}`}
          data-agent-id="brand-profile-tab-bible"
        >
          Brand bible
        </a>
      </div>

      {tab === "bible" ? <BrandBibleEditor slug={slug} /> : <BrandProfileEditor slug={slug} />}
    </div>
  );
}
