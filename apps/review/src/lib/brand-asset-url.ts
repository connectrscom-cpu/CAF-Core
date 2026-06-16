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

export function resolveBrandLogoDisplayUrl(
  projectSlug: string,
  assets: BrandAssetRow[]
): string {
  const logo = assets.find((a) => a.kind === "logo");
  if (!logo) return "";
  if (logo.id) return brandAssetProxyUrl(projectSlug, logo);
  const pub = typeof logo.public_url === "string" ? logo.public_url.trim() : "";
  return pub;
}

/** Reprint/renderer needs a fetchable absolute URL — use stored public_url when valid. */
export function resolveBrandLogoReprintUrl(assets: BrandAssetRow[]): string {
  const logo = assets.find((a) => a.kind === "logo");
  if (!logo) return "";
  const pub = typeof logo.public_url === "string" ? logo.public_url.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  return "";
}
