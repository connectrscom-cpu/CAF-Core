export type InspectionMediaItem = {
  role?: string;
  public_url?: string | null;
  vision_fetch_url?: string | null;
};

export type InspectionMedia = {
  items?: InspectionMediaItem[];
};

const THUMBNAIL_ROLES = ["carousel_slide", "video_frame", "evidence_media"];

export function pickInspectionMediaPreviewUrl(media: InspectionMedia | null | undefined): string | null {
  if (!media?.items?.length) return null;
  const ranked = [
    ...media.items.filter((it) => THUMBNAIL_ROLES.includes(String(it.role ?? ""))),
    ...media.items,
  ];
  const seen = new Set<string>();
  for (const it of ranked) {
    const u = (it.vision_fetch_url ?? it.public_url ?? "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    return u;
  }
  return null;
}
