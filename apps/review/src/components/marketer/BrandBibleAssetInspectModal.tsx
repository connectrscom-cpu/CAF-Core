"use client";

import { brandAssetProxyUrl } from "@/lib/brand-asset-url";
import { BRAND_BIBLE_ASSET_ROLES } from "@/lib/marketer/brand-bible-adapters";
import type { BrandBibleAssetRef, BrandBibleAssetRole } from "@/lib/marketer/types";

export type MoodboardAsset = {
  id: string;
  kind: string;
  label: string | null;
  public_url: string | null;
  metadata_json?: Record<string, unknown>;
};

type Props = {
  slug: string;
  asset: MoodboardAsset;
  assetRefs: BrandBibleAssetRef[];
  onClose: () => void;
  onEdit: () => void;
  onAddRole: (role: BrandBibleAssetRole) => void;
  onRemoveRole: (role: BrandBibleAssetRole) => void;
  onUsageNotes: (role: BrandBibleAssetRole, notes: string) => void;
};

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    logo: "Logo",
    reference_image: "Reference",
    palette: "Palette",
    font: "Typography",
    other: "Other",
  };
  return map[kind] ?? kind;
}

function assetImageUrl(slug: string, asset: MoodboardAsset): string {
  if (asset.kind === "logo" || asset.kind === "reference_image" || asset.kind === "other") {
    return brandAssetProxyUrl(slug, asset) || asset.public_url || "";
  }
  return "";
}

export function BrandBibleAssetInspectModal({
  slug,
  asset,
  assetRefs,
  onClose,
  onEdit,
  onAddRole,
  onRemoveRole,
  onUsageNotes,
}: Props) {
  const roles = assetRefs.filter((r) => r.assetId === asset.id);
  const imgSrc = assetImageUrl(slug, asset);
  const paletteColors = Array.isArray(asset.metadata_json?.colors)
    ? (asset.metadata_json!.colors as unknown[]).filter((c) => typeof c === "string")
    : [];

  return (
    <div className="brand-bible-inspect-overlay" role="presentation" onClick={onClose}>
      <div
        className="brand-bible-inspect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-bible-inspect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="brand-bible-inspect-header">
          <div>
            <p className="brand-bible-inspect-kind">{kindLabel(asset.kind)}</p>
            <h3 id="brand-bible-inspect-title">{asset.label ?? "Untitled asset"}</h3>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="brand-bible-inspect-body">
          <div className="brand-bible-inspect-media">
            {asset.kind === "palette" && paletteColors.length > 0 ? (
              <div className="brand-bible-inspect-palette">
                {paletteColors.map((c, i) => (
                  <div key={`${c}-${i}`} className="brand-bible-inspect-palette-swatch" style={{ background: String(c) }}>
                    <span>{String(c)}</span>
                  </div>
                ))}
              </div>
            ) : imgSrc ? (
              <img src={imgSrc} alt="" className="brand-bible-inspect-img" />
            ) : asset.kind === "font" && typeof asset.metadata_json?.font_family === "string" ? (
              <div className="brand-bible-inspect-font" style={{ fontFamily: String(asset.metadata_json.font_family) }}>
                Aa Bb Cc — {String(asset.metadata_json.font_family)}
              </div>
            ) : (
              <div className="brand-bible-inspect-placeholder">No preview available</div>
            )}
          </div>

          <div className="brand-bible-inspect-meta">
            <h4>Roles in brand bible</h4>
            <p className="brand-bible-inspect-hint">
              Tell CAF how to use this asset — style reference, character, motif, or what to avoid.
            </p>
            {roles.length > 0 && (
              <ul className="brand-bible-inspect-roles">
                {roles.map((ref) => (
                  <li key={ref.role}>
                    <div className="brand-bible-inspect-role-head">
                      <span className="profile-chip active">
                        {BRAND_BIBLE_ASSET_ROLES.find((r) => r.id === ref.role)?.label ?? ref.role}
                      </span>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => onRemoveRole(ref.role)}>
                        Remove
                      </button>
                    </div>
                    <textarea
                      className="profile-field-input"
                      rows={2}
                      value={ref.usageNotes}
                      onChange={(e) => onUsageNotes(ref.role, e.target.value)}
                      placeholder="e.g. Use on educational slides only; never on product shots"
                    />
                  </li>
                ))}
              </ul>
            )}
            <select
              className="profile-field-input"
              defaultValue=""
              onChange={(e) => {
                const role = e.target.value as BrandBibleAssetRole;
                if (role) onAddRole(role);
                e.target.value = "";
              }}
            >
              <option value="">+ Assign role…</option>
              {BRAND_BIBLE_ASSET_ROLES.filter((r) => !roles.some((x) => x.role === r.id)).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <footer className="brand-bible-inspect-footer">
          <button type="button" className="btn-ghost" onClick={onEdit}>
            Edit file
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
