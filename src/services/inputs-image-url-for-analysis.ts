/**
 * Pick a single HTTPS image URL for top-performer **image** analysis (no video).
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

function isHttpsUrl(s: string): boolean {
  return /^https:\/\//i.test(s.trim());
}

function firstImageUrlFromString(s: string): string | null {
  const m = s.match(/https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s"'<>]*)?/i);
  if (m && isHttpsUrl(m[0])) return m[0].replace(/^http:/i, "https:");
  return null;
}

export function pickPrimaryImageUrlForDeepAnalysis(
  evidenceKind: string,
  payload: Record<string, unknown>
): string | null {
  if (evidenceKind === "tiktok_video") {
    return null;
  }

  const str = (v: unknown) => (v != null ? String(v).trim() : "");

  switch (evidenceKind) {
    case "reddit_post": {
      const u = str(payload.media_url);
      if (u && IMAGE_EXT.test(u) && isHttpsUrl(u)) return u;
      const url = str(payload.url);
      if (url && IMAGE_EXT.test(url) && isHttpsUrl(url)) return url;
      return null;
    }
    case "instagram_post": {
      const mt = str(payload.media_type).toLowerCase();
      if (/\bvideo\b|\breel\b/i.test(mt)) {
        return null;
      }
      for (const k of ["display_url", "thumbnail_url", "media_url", "image_url", "Image URL"]) {
        const u = str(payload[k]);
        if (u && isHttpsUrl(u) && (IMAGE_EXT.test(u) || u.includes("cdninstagram"))) return u;
      }
      const pu = str(payload.post_url);
      if (pu && isHttpsUrl(pu) && /instagram\.com\/p\//i.test(pu)) {
        return null;
      }
      return null;
    }
    case "facebook_post": {
      const isVid = String(payload.isVideo ?? payload.is_video ?? "").toLowerCase() === "true";
      if (isVid) return null;
      const u = str(payload.url);
      if (/facebook\.com\/reel\//i.test(u) || /\/reel\//i.test(u)) return null;
      if (u && isHttpsUrl(u) && IMAGE_EXT.test(u)) return u;
      return null;
    }
    case "scraped_page": {
      const og = str(payload.og_image ?? payload.image_url);
      if (og && isHttpsUrl(og) && IMAGE_EXT.test(og)) return og;
      const main = str(payload.main_text);
      return firstImageUrlFromString(main);
    }
    default:
      return null;
  }
}

export function isVideoLikeEvidence(evidenceKind: string, payload: Record<string, unknown>): boolean {
  if (evidenceKind === "tiktok_video") return true;
  if (evidenceKind === "instagram_post") {
    const mt = String(payload.media_type ?? "").toLowerCase();
    return /\bvideo\b|\breel\b/i.test(mt);
  }
  if (evidenceKind === "facebook_post") {
    if (String(payload.isVideo ?? "").toLowerCase() === "true") return true;
    const u = String(payload.url ?? "");
    return /\/reel\//i.test(u);
  }
  return false;
}
