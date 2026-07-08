"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BrandBibleHeygenPresenters } from "@/components/marketer/BrandBibleHeygenPresenters";
import { toBrandBible, toBrandBibleJson } from "@/lib/marketer/brand-bible-adapters";
import type { BrandBibleHeygenPresenter } from "@/lib/marketer/types";

type Props = {
  slug: string;
};

export function BrandProfileHeygenSection({ slug }: Props) {
  const [presenters, setPresenters] = useState<BrandBibleHeygenPresenter[]>([]);
  const [bibleLoaded, setBibleLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load brand bible");
      const bible = toBrandBible(slug, j.parsed, j.version ?? null);
      setPresenters(bible.heygenPresenters);
      setBibleLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setBibleLoaded(true);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePresenters() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load brand bible");
      const bible = toBrandBible(slug, j.parsed, j.version ?? null);
      const merged = { ...toBrandBibleJson({ ...bible, heygenPresenters: presenters }) };
      const saveRes = await fetch(`/api/brand/${encodeURIComponent(slug)}/brand-bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bible_json: merged }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || !saved.ok) throw new Error(saved.error ?? "Save failed");
      setMessage("Video presenters saved to Brand Visual System.");
      setPresenters(toBrandBible(slug, saved.parsed, saved.version ?? null).heygenPresenters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="profile-section brand-profile-heygen-block" data-agent-id="brand-profile-heygen">
      <div className="brand-profile-heygen-block__head">
        <div>
          <h3 className="profile-section-title">HeyGen video presenters</h3>
          <p className="profile-field-hint">
            Browse avatar previews and voice samples for Sign And Sound video jobs. Combos sync to project video
            defaults when saved.
          </p>
        </div>
        <Link className="btn-ghost btn-sm" href={`/brand/${encodeURIComponent(slug)}/profile?tab=bible`}>
          Brand assets →
        </Link>
      </div>

      {!bibleLoaded ? <p className="workspace-muted">Loading HeyGen catalog…</p> : null}

      <BrandBibleHeygenPresenters slug={slug} presenters={presenters} onChange={setPresenters} embedded />

      <div className="brand-profile-heygen-block__actions">
        <button type="button" className="btn-primary btn-sm" disabled={saving || !bibleLoaded} onClick={() => void savePresenters()}>
          {saving ? "Saving…" : "Save video presenters"}
        </button>
        {message ? <span className="profile-save-ok">{message}</span> : null}
        {error ? <span className="workspace-error">{error}</span> : null}
      </div>
    </section>
  );
}
