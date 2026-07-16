"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandPageHeader } from "@/components/marketer/BrandPageHeader";
import type { BrandSummary } from "@/lib/marketer/types";

export default function BrandPerformancePage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [brand, setBrand] = useState<BrandSummary | null>(null);

  useEffect(() => {
    fetch("/api/workspace/brands?lite=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBrand(j?.brands?.find((b: BrandSummary) => b.slug === slug) ?? null));
  }, [slug]);

  const base = `/brand/${encodeURIComponent(slug)}`;

  return (
    <div className="brand-section-page" data-agent-id="performance-learning-page">
      {brand && (
        <BrandPageHeader
          displayName={brand.displayName}
          slug={slug}
          accentColor={brand.accentColor}
          subtitle="What worked, what didn't, and what to try next"
        />
      )}
      <div className="section-stub">
        <h2>Performance & learning</h2>
        <p className="section-stub-lead">
          We&apos;re building a marketer-friendly view of post performance and what CAF learned from your approvals and
          edits. After you publish content, engagement trends and recommendations will appear here.
        </p>
        <div className="section-stub-card">
          <h3>In development</h3>
          <ul>
            <li>What worked and what did not</li>
            <li>What CAF learned from your feedback</li>
            <li>Formats to increase or decrease</li>
            <li>Suggestions for the next content cycle</li>
          </ul>
        </div>
        <div className="section-stub-actions">
          <Link href={`${base}/content`} className="btn-primary">
            Review content
          </Link>
          <Link href={`${base}/publishing`} className="btn-ghost">
            Publishing
          </Link>
          <Link href={base} className="btn-ghost">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
