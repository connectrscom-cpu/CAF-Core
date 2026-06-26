"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandCard } from "@/components/marketer/BrandCard";
import { MARKETER_LABELS } from "@/lib/marketer/language";
import { WORKSPACE_FUNNEL_STEPS } from "@/lib/marketer/onboarding";
import type { BrandSummary } from "@/lib/marketer/types";

interface BrandsResponse {
  ok: boolean;
  brands: BrandSummary[];
}

export default function WorkspacePage() {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspace/brands")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load brands");
        return r.json();
      })
      .then((j: BrandsResponse) => setBrands(j.brands ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const needsAttention = brands.filter((b) => b.stats.pendingReview > 0 || b.setupWarnings.length > 0);

  return (
    <div className="workspace-page" data-agent-id="workspace-page">
      <header className="workspace-hero">
        <div>
          <h1>{MARKETER_LABELS.workspace}</h1>
          <p className="workspace-lead">
            Manage all your brands in one place. Pick a brand to see what needs your attention, from research to publishing.
          </p>
        </div>
      </header>

      <section className="workspace-funnel" aria-label="How CAF works">
        <h2 className="workspace-section-title">How it works</h2>
        <div className="workspace-funnel-grid">
          {WORKSPACE_FUNNEL_STEPS.map((step) => (
            <div key={step.step} className="workspace-funnel-card">
              <span className="workspace-funnel-num">{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {needsAttention.length > 0 && (
        <section className="workspace-attention">
          <h2 className="workspace-section-title">Needs your attention</h2>
          <div className="brand-card-grid">
            {needsAttention.map((b) => (
              <BrandCard key={b.slug} brand={b} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="workspace-section-header">
          <h2 className="workspace-section-title">{MARKETER_LABELS.brands}</h2>
          {!loading && <span className="workspace-count">{brands.length} total</span>}
        </div>
        {error && <p className="workspace-error">{error}</p>}
        {loading && <p className="workspace-muted">Loading your brands…</p>}
        {!loading && brands.length === 0 && (
          <div className="workspace-empty">
            <h3>No brands yet</h3>
            <p>Brands are created in CAF Admin. Once a project exists, it will appear here as a brand.</p>
            <p className="workspace-muted">
              Ask your CAF operator to add a brand, or enable multi-project mode to see all projects on this instance.
            </p>
          </div>
        )}
        {!loading && brands.length > 0 && (
          <div className="brand-card-grid">
            {brands.map((b) => (
              <BrandCard key={b.slug} brand={b} />
            ))}
          </div>
        )}
      </section>

      <footer className="workspace-footer">
        <Link href="/review?debug=1" className="workspace-footer-link">
          Open operator review console →
        </Link>
      </footer>
    </div>
  );
}
