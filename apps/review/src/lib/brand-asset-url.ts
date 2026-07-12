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

/** Absolute URL the carousel renderer (Puppeteer) can fetch — Core brand-asset file route. */
export function brandAssetCoreFileUrl(
  projectSlug: string,
  assetId: string,
  coreBaseUrl?: string
): string {
  const slug = projectSlug.trim();
  const id = assetId.trim();
  if (!slug || !id) return "";
  const base = (coreBaseUrl ?? "https://caf-core.fly.dev").replace(/\/$/, "");
  return `${base}/v1/projects/${encodeURIComponent(slug)}/brand-assets/${encodeURIComponent(id)}/file`;
}

export function assetIdFromBrandProxyUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const parsed = raw.startsWith("/")
      ? new URL(raw, "https://caf-core.local")
      : new URL(raw);
    if (!parsed.pathname.includes("brand-assets/proxy")) return "";
    return parsed.searchParams.get("id")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Reprint/renderer needs a fetchable absolute URL — public URL, signed URL, or Core file route. */
export function resolveBrandLogoReprintUrl(
  projectSlug: string,
  assets: BrandAssetRow[],
  coreBaseUrl?: string
): string {
  const logo = assets.find((a) => a.kind === "logo");
  if (!logo) return "";
  return resolveBrandAssetReprintUrl(projectSlug, logo, coreBaseUrl);
}

export function resolveBrandAssetReprintUrl(
  projectSlug: string,
  asset: BrandAssetRow,
  coreBaseUrl?: string
): string {
  const id = typeof asset.id === "string" ? asset.id.trim() : "";
  if (id && projectSlug.trim()) {
    const core = brandAssetCoreFileUrl(projectSlug, id, coreBaseUrl);
    if (core) return core;
  }
  const pub = typeof asset.public_url === "string" ? asset.public_url.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  return "";
}

export type BrandSlideFrameOption = {
  assetId: string;
  label: string;
  displayUrl: string;
  reprintUrl: string;
};

/** Brand bible slide_frame assets for the layout editor frame picker. */
export function resolveBrandSlideFrames(
  projectSlug: string,
  resolvedAssets: Array<{
    asset_id?: string;
    role?: string;
    label?: string | null;
    public_url?: string | null;
  }>
): BrandSlideFrameOption[] {
  const slug = projectSlug.trim();
  const out: BrandSlideFrameOption[] = [];
  for (const row of resolvedAssets) {
    if (row.role !== "slide_frame") continue;
    const assetId = typeof row.asset_id === "string" ? row.asset_id.trim() : "";
    if (!assetId) continue;
    const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : "Slide frame";
    const pub = typeof row.public_url === "string" ? row.public_url.trim() : "";
    const displayUrl =
      pub && /^https?:\/\//i.test(pub) ? pub : brandAssetProxyUrl(slug, { id: assetId });
    if (!displayUrl) continue;
    const reprintUrl = brandAssetCoreFileUrl(slug, assetId) || displayUrl;
    out.push({
      assetId,
      label,
      displayUrl,
      reprintUrl,
    });
  }
  return out;
}

export function resolveBrandFrameReprintUrl(
  projectSlug: string,
  assets: BrandAssetRow[],
  assetId: string,
  coreBaseUrl?: string
): string {
  const id = assetId.trim();
  if (!id) return "";
  const hit = assets.find((a) => a.id === id);
  if (hit) return resolveBrandAssetReprintUrl(projectSlug, hit, coreBaseUrl);
  if (projectSlug.trim()) return brandAssetCoreFileUrl(projectSlug, id, coreBaseUrl);
  return "";
}
