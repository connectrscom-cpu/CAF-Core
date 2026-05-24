/**
 * Carousel deep analysis: **multiple slide image URLs** from `payload_json` (no raw bundle upload).
 * Typical keys: `carousel_slide_urls`, `sidecar_image_urls`, `carousel_media_urls`, plus a bounded
 * deep walk for Instagram Graph shapes (`edge_sidecar_to_children`, `display_resources`, stringified JSON cells).
 */

import {
  finalizeHttpsImageUrlForOpenAiVision,
  parseHttpsImageUrlsFromEvidenceCell,
  tryLenientSingleHttpsImageUrlFromSocialCdn,
} from "./inputs-image-url-for-analysis.js";
import { extractOrderedInstagramCarouselImageUrls } from "./instagram-media-normalizer.js";

/** One level: scrapers often emit `[{ display_url, ... }, ...]` instead of string URLs. */
function imageUrlsFromScraperMediaObject(o: Record<string, unknown>, max: number): string[] {
  if (max <= 0) return [];
  const keys = [
    "display_url",
    "thumbnail_url",
    "url",
    "media_url",
    "image_url",
    "Image URL",
    "thumbnail_src",
  ] as const;
  const out: string[] = [];
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    for (const u of parseHttpsImageUrlsFromEvidenceCell(String(v), max - out.length)) {
      if (!out.includes(u)) out.push(u);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function parseUrlArray(raw: unknown, maxSlides: number): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const x of raw) {
      if (x != null && typeof x === "object" && !Array.isArray(x)) {
        for (const u of imageUrlsFromScraperMediaObject(x as Record<string, unknown>, maxSlides - out.length)) {
          if (!out.includes(u)) out.push(u);
          if (out.length >= maxSlides) return out;
        }
        continue;
      }
      for (const u of parseHttpsImageUrlsFromEvidenceCell(String(x), maxSlides - out.length)) {
        if (!out.includes(u)) out.push(u);
        if (out.length >= maxSlides) return out;
      }
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const a = JSON.parse(raw) as unknown;
      return parseUrlArray(a, maxSlides);
    } catch {
      return [];
    }
  }
  if (typeof raw === "string" && raw.trim()) {
    return parseHttpsImageUrlsFromEvidenceCell(raw.trim(), maxSlides);
  }
  return [];
}

function isLikelyInstagramCarouselCdnUrl(u: string): boolean {
  const x = finalizeHttpsImageUrlForOpenAiVision(u);
  if (!/^https:\/\//i.test(x)) return false;
  if (/instagram\.com\/(p|reel|tv)\//i.test(x)) return false;
  try {
    const host = new URL(x).hostname.toLowerCase();
    return (
      host.includes("cdninstagram") ||
      host.endsWith(".cdninstagram.com") ||
      host.includes("fbcdn.net") ||
      host.includes("scontent")
    );
  } catch {
    return false;
  }
}

/** Normalize one cell / field to a single slide CDN URL, or null. */
function normalizeCarouselSlideCandidateUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const strict = parseHttpsImageUrlsFromEvidenceCell(t, 2)[0] ?? null;
  const picked = strict ?? tryLenientSingleHttpsImageUrlFromSocialCdn(t);
  if (!picked || !isLikelyInstagramCarouselCdnUrl(picked)) return null;
  return finalizeHttpsImageUrlForOpenAiVision(picked);
}

/** Pick largest `display_resources[].src` when Instagram ships multiple widths. */
function pickBestDisplayResourceSrc(resources: unknown): string | null {
  if (!Array.isArray(resources) || resources.length === 0) return null;
  let best = "";
  let bestW = -1;
  for (const r of resources) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const src = typeof o.src === "string" ? o.src.trim() : "";
    if (!src) continue;
    const w = parseInt(String(o.config_width ?? o.width ?? 0), 10);
    const score = Number.isFinite(w) && w > 0 ? w : 0;
    if (score >= bestW) {
      bestW = score;
      best = src;
    }
  }
  return best || null;
}

/**
 * Walk nested JSON (Graph `edge_sidecar_to_children`, stringified `graphql` blobs, `display_resources`, …)
 * and collect distinct Instagram CDN image URLs. Bounded work per row.
 */
export function harvestNestedInstagramCarouselImageUrls(
  root: Record<string, unknown>,
  maxSlides: number,
  opts?: { maxNodes?: number; maxDepth?: number }
): string[] {
  if (maxSlides <= 0) return [];
  const maxNodes = Math.min(Math.max(opts?.maxNodes ?? 1400, 50), 8000);
  const maxDepth = Math.min(Math.max(opts?.maxDepth ?? 14, 4), 24);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const u = normalizeCarouselSlideCandidateUrl(raw);
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };

  let nodesVisited = 0;
  const stack: Array<{ v: unknown; depth: number }> = [{ v: root, depth: 0 }];

  while (stack.length > 0 && out.length < maxSlides && nodesVisited < maxNodes) {
    const { v, depth } = stack.pop()!;
    nodesVisited++;
    if (depth > maxDepth) continue;
    if (v == null) continue;

    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 180 && (t.startsWith("{") || t.startsWith("["))) {
        try {
          stack.push({ v: JSON.parse(t) as unknown, depth: depth + 1 });
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    if (typeof v !== "object") continue;

    if (Array.isArray(v)) {
      const first = v[0];
      if (
        first &&
        typeof first === "object" &&
        "src" in (first as object) &&
        !("node" in (first as object))
      ) {
        const best = pickBestDisplayResourceSrc(v);
        if (best) push(best);
      }
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], depth: depth + 1 });
      continue;
    }

    const obj = v as Record<string, unknown>;

    const typename = String(obj.__typename ?? "");
    const isVideoNode =
      obj.is_video === true ||
      obj.isVideo === true ||
      /\bvideo\b/i.test(String(obj.media_type ?? "")) ||
      typename.toUpperCase().includes("VIDEO");
    if (!isVideoNode) {
      for (const k of ["display_url", "thumbnail_src", "thumbnail_url", "display_src"] as const) {
        const val = obj[k];
        if (typeof val === "string") push(val);
      }
      const du = obj.url;
      if (typeof du === "string" && /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(du)) push(du);
      if (Array.isArray(obj.display_resources)) {
        const best = pickBestDisplayResourceSrc(obj.display_resources);
        if (best) push(best);
      }
    } else {
      for (const k of ["display_url", "thumbnail_src", "thumbnail_url"] as const) {
        const val = obj[k];
        if (typeof val === "string") push(val);
      }
      if (Array.isArray(obj.display_resources)) {
        const best = pickBestDisplayResourceSrc(obj.display_resources);
        if (best) push(best);
      }
    }

    for (const [, child] of Object.entries(obj)) {
      if (child != null && typeof child === "object") {
        stack.push({ v: child, depth: depth + 1 });
      } else if (typeof child === "string") {
        const t = child.trim();
        if (t.length > 180 && (t.startsWith("{") || t.startsWith("["))) {
          try {
            stack.push({ v: JSON.parse(t) as unknown, depth: depth + 1 });
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  return out.slice(0, maxSlides);
}

/** Payload keys that often hold an Instagram permalink (may include `?img_index=N`). */
const INSTAGRAM_POST_URL_PAYLOAD_KEYS = [
  "post_url",
  "url",
  "postUrl",
  "Post URL",
  "permalink",
  "link",
  "instagram_url",
  "Instagram URL",
  "shortcode_url",
  "post_link",
] as const;

/** First Instagram `/p/`, `/reel/`, or `/tv/` permalink string found on common payload keys. */
export function instagramPostPermalinkFromPayload(payload: Record<string, unknown>): string {
  for (const k of INSTAGRAM_POST_URL_PAYLOAD_KEYS) {
    const v = payload[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s && /instagram\.com\/(?:p|reel|tv)\//i.test(s)) return s;
  }
  return "";
}

/**
 * Max `img_index` seen on any `instagram.com` URL in the payload (e.g. web UI
 * `https://www.instagram.com/p/SHORTCODE/?img_index=8`). **Does not** supply slide image URLs —
 * use this only for format hints and ingest diagnostics when child CDN URLs are missing.
 */
export function maxInstagramCarouselImgIndexFromPayload(payload: Record<string, unknown>): number {
  let max = 0;
  const visit = (raw: string) => {
    const s = raw.trim();
    if (!s || !/instagram\.com/i.test(s)) return;
    const re = /[?&]img_index=(\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) != null) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > 0) max = Math.max(max, n);
    }
  };
  for (const k of INSTAGRAM_POST_URL_PAYLOAD_KEYS) {
    const v = payload[k];
    if (v == null) continue;
    visit(String(v));
  }
  return max;
}

/**
 * Instagram signals a **multi-slide** post without requiring parsed child image URLs:
 * - permalink query `img_index≥2`, or
 * - `media_type` **Sidecar** / Carousel (Graph API — carousel album; often shipped without `display_url` / child URLs in thin exports).
 */
export function instagramCarouselStructuralHintPresent(payload: Record<string, unknown>): boolean {
  if (maxInstagramCarouselImgIndexFromPayload(payload) >= 2) return true;
  const mt = String(payload.media_type ?? "").trim();
  if (!mt) return false;
  const mtl = mt.toLowerCase();
  if (/\bsidecar\b/.test(mtl)) return true;
  if (mtl === "carousel" || mtl.includes("graphsidecar") || mtl.includes("edge_sidecar")) return true;
  return false;
}

const CAROUSEL_URL_KEYS = [
  "carousel_slide_urls",
  "carousel_media_urls",
  "sidecar_image_urls",
  "sidecar_urls",
  "child_image_urls",
  "carousel_image_urls",
  // Common SNS workbook / scraper exports (arrays of URLs or of `{ display_url }` rows)
  "images",
  "Images",
  "childPosts",
  "children",
  "carousel_children",
  "slide_urls",
  "media_urls",
  "image_urls",
  "all_image_urls",
  "carousel_urls",
  "Instagram carousel URLs",
  "Carousel slide URLs",
] as const;

const TOP_LEVEL_COVER_IMAGE_KEYS = [
  "display_url",
  "thumbnail_url",
  "thumbnail_src",
  "media_url",
  "image_url",
  "Image URL",
] as const;

/**
 * Ordered HTTPS image URLs for one carousel / sidecar post.
 * Merges **all** known list keys (not only the first non-empty) so a cover `display_url` plus
 * `carousel_slide_urls` dedupe correctly; also appends top-level cover fields when child lists are thin.
 */
export function parseCarouselSlideUrls(payload: Record<string, unknown>, maxSlides = 12): string[] {
  if (maxSlides <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const pushAll = (arr: string[]) => {
    for (const u of arr) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= maxSlides) return;
    }
  };
  /** Apify / ingest-first ordered slide URLs (childPosts, carousel_slide_urls_json, …) before legacy list keys + embed fallback. */
  pushAll(extractOrderedInstagramCarouselImageUrls(payload, maxSlides));
  for (const k of CAROUSEL_URL_KEYS) {
    const arr = parseUrlArray(payload[k], maxSlides - out.length);
    pushAll(arr);
    if (out.length >= maxSlides) return out;
  }
  for (const k of TOP_LEVEL_COVER_IMAGE_KEYS) {
    const v = payload[k];
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      pushAll(imageUrlsFromScraperMediaObject(v as Record<string, unknown>, maxSlides - out.length));
    } else {
      pushAll(parseUrlArray(v, maxSlides - out.length));
    }
    if (out.length >= maxSlides) return out;
  }
  // Graph / scraper dumps: `graphql.shortcode_media.edge_sidecar_to_children`, stringified JSON cells, etc.
  pushAll(harvestNestedInstagramCarouselImageUrls(payload, maxSlides - out.length));
  return out;
}

/** Minimum slides to treat as carousel deck (not single-image deep). */
export const MIN_CAROUSEL_SLIDES_FOR_DEEP = 2;

export function isCarouselDeepEligible(payload: Record<string, unknown>, maxSlides = 12): boolean {
  return parseCarouselSlideUrls(payload, maxSlides).length >= MIN_CAROUSEL_SLIDES_FOR_DEEP;
}

/**
 * Instagram CDN URLs often carry an `oe` hex Unix expiry; after that (or ~7d from scrape) downloads return 403.
 */
export function isLikelyStaleInstagramCdnUrl(url: string, nowMs = Date.now()): boolean {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (!host.includes("cdninstagram") && !host.includes("fbcdn")) return false;
    const oe = u.searchParams.get("oe");
    if (!oe || !/^[0-9a-f]+$/i.test(oe)) return false;
    const expSec = parseInt(oe, 16);
    if (!Number.isFinite(expSec) || expSec <= 0) return false;
    return expSec * 1000 < nowMs;
  } catch {
    return false;
  }
}

/** True when any stored slide URL looks expired (carousel pass should re-fetch via embed). */
export function carouselSlideUrlsLookStale(urls: string[], nowMs = Date.now()): boolean {
  return urls.some((u) => isLikelyStaleInstagramCdnUrl(u, nowMs));
}

export function parseCarouselCaptionContext(payload: Record<string, unknown>, maxChars = 6000): string {
  const parts: string[] = [];
  for (const k of ["caption", "Caption", "body_text", "main_text", "accessibility_caption"]) {
    const v = payload[k];
    if (v != null && String(v).trim()) parts.push(String(v).trim());
  }
  const t = parts.join("\n\n");
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}
