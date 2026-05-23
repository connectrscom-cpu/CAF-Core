export type MediaKind = "image" | "video" | "unknown";

export function isImageUrl(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|avif)(\?|#|$)/i.test(url);
}

export function isVideoUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  return /\.(mp4|webm|mov|m4v|m3u8|mpd)(\?|#|$)/i.test(u);
}

function normType(t: string | null | undefined): string {
  return (t ?? "").toLowerCase();
}

/** Classify an asset for preview: URL extension first, then `asset_type`. */
export function mediaKindFromAsset(url: string, assetType: string | null | undefined): MediaKind {
  const u = url.trim();
  if (!u) return "unknown";
  if (isVideoUrl(u)) return "video";
  if (isImageUrl(u)) return "image";
  const at = normType(assetType);
  if (
    at.includes("video") ||
    at.includes("mp4") ||
    at.includes("webm") ||
    at.includes("mux") ||
    at.includes("heygen") ||
    at.includes("avatar")
  ) {
    return "video";
  }
  if (at.includes("image") || at.includes("carousel") || at.includes("png") || at.includes("jpeg") || at.includes("render")) {
    return "image";
  }
  return "unknown";
}

export interface TaskAssetPreview {
  position: number;
  public_url: string;
  kind: MediaKind;
  asset_type?: string | null;
}

function normAssetType(t: string | null | undefined): string {
  return (t ?? "").trim().toLowerCase();
}

/** Lower = preferred for human-facing carousel preview (final render beats intermediate plates). */
function carouselPreviewAssetPriority(assetType: string | null | undefined): number {
  const at = normAssetType(assetType);
  if (at === "carousel_slide") return 0;
  if (at.includes("carousel") && !at.includes("background")) return 1;
  if (at.includes("image") || at.includes("render")) return 2;
  if (at === "mimic_background") return 4;
  return 3;
}

/**
 * Mimic carousel jobs store both Qwen background plates (`MIMIC_BACKGROUND`) and composited
 * renderer output (`CAROUSEL_SLIDE`) at the same `position`. Review/publish must show the latter.
 */
export function selectCarouselPreviewAssets<
  T extends { position: number; public_url: string | null; asset_type?: string | null },
>(assets: T[]): T[] {
  const withUrl = assets.filter((a) => (a.public_url ?? "").trim());
  const hasFinalSlides = withUrl.some((a) => normAssetType(a.asset_type) === "carousel_slide");
  const candidates = hasFinalSlides
    ? withUrl.filter((a) => normAssetType(a.asset_type) !== "mimic_background")
    : withUrl;

  const byPosition = new Map<number, T>();
  for (const row of candidates) {
    const prev = byPosition.get(row.position);
    if (!prev || carouselPreviewAssetPriority(row.asset_type) < carouselPreviewAssetPriority(prev.asset_type)) {
      byPosition.set(row.position, row);
    }
  }
  return [...byPosition.values()].sort((a, b) => a.position - b.position);
}

export function taskAssetsToPreviewRows(
  assets: Array<{ position: number; public_url: string | null; asset_type?: string | null }>,
  opts?: { flowTypeHint?: string }
): TaskAssetPreview[] {
  const rows = selectCarouselPreviewAssets(assets);
  const single = rows.length === 1;
  const flowLooksVideo = /video|heygen|reel|avatar|tiktok|shorts|mux|scene/i.test(opts?.flowTypeHint ?? "");
  return rows.map((a) => {
    const public_url = (a.public_url ?? "").trim();
    let kind = mediaKindFromAsset(public_url, a.asset_type ?? null);
    if (kind === "unknown") kind = single && flowLooksVideo ? "video" : "image";
    return { position: a.position, public_url, kind, asset_type: a.asset_type ?? null };
  });
}
