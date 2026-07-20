"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandCard } from "@/components/marketer/BrandCard";
import { LoadingWithTip, PageTip } from "@/components/marketer/PageTip";
import { MARKETER_LABELS } from "@/lib/marketer/language";
import { WORKSPACE_FUNNEL_STEPS } from "@/lib/marketer/onboarding";
import type { BrandSummary } from "@/lib/marketer/types";

interface BrandsResponse {
  ok: boolean;
  brands: BrandSummary[];
}

export default function WorkspacePage() {
  const router = useRouter();
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState("#2F6FED");
  const [packMarkdown, setPackMarkdown] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function reloadBrands() {
    setLoading(true);
    fetch("/api/workspace/brands")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load brands");
        return r.json();
      })
      .then((j: BrandsResponse) => setBrands(j.brands ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reloadBrands();
  }, []);

  const needsAttention = brands.filter((b) => b.stats.pendingReview > 0 || b.setupWarnings.length > 0);

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/workspace/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          slug: slug.trim() || undefined,
          color,
          onboardingPack: packMarkdown.trim() || undefined,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        brand?: { slug: string };
      };
      if (!res.ok || !j.ok || !j.brand?.slug) {
        throw new Error(j.message ?? "Could not create brand");
      }
      setShowCreate(false);
      setDisplayName("");
      setSlug("");
      setPackMarkdown("");
      router.push(`/brand/${encodeURIComponent(j.brand.slug)}/profile`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="workspace-page" data-agent-id="workspace-page">
      <header className="workspace-hero">
        <div>
          <h1>{MARKETER_LABELS.workspace}</h1>
          <p className="workspace-lead">
            Manage all your brands in one place. Pick a brand to see what needs your attention, from research to publishing.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          data-agent-id="workspace-new-brand"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "New brand"}
        </button>
      </header>

      {showCreate && (
        <section className="workspace-create" data-agent-id="workspace-create-brand">
          <h2 className="workspace-section-title">Create a brand</h2>
          <div className="workspace-setup-downloads" data-agent-id="workspace-setup-downloads">
            <p className="workspace-muted">
              <strong>Recommended:</strong> download the project setup checklist → paste it into your brand’s ChatGPT
              project → upload the filled pack below. Content routes and product fields (§7–§8) are in that pack.
              Visual/product <em>image</em> files use the separate asset checklists.
            </p>
            <ul className="workspace-setup-download-list">
              <li>
                <a href="/setup/PROJECT_SETUP_CHECKLIST.md" download>
                  Project setup checklist
                </a>{" "}
                — strategy, voice, routes, research, product copy (§7–§8)
              </li>
              <li>
                <a href="/setup/BRAND_BIBLE_ASSET_CHECKLIST.md" download>
                  Brand Bible asset checklist
                </a>{" "}
                — generate/upload visual assets after the pack
              </li>
              <li>
                <a href="/setup/PRODUCT_BIBLE_ASSET_CHECKLIST.md" download>
                  Product Bible asset checklist
                </a>{" "}
                — product screenshots if product routes are on
              </li>
            </ul>
          </div>
          <form onSubmit={(e) => void createBrand(e)} className="workspace-create-form">
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Cuisina"
                required
                data-agent-id="workspace-create-name"
              />
            </label>
            <label>
              Slug (optional)
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toUpperCase())}
                placeholder="CUISINA"
                data-agent-id="workspace-create-slug"
              />
            </label>
            <label>
              Accent color
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                data-agent-id="workspace-create-color"
              />
            </label>
            <label>
              Filled project setup pack (optional)
              <textarea
                rows={6}
                value={packMarkdown}
                onChange={(e) => setPackMarkdown(e.target.value)}
                placeholder="Paste the filled CAF Project Onboarding Pack markdown here…"
                data-agent-id="workspace-create-pack"
              />
            </label>
            <p className="workspace-muted" style={{ fontSize: 12 }}>
              Paste or upload the checklist <em>after</em> ChatGPT fills it. That auto-fills strategy, voice, visuals
              text, research lists, and enabled content routes. Or create empty and fill Profile later.
            </p>
            <input
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const text = await file.text();
                setPackMarkdown(text);
              }}
            />
            {createError && <p className="workspace-error">{createError}</p>}
            <button type="submit" className="btn-primary" disabled={creating || !displayName.trim()}>
              {creating ? "Creating…" : "Create brand"}
            </button>
          </form>
        </section>
      )}

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
        {loading && <LoadingWithTip page="workspace" label="Loading your brands…" />}
        {!loading && brands.length === 0 && (
          <div className="workspace-empty">
            <h3>No brands yet</h3>
            <p>Create your first brand to set up voice, visuals, research, and content routes — all in Review.</p>
            <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
              New brand
            </button>
            <PageTip page="workspace" salt="empty" />
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
