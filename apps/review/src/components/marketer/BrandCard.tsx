"use client";

import Link from "next/link";
import { brandAvatarStylePlain, brandInitials } from "@/lib/marketer/brand-adapters";
import type { BrandSummary } from "@/lib/marketer/types";

export function BrandCard({ brand }: { brand: BrandSummary }) {
  const href = `/brand/${encodeURIComponent(brand.slug)}`;

  return (
    <Link href={href} className="brand-card">
      <div className="brand-card-header">
        <span className="brand-card-avatar" style={brandAvatarStylePlain(brand.accentColor)}>
          {brandInitials(brand.displayName)}
        </span>
        <div className="brand-card-titles">
          <h3>{brand.displayName}</h3>
          {brand.onboardingProgress < 100 && (
            <span className="brand-card-setup">Setup {brand.onboardingProgress}% complete</span>
          )}
        </div>
      </div>

      <div className="brand-card-stats">
        {brand.stats.pendingReview > 0 && (
          <span className="brand-stat brand-stat--warn">{brand.stats.pendingReview} to review</span>
        )}
        {brand.stats.approved > 0 && (
          <span className="brand-stat brand-stat--ok">{brand.stats.approved} approved</span>
        )}
        {brand.stats.scheduledPosts > 0 && (
          <span className="brand-stat">{brand.stats.scheduledPosts} scheduled</span>
        )}
        {brand.ideasReady > 0 && <span className="brand-stat">{brand.ideasReady} ideas ready</span>}
        {brand.stats.pendingReview === 0 &&
          brand.stats.approved === 0 &&
          brand.stats.scheduledPosts === 0 &&
          brand.ideasReady === 0 && <span className="brand-stat brand-stat--muted">No active content yet</span>}
      </div>

      {brand.setupWarnings.length > 0 && (
        <ul className="brand-card-warnings">
          {brand.setupWarnings.slice(0, 2).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <span className="brand-card-cta">Open brand →</span>
    </Link>
  );
}
