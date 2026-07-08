"use client";

import { useMemo } from "react";
import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import {
  BRAND_BIBLE_ASSET_ROLES,
  FLUX_PROMPT_ASSET_MAX,
} from "@/lib/marketer/brand-bible-adapters";
import type { BrandBible, BrandBibleAssetRef } from "@/lib/marketer/types";

type MoodboardAsset = {
  id: string;
  kind: string;
  label: string | null;
  public_url: string | null;
};

type Props = {
  slug: string;
  bible: BrandBible;
  assets: MoodboardAsset[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
};

function primaryRefForAsset(assetRefs: BrandBibleAssetRef[], assetId: string): BrandBibleAssetRef | null {
  const matches = assetRefs.filter((r) => r.assetId === assetId);
  if (matches.length === 0) return null;
  const preferred = matches.find((r) => r.role !== "anti_reference");
  return preferred ?? matches[0]!;
}

export function BrandBibleFluxReferences({ slug, bible, assets, selectedIds, onChange }: Props) {
  const pickable = useMemo(() => {
    const ids = new Set(bible.assetRefs.map((r) => r.assetId));
    const rows: Array<{
      asset: MoodboardAsset;
      ref: BrandBibleAssetRef;
    }> = [];
    for (const assetId of ids) {
      const asset = assets.find((a) => a.id === assetId);
      const ref = primaryRefForAsset(bible.assetRefs, assetId);
      if (!asset || !ref || ref.role === "anti_reference") continue;
      rows.push({ asset, ref });
    }
    return rows.sort((a, b) => {
      const ai = selectedIds.indexOf(a.asset.id);
      const bi = selectedIds.indexOf(b.asset.id);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return (a.ref.label || a.asset.label || "").localeCompare(b.ref.label || b.asset.label || "");
    });
  }, [assets, bible.assetRefs, selectedIds]);

  const atMax = selectedIds.length >= FLUX_PROMPT_ASSET_MAX;

  function toggle(assetId: string) {
    if (selectedIds.includes(assetId)) {
      onChange(selectedIds.filter((id) => id !== assetId));
      return;
    }
    if (atMax) return;
    onChange([...selectedIds, assetId]);
  }

  function move(assetId: string, delta: -1 | 1) {
    const idx = selectedIds.indexOf(assetId);
    if (idx < 0) return;
    const next = [...selectedIds];
    const swap = idx + delta;
    if (swap < 0 || swap >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[swap]!;
    next[swap] = tmp;
    onChange(next);
  }

  const roleLabel = (role: string) =>
    BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === role)?.label ?? role.replace(/_/g, " ");

  return (
    <section className="profile-section brand-bible-flux-section">
      <div className="brand-bible-flux-section__head">
        <div>
          <h3 className="profile-section-title">Flux prompt references</h3>
          <p className="profile-field-hint" style={{ marginBottom: 0 }}>
            Pick up to {FLUX_PROMPT_ASSET_MAX} moodboard assets whose labels and usage notes are injected per-line into
            Flux image prompts when Brand Visual System is on. Order matters — earlier entries weigh more in the prompt
            text. Only the competitor reference frame is sent as pixels; these steer style and subject cues.
          </p>
        </div>
        <span className={`brand-bible-flux-counter ${atMax ? "brand-bible-flux-counter--full" : ""}`}>
          {selectedIds.length} / {FLUX_PROMPT_ASSET_MAX} selected
        </span>
      </div>

      {selectedIds.length > 0 ? (
        <ol className="brand-bible-flux-selected-list">
          {selectedIds.map((assetId, i) => {
            const row = pickable.find((p) => p.asset.id === assetId);
            if (!row) return null;
            const { asset, ref } = row;
            return (
              <li key={assetId} className="brand-bible-flux-selected-card">
                <span className="brand-bible-flux-selected-card__index">{i + 1}</span>
                <BrandAssetImage
                  slug={slug}
                  asset={{ id: asset.id, public_url: asset.public_url }}
                  className="brand-bible-flux-selected-card__thumb"
                  alt=""
                />
                <div className="brand-bible-flux-selected-card__meta">
                  <strong>{ref.label || asset.label || "Asset"}</strong>
                  <span className="workspace-muted">
                    {roleLabel(ref.role)}
                    {ref.usageNotes ? ` · ${ref.usageNotes.slice(0, 80)}${ref.usageNotes.length > 80 ? "…" : ""}` : ""}
                  </span>
                </div>
                <div className="brand-bible-flux-selected-card__actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={i === 0}
                    onClick={() => move(assetId, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={i === selectedIds.length - 1}
                    onClick={() => move(assetId, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => toggle(assetId)}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="brand-bible-moodboard-empty">
          No Flux references selected — CAF uses aggregate role counts in the prompt until you pick specific assets.
        </p>
      )}

      {pickable.length === 0 ? (
        <p className="workspace-muted">
          Assign roles to moodboard assets first (Brand assets tab or moodboard inspect), then return here to pick Flux
          references.
        </p>
      ) : (
        <div className="brand-bible-flux-picker-grid">
          {pickable.map(({ asset, ref }) => {
            const selected = selectedIds.includes(asset.id);
            const disabled = !selected && atMax;
            return (
              <button
                key={asset.id}
                type="button"
                className={`brand-bible-flux-pick ${selected ? "active" : ""} ${disabled ? "disabled" : ""}`}
                onClick={() => toggle(asset.id)}
                disabled={disabled}
                title={ref.usageNotes || ref.label || asset.label || asset.id}
              >
                <BrandAssetImage
                  slug={slug}
                  asset={{ id: asset.id, public_url: asset.public_url }}
                  className="brand-bible-flux-pick__img"
                  alt=""
                />
                <span className="brand-bible-flux-pick__name">{ref.label || asset.label || "Asset"}</span>
                <span className="brand-bible-flux-pick__role">{roleLabel(ref.role)}</span>
                {selected ? <span className="brand-bible-flux-pick__badge">#{selectedIds.indexOf(asset.id) + 1}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
