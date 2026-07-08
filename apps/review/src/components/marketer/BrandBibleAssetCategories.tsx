"use client";

import { useRef, useState } from "react";
import { BrandAssetImage } from "@/components/marketer/BrandAssetImage";
import type { MoodboardAsset } from "@/components/marketer/BrandBibleAssetInspectModal";
import { uploadBrandReferenceImages } from "@/lib/marketer/brand-asset-quick-upload";
import { BRAND_BIBLE_ASSET_CATEGORIES } from "@/lib/marketer/brand-bible-asset-categories";
import type { BrandBible, BrandBibleAssetRef, BrandBibleAssetRole } from "@/lib/marketer/types";

type Props = {
  slug: string;
  bible: BrandBible;
  assets: MoodboardAsset[];
  onInspect: (asset: MoodboardAsset) => void;
  onAssetsUploaded: (uploaded: MoodboardAsset[], role: BrandBibleAssetRole) => void;
  onAssignFromMoodboard: (role: BrandBibleAssetRole) => void;
};

function refsForRoles(refs: BrandBibleAssetRef[], roles: BrandBibleAssetRole[]): BrandBibleAssetRef[] {
  return refs.filter((r) => roles.includes(r.role));
}

function assetById(assets: MoodboardAsset[], id: string): MoodboardAsset | undefined {
  return assets.find((a) => a.id === id);
}

function CategorySection({
  slug,
  sectionId,
  title,
  hint,
  emptyLabel,
  refs,
  assets,
  uploadLabelPrefix,
  defaultRole,
  onInspect,
  onUploaded,
  onAssignFromMoodboard,
}: {
  slug: string;
  sectionId: string;
  title: string;
  hint: string;
  emptyLabel: string;
  refs: BrandBibleAssetRef[];
  assets: MoodboardAsset[];
  uploadLabelPrefix: string;
  defaultRole: BrandBibleAssetRole;
  onInspect: (asset: MoodboardAsset) => void;
  onUploaded: (uploaded: MoodboardAsset[], role: BrandBibleAssetRole) => void;
  onAssignFromMoodboard: (role: BrandBibleAssetRole) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(f.name));
    if (files.length === 0) {
      setUploadError("Choose PNG, JPG, WebP, or SVG images.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const kind = defaultRole === "logo" ? "logo" : "reference_image";
      const uploaded = await uploadBrandReferenceImages(slug, files, { labelPrefix: uploadLabelPrefix, kind });
      onUploaded(uploaded, defaultRole);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section id={sectionId} className="profile-section brand-bible-category-section">
      <div className="brand-bible-category-section__head">
        <div>
          <h3 className="profile-section-title">{title}</h3>
          <p className="profile-field-hint">{hint}</p>
        </div>
        <div className="brand-bible-category-section__actions">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onAssignFromMoodboard(defaultRole)}>
            From moodboard
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "+ Upload"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
            multiple
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>
      </div>

      {uploadError ? <p className="workspace-error">{uploadError}</p> : null}

      {refs.length === 0 ? (
        <p className="brand-bible-moodboard-empty">{emptyLabel}</p>
      ) : (
        <ul className="brand-bible-creative-asset-list">
          {refs.map((ref) => {
            const asset = assetById(assets, ref.assetId);
            if (!asset) return null;
            return (
              <li key={`${ref.assetId}-${ref.role}`}>
                <button type="button" className="brand-bible-creative-asset-tile" onClick={() => onInspect(asset)}>
                  <span className="brand-bible-creative-asset-tile__media">
                    <BrandAssetImage slug={slug} asset={asset} className="brand-bible-moodboard-img" />
                  </span>
                  <span className="brand-bible-creative-asset-tile__label">{ref.label || asset.label || "Untitled"}</span>
                  {ref.usageNotes ? (
                    <span className="brand-bible-creative-asset-tile__notes">{ref.usageNotes}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function BrandBibleAssetCategories({
  slug,
  bible,
  assets,
  onInspect,
  onAssetsUploaded,
  onAssignFromMoodboard,
}: Props) {
  const counts = BRAND_BIBLE_ASSET_CATEGORIES.map((cat) => ({
    id: cat.id,
    count: refsForRoles(bible.assetRefs, cat.roles).length,
  }));

  function scrollToCategory(id: string) {
    document.getElementById(`bvs-cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="brand-bible-categories">
      <p className="profile-field-hint brand-bible-categories-lead">
        Organize uploads by how CAF should use them. Each category auto-tags assets for your brand bible — save after
        uploading.
      </p>

      <nav className="brand-bible-category-nav" aria-label="Asset categories">
        {BRAND_BIBLE_ASSET_CATEGORIES.map((cat) => {
          const count = counts.find((c) => c.id === cat.id)?.count ?? 0;
          return (
            <button key={cat.id} type="button" className="brand-bible-category-nav__pill" onClick={() => scrollToCategory(cat.id)}>
              {cat.shortLabel}
              <span className="brand-bible-category-nav__count">{count}</span>
            </button>
          );
        })}
      </nav>

      <div className="brand-bible-categories-list">
        {BRAND_BIBLE_ASSET_CATEGORIES.map((cat) => (
          <CategorySection
            key={cat.id}
            slug={slug}
            sectionId={`bvs-cat-${cat.id}`}
            title={cat.title}
            hint={cat.hint}
            emptyLabel={cat.emptyLabel}
            refs={refsForRoles(bible.assetRefs, cat.roles)}
            assets={assets}
            uploadLabelPrefix={cat.uploadLabelPrefix}
            defaultRole={cat.defaultRole}
            onInspect={onInspect}
            onUploaded={onAssetsUploaded}
            onAssignFromMoodboard={onAssignFromMoodboard}
          />
        ))}
      </div>
    </div>
  );
}
