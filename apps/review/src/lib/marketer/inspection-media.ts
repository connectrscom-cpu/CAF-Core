export type InspectionMediaItem = {
  role?: string;
  public_url?: string | null;
  vision_fetch_url?: string | null;
};

export type InspectionMedia = {
  items?: InspectionMediaItem[];
};

const THUMBNAIL_ROLES = ["carousel_slide", "video_frame", "evidence_media", "thumbnail", "cover_image"];

/** Post/page permalinks must never be used as `<img src>`. */
export function isLikelySocialPostPageUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http")) return false;
  if (/instagram\.com\/(p|reel|reels|tv|stories)\//i.test(u)) return true;
  if (/tiktok\.com\/@[^/]+\/video\//i.test(u)) return true;
  if (/facebook\.com\/[^/]+\/(posts|videos|photos)\//i.test(u)) return true;
  return false;
}

function scoreBrowserImageUrl(url: string, role = ""): number {
  if (!url.startsWith("http") || isLikelySocialPostPageUrl(url)) return -1;
  let score = 0;
  if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(url)) score += 20;
  if (/\/object\/sign\//i.test(url)) score += 35;
  else if (/supabase\.co\/storage\//i.test(url)) score += 12;
  if (THUMBNAIL_ROLES.includes(role)) score += 8;
  if (/cdninstagram|fbcdn|tiktokcdn/i.test(url)) score += 10;
  if (/\/object\/public\//i.test(url)) score -= 8;
  return score > 0 ? score : 1;
}

/** Best scored HTTP URL safe for `<img src>` (skips post permalinks). */
export function pickRenderableThumb(...urls: (string | null | undefined)[]): string | null {
  let best: { url: string; score: number } | null = null;
  const seen = new Set<string>();
  for (const u of urls) {
    const t = (u ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const score = scoreBrowserImageUrl(t);
    if (score < 0) continue;
    if (!best || score > best.score) best = { url: t, score };
  }
  return best?.url ?? null;
}

export function pickInspectionMediaPreviewUrl(media: InspectionMedia | null | undefined): string | null {
  if (!media?.items?.length) return null;

  const ranked = [
    ...media.items.filter((it) => THUMBNAIL_ROLES.includes(String(it.role ?? ""))),
    ...media.items,
  ];

  let best: { url: string; score: number } | null = null;
  const seen = new Set<string>();

  for (const it of ranked) {
    const role = String(it.role ?? "");
    for (const candidate of [it.vision_fetch_url, it.public_url]) {
      const u = (candidate ?? "").trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const score = scoreBrowserImageUrl(u, role);
      if (score < 0) continue;
      if (!best || score > best.score) best = { url: u, score };
    }
  }

  return best?.url ?? null;
}
