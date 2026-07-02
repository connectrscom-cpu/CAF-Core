"use client";

import type { BrandBible } from "@/lib/marketer/types";
import { brandBibleIsConfigured } from "@/lib/marketer/brand-bible-adapters";

export function BrandBibleHowItApplies({ bible, slug }: { bible: BrandBible; slug: string }) {
  const configured = brandBibleIsConfigured(bible);
  const roleCount = bible.assetRefs.length;
  const paletteCount = bible.palette.length;

  return (
    <div className="brand-bible-how-it-applies">
      <section className="profile-section">
        <h3 className="profile-section-title">How CAF uses your brand bible</h3>
        <p className="brand-bible-lead">
          The moodboard is your visual library. When you turn on <strong>Use Brand Visual System</strong> for an
          idea or top performer, CAF freezes the active bible onto that job and applies it during copy and image
          generation — while still borrowing structure from references.
        </p>
      </section>

      <section className="profile-section brand-bible-how-grid">
        <article className="brand-bible-how-card">
          <h4>1 · Queue with BVS on</h4>
          <p>
            In <a href={`/brand/${encodeURIComponent(slug)}/ideas`}>Ideas</a>, expand an item and leave{" "}
            <em>Use Brand Visual System</em> checked before <strong>Queue for generation</strong>. You can toggle per
            item in the cart too.
          </p>
        </article>
        <article className="brand-bible-how-card">
          <h4>2 · Snapshot at plan time</h4>
          <p>
            Palette, visual mode, motifs, application guide, and moodboard asset <em>roles</em> are saved on the job
            as <code>bvs_v1</code>. Uploading references alone is not enough — assign roles and save the bible.
          </p>
        </article>
        <article className="brand-bible-how-card">
          <h4>3 · Copy reinterpretation</h4>
          <p>
            For mimic flows, your guide and mimic policy steer how LLM copy is rewritten in your voice while keeping
            the reference slide beats.
          </p>
        </article>
        <article className="brand-bible-how-card">
          <h4>4 · Visual generation</h4>
          <p>
            Flux image prompts include your palette and motifs. Carousel theming can pull bible colors into template
            slides. Competitor pixels are never copied when BVS is on.
          </p>
        </article>
        <article className="brand-bible-how-card">
          <h4>5 · Review the result</h4>
          <p>
            Open generated content in{" "}
            <a href={`/brand/${encodeURIComponent(slug)}/content`}>Content</a> and expand{" "}
            <strong>Brand bible influence</strong> next to <strong>Why this works</strong> to see what was applied and
            how it maps to the slide you’re viewing.
          </p>
        </article>
      </section>

      <section className="profile-section">
        <h3 className="profile-section-title">Your bible readiness</h3>
        <ul className="brand-bible-readiness">
          <li className={configured ? "ok" : "warn"}>
            {configured ? "✓" : "○"} Visual rules configured (palette, motifs, or application guide)
          </li>
          <li className={paletteCount > 0 ? "ok" : "warn"}>
            {paletteCount > 0 ? "✓" : "○"} {paletteCount} palette color{paletteCount === 1 ? "" : "s"}
          </li>
          <li className={roleCount > 0 ? "ok" : "warn"}>
            {roleCount > 0 ? "✓" : "○"} {roleCount} moodboard asset role{roleCount === 1 ? "" : "s"} assigned
          </li>
          <li className={bible.version != null ? "ok" : "warn"}>
            {bible.version != null ? "✓" : "○"} Saved bible version{bible.version != null ? ` (v${bible.version})` : ""}
          </li>
        </ul>
        {!configured && (
          <p className="profile-field-hint">
            Add at least one palette color, motif, application note, or asset role on the Rules &amp; guide tab, then
            save.
          </p>
        )}
      </section>
    </div>
  );
}
