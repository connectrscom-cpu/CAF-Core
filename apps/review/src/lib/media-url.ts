export type MediaKind = "image" | "video" | "unknown";

export function isImageUrl(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|avif)(\?|#|$)/i.test(url);
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
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
  if (at.includes("video") || at.includes("mp4") || at.includes("webm") || at.includes("mux")) return "video";
  if (at.includes("image") || at.includes("carousel") || at.includes("png") || at.includes("jpeg") || at.includes("render")) {
    return "image";
  }
  return "unknown";
}

export interface TaskAssetPreview {
  position: number;
  public_url: string;
  kind: MediaKind;
}

export function taskAssetsToPreviewRows(
  assets: Array<{ position: number; public_url: string | null; asset_type?: string | null }>
): TaskAssetPreview[] {
  return [...assets]
    .filter((a) => (a.public_url ?? "").trim())
    .sort((a, b) => a.position - b.position)
    .map((a) => {
      const public_url = (a.public_url ?? "").trim();
      let kind = mediaKindFromAsset(public_url, a.asset_type ?? null);
      if (kind === "unknown") kind = "image";
      return { position: a.position, public_url, kind };
    });
}
