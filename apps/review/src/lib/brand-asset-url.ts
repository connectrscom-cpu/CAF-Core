type BrandAssetRow = {
  id?: string;
  kind?: string;
  public_url?: string | null;
  storage_path?: string | null;
};

/** Review UI + reprint: prefer same-origin proxy so private buckets / hotlink blocks do not break <img>. */
export function brandAssetProxyUrl(projectSlug: string, asset: BrandAssetRow): string {
  const slug = projectSlug.trim();
  const id = typeof asset.id === "string" ? asset.id.trim() : "";
  if (!slug || !id) return "";
  return `/api/project-config/brand-assets/proxy?project=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`;
}

/** Moodboard / previews: prefer stored public URL (Supabase), fall back to same-origin proxy. */
export function resolveBrandAssetImageUrl(projectSlug: string, asset: BrandAssetRow): string {
  const pub = typeof asset.public_url === "string" ? asset.public_url.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  return brandAssetProxyUrl(projectSlug, asset);
}

export function resolveBrandLogoDisplayUrl(
  projectSlug: string,
  assets: BrandAssetRow[]
): string {
  const logo = assets.find((a) => a.kind === "logo");
  if (!logo) return "";
  return resolveBrandAssetImageUrl(projectSlug, logo);
}

/** Reprint/renderer needs a fetchable absolute URL — use stored public_url when valid. */
export function resolveBrandLogoReprintUrl(assets: BrandAssetRow[]): string {
  const logo = assets.find((a) => a.kind === "logo");
  if (!logo) return "";
  const pub = typeof logo.public_url === "string" ? logo.public_url.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  return "";
}
