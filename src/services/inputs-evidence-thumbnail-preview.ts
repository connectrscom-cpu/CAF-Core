/**
 * Resolve a browser-renderable preview URL for evidence rows (not post permalinks).
 */
import { parseHttpsImageUrlsFromEvidenceCell } from "./inputs-image-url-for-analysis.js";

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

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
  if (/supabase\.co\/storage\//i.test(url)) score += 15;
  if (role === "carousel_slide" || role === "video_frame" || role === "thumbnail") score += 8;
  if (role === "evidence_media" || role === "cover_image") score += 6;
  if (/cdninstagram|fbcdn|tiktokcdn/i.test(url)) score += 10;
  return score > 0 ? score : 1;
}

export function pickBrowserPreviewFromInspectionMedia(stored: unknown): string | null {
  const rec = asRecord(stored);
  if (!rec) return null;
  let best: { url: string; score: number } | null = null;
  for (const raw of asArray(rec.items)) {
    const item = asRecord(raw);
    if (!item) continue;
    const role = str(item.role);
    for (const candidate of [str(item.public_url), str(item.vision_fetch_url), str(item.source_url)]) {
      const score = scoreBrowserImageUrl(candidate, role);
      if (score < 0) continue;
      if (!best || score > best.score) best = { url: candidate, score };
    }
  }
  return best?.url ?? null;
}

export function evidenceThumbnailFromPayload(payload: Record<string, unknown>): string | null {
  for (const k of ["thumbnail_url", "display_url", "cover_url", "poster_url", "preview_image_url", "og_image"]) {
    const urls = parseHttpsImageUrlsFromEvidenceCell(str(payload[k]), 1);
    const url = urls[0];
    if (url && !isLikelySocialPostPageUrl(url)) return url;
  }

  const carouselPipe = parseHttpsImageUrlsFromEvidenceCell(str(payload.carousel_slide_urls), 4);
  if (carouselPipe[0]) return carouselPipe[0];

  for (const key of ["carousel_slide_urls_json", "images", "image_urls", "media_urls_json"] as const) {
    const raw = payload[key];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const urls = parseHttpsImageUrlsFromEvidenceCell(str(entry), 1);
      if (urls[0]) return urls[0];
    }
  }

  return null;
}

export function evidenceThumbnailForInsightRow(input: {
  stored_inspection_media_json?: unknown;
  evidence_payload_json?: unknown;
}): string | null {
  const fromStored = pickBrowserPreviewFromInspectionMedia(input.stored_inspection_media_json);
  if (fromStored) return fromStored;
  const payload = asRecord(input.evidence_payload_json);
  if (payload) return evidenceThumbnailFromPayload(payload);
  return null;
}
