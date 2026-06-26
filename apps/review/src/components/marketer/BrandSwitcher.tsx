"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { brandAvatarStylePlain, brandInitials } from "@/lib/marketer/brand-adapters";
import type { BrandSummary } from "@/lib/marketer/types";

interface BrandsResponse {
  ok: boolean;
  brands: BrandSummary[];
}

export function BrandSwitcher() {
  const { ready, activeBrandSlug, switchBrand, brandHref } = useReviewProject();
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    fetch("/api/workspace/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: BrandsResponse | null) => {
        if (j?.brands) setBrands(j.brands);
      })
      .catch(() => {});
  }, [ready]);

  const active = useMemo(
    () => brands.find((b) => b.slug === activeBrandSlug),
    [brands, activeBrandSlug]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter(
      (b) => b.displayName.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q)
    );
  }, [brands, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = active?.displayName ?? (activeBrandSlug || "Select a brand");

  return (
    <div className="brand-switcher" ref={panelRef} data-agent-id="brand-switcher">
      <button
        type="button"
        className="brand-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="brand-switcher-avatar" style={brandAvatarStylePlain(active?.accentColor ?? null)}>
          {brandInitials(label)}
        </span>
        <span className="brand-switcher-label">
          <span className="brand-switcher-kicker">Brand</span>
          <span className="brand-switcher-name">{ready ? label : "Loading…"}</span>
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="brand-switcher-panel" role="listbox">
          {brands.length > 5 && (
            <input
              type="search"
              className="brand-switcher-search"
              placeholder="Search brands…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          <Link href="/workspace" className="brand-switcher-item" onClick={() => setOpen(false)}>
            <span className="brand-switcher-item-icon">◎</span>
            <span>All brands</span>
          </Link>
          <div className="brand-switcher-divider" />
          {filtered.map((b) => (
            <button
              key={b.slug}
              type="button"
              role="option"
              aria-selected={b.slug === activeBrandSlug}
              className={`brand-switcher-item ${b.slug === activeBrandSlug ? "is-active" : ""}`}
              onClick={() => {
                switchBrand(b.slug);
                setOpen(false);
              }}
            >
              <span className="brand-switcher-avatar brand-switcher-avatar--sm" style={brandAvatarStylePlain(b.accentColor)}>
                {brandInitials(b.displayName)}
              </span>
              <span className="brand-switcher-item-text">
                <strong>{b.displayName}</strong>
                {b.stats.pendingReview > 0 && (
                  <span className="brand-switcher-badge">{b.stats.pendingReview} to review</span>
                )}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <div className="brand-switcher-empty">No brands match your search.</div>}
          {activeBrandSlug && (
            <>
              <div className="brand-switcher-divider" />
              <Link
                href={brandHref(activeBrandSlug)}
                className="brand-switcher-item brand-switcher-item--muted"
                onClick={() => setOpen(false)}
              >
                Open brand dashboard
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="brand-switcher-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
