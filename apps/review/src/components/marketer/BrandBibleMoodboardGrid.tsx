"use client";

import type { ReactNode } from "react";
import { brandAssetProxyUrl } from "@/lib/brand-asset-url";
import { BRAND_BIBLE_ASSET_ROLES } from "@/lib/marketer/brand-bible-adapters";
import type { BrandBibleAssetRef } from "@/lib/marketer/types";
import type { MoodboardAsset } from "./BrandBibleAssetInspectModal";

type Props = {
  slug: string;
  assets: MoodboardAsset[];
  assetRefs: BrandBibleAssetRef[];
  palette: string[];
  onInspect: (asset: MoodboardAsset) => void;
  onAddClick: () => void;
};

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    logo: "Logo",
    reference_image: "Reference",
    palette: "Palette",
    font: "Type",
    other: "Other",
  };
  return map[kind] ?? kind;
}

function rolesForAsset(assetId: string, refs: BrandBibleAssetRef[]) {
  return refs.filter((r) => r.assetId === assetId);
}

function assetThumb(slug: string, asset: MoodboardAsset): ReactNode {
  if (asset.kind === "palette" && Array.isArray(asset.metadata_json?.colors)) {
    const colors = (asset.metadata_json!.colors as unknown[]).filter((c) => typeof c === "string").slice(0, 5);
    return (
      <div className="brand-bible-moodboard-palette">
        {colors.map((c, i) => (
          <span key={i} style={{ background: String(c) }} />
        ))}
      </div>
    );
  }

  const isImg = asset.kind === "logo" || asset.kind === "reference_image" || asset.kind === "other";
  const src = isImg ? brandAssetProxyUrl(slug, asset) || asset.public_url || "" : "";
  if (src) {
    return <img src={src} alt="" className="brand-bible-moodboard-img" loading="lazy" />;
  }

  if (asset.kind === "font" && typeof asset.metadata_json?.font_family === "string") {
    return (
      <div className="brand-bible-moodboard-font" style={{ fontFamily: String(asset.metadata_json.font_family) }}>
        Aa
      </div>
    );
  }

  return <div className="brand-bible-moodboard-placeholder">{kindLabel(asset.kind)}</div>;
}

export function BrandBibleMoodboardGrid({ slug, assets, assetRefs, palette, onInspect, onAddClick }: Props) {
  const imageCount = assets.filter((a) =>
    ["logo", "reference_image", "other"].includes(a.kind)
  ).length;

  return (
    <div className="brand-bible-moodboard">
      <div className="brand-bible-moodboard-hero">
        <div className="brand-bible-moodboard-hero-copy">
          <h3>Your brand moodboard</h3>
          <p>
            Collect logos, style references, characters, and textures here. CAF uses this visual library when
            the Brand Visual System is on — especially when mimicking trends with your own look.
          </p>
        </div>
        <div className="brand-bible-moodboard-stats">
          <span>{assets.length} assets</span>
          <span>{imageCount} images</span>
          {palette.length > 0 && <span>{palette.length} bible colors</span>}
        </div>
      </div>

      {palette.length > 0 && (
        <div className="brand-bible-moodboard-palette-strip" aria-label="Brand palette">
          {palette.map((c, i) => (
            <span key={`${c}-${i}`} className="brand-bible-moodboard-palette-chip" style={{ background: c }} title={c} />
          ))}
        </div>
      )}

      <div className="brand-bible-moodboard-grid">
        <button type="button" className="brand-bible-moodboard-tile brand-bible-moodboard-tile--add" onClick={onAddClick}>
          <span className="brand-bible-moodboard-add-icon">+</span>
          <span>Add reference</span>
        </button>

        {assets.map((asset) => {
          const roles = rolesForAsset(asset.id, assetRefs);
          return (
            <button
              key={asset.id}
              type="button"
              className="brand-bible-moodboard-tile"
              onClick={() => onInspect(asset)}
            >
              <div className="brand-bible-moodboard-tile-media">{assetThumb(slug, asset)}</div>
              <div className="brand-bible-moodboard-tile-foot">
                <span className="brand-bible-moodboard-tile-kind">{kindLabel(asset.kind)}</span>
                <span className="brand-bible-moodboard-tile-label">{asset.label ?? "Untitled"}</span>
                {roles.length > 0 && (
                  <div className="brand-bible-moodboard-tile-roles">
                    {roles.slice(0, 2).map((r) => (
                      <span key={r.role} className="profile-chip">
                        {BRAND_BIBLE_ASSET_ROLES.find((x) => x.id === r.role)?.label ?? r.role}
                      </span>
                    ))}
                    {roles.length > 2 && <span className="brand-bible-moodboard-more">+{roles.length - 2}</span>}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {assets.length === 0 && (
        <p className="brand-bible-moodboard-empty">
          Start your moodboard — upload reference posts, illustration style, mascots, or palette swatches.
        </p>
      )}
    </div>
  );
}
