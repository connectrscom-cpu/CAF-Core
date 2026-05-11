/**
 * Pick a single HTTPS image URL for top-performer **image** analysis (no video).
 *
 * Scrapers sometimes concatenate two URLs with `][` (or similar). OpenAI rejects that as
 * `invalid_image_url`. We extract **one segment per URL** by disallowing `[`/`]` inside the path.
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

/** One https(s) image URL segment; excludes `[` `]` so `...png][https://...` splits cleanly. */
const HTTPS_IMAGE_URL_SEGMENT = new RegExp(
  String.raw`https?:\/\/[^\s"'<>[\]]+\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s"'<>[\]]*)?`,
  "gi"
);

function isHttpsUrl(s: string): boolean {
  return /^https:\/\//i.test(s.trim());
}

/**
 * Extract distinct HTTPS image URLs from a loose string (double-pasted URLs, markdown noise, etc.).
 */
export function extractHttpsImageUrlsFromLooseString(raw: string, max = 24): string[] {
  const t = raw.trim();
  if (!t) return [];
  const out: string[] = [];
  const re = new RegExp(HTTPS_IMAGE_URL_SEGMENT.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) != null && out.length < max) {
    const u = m[0].replace(/^http:/i, "https:");
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** First valid HTTPS image URL in `raw`, or null. */
export function sanitizeOneHttpsImageUrl(raw: string): string | null {
  return extractHttpsImageUrlsFromLooseString(raw, 1)[0] ?? null;
}

/** True when `raw` looks like two+ URLs pasted together (e.g. `...png][https://...`). */
function looksLikeMultipleImageUrlsPasted(raw: string): boolean {
  return /\]\s*\[?\s*https?:\/\//i.test(raw);
}

/**
 * HTTPS image URLs from one evidence field cell. Matches prior behavior for arrays: plain
 * `http://…` cells are skipped; concatenated / pasted multi-URLs are split and normalized to HTTPS.
 */
export function parseHttpsImageUrlsFromEvidenceCell(raw: string, max: number): string[] {
  const t = raw.trim();
  if (!t || max <= 0) return [];
  if (looksLikeMultipleImageUrlsPasted(t)) {
    return extractHttpsImageUrlsFromLooseString(t, max);
  }
  if (/^https:\/\//i.test(t)) {
    const one = sanitizeOneHttpsImageUrl(t);
    return one ? [one] : [];
  }
  return [];
}

function firstImageUrlFromString(s: string): string | null {
  return sanitizeOneHttpsImageUrl(s);
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
      const u = sanitizeOneHttpsImageUrl(str(payload.media_url)) ?? "";
      if (u && IMAGE_EXT.test(u) && isHttpsUrl(u)) return u;
      const url = sanitizeOneHttpsImageUrl(str(payload.url)) ?? "";
      if (url && IMAGE_EXT.test(url) && isHttpsUrl(url)) return url;
      return null;
    }
    case "instagram_post": {
      const mt = str(payload.media_type).toLowerCase();
      if (/\bvideo\b|\breel\b/i.test(mt)) {
        return null;
      }
      for (const k of ["display_url", "thumbnail_url", "media_url", "image_url", "Image URL"]) {
        const raw = str(payload[k]);
        const u = raw ? sanitizeOneHttpsImageUrl(raw) ?? "" : "";
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
      const u = sanitizeOneHttpsImageUrl(str(payload.url)) ?? "";
      if (/facebook\.com\/reel\//i.test(u) || /\/reel\//i.test(u)) return null;
      if (u && isHttpsUrl(u) && IMAGE_EXT.test(u)) return u;
      return null;
    }
    case "scraped_page": {
      const ogRaw = str(payload.og_image ?? payload.image_url);
      const og = ogRaw ? sanitizeOneHttpsImageUrl(ogRaw) ?? "" : "";
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
