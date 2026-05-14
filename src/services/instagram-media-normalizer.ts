/**
 * Ingest-first normalization of **Instagram** media URLs from Apify / workbook / scraper payloads.
 * Used by top-performer carousel vision — **not** as a substitute for Instagram `/embed/` HTML parsing
 * (that path remains a last-resort fallback in `inputs-deep-carousel-insights`).
 */

import {
  finalizeHttpsImageUrlForOpenAiVision,
  sanitizeOneHttpsImageUrl,
  tryLenientSingleHttpsImageUrlFromSocialCdn,
} from "./inputs-image-url-for-analysis.js";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

export type InstagramEvidenceMediaType = "carousel" | "image" | "video" | "reel" | "unknown";

export type InstagramAssetRole = "carousel_slide" | "cover_image" | "thumbnail" | "video" | "unknown";

export interface InstagramNormalizedMediaAsset {
  source_url: string;
  source_field: string;
  asset_role: InstagramAssetRole;
  media_type: "image" | "video" | "unknown";
  slide_index: number | null;
  width?: number | null;
  height?: number | null;
  original_post_url?: string | null;
}

export interface InstagramMediaNormalizerDiagnostics {
  discovered_count: number;
  usable_image_count: number;
  usable_video_count: number;
  carousel_slide_count: number;
  source_fields_hit: string[];
  rejected: Array<{ url?: string; reason: string; source_field?: string }>;
}

export interface NormalizedInstagramEvidenceMedia {
  post_url: string | null;
  post_id: string | null;
  short_code: string | null;
  owner_username: string | null;
  source_platform: "instagram";
  media_type: InstagramEvidenceMediaType;
  is_carousel: boolean;
  slide_count: number;
  media_assets: InstagramNormalizedMediaAsset[];
  diagnostics: InstagramMediaNormalizerDiagnostics;
}

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function tryParseJson(v: unknown): unknown {
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || (!t.startsWith("{") && !t.startsWith("["))) return null;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Merge top-level payload with nested Apify blobs (`raw_json`, `_raw_data`). */
function payloadLayers(root: Record<string, unknown>): Record<string, unknown>[] {
  const layers: Record<string, unknown>[] = [root];
  const raw = tryParseJson(root.raw_json) ?? tryParseJson(root._raw_data) ?? tryParseJson(root.payload_json);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    layers.push(raw as Record<string, unknown>);
  }
  return layers;
}

function firstFromLayers(layers: Record<string, unknown>[], keys: string[]): string {
  for (const layer of layers) {
    for (const k of keys) {
      const v = str(layer[k]);
      if (v) return v;
    }
  }
  return "";
}

/** Hard rejects: static bundles, permalinks as “image”, rsrc sprites. */
export function isRejectedInstagramMediaUrl(url: string): { ok: boolean; reason?: string } {
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) return { ok: false, reason: "not_https" };
  let host = "";
  let pathname = "";
  try {
    const x = new URL(u.replace(/^http:/i, "https:"));
    host = x.hostname.toLowerCase();
    pathname = x.pathname;
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (/instagram\.com\/(p|reel|tv)\//i.test(u)) return { ok: false, reason: "instagram_permalink_not_media" };
  if (host.includes("static.cdninstagram")) return { ok: false, reason: "static.cdninstagram" };
  if (u.includes("instagram.com/static")) return { ok: false, reason: "instagram_static_path" };
  if (/rsrc\.php/i.test(pathname)) return { ok: false, reason: "rsrc_bundle" };
  const socialCdn =
    host.includes("cdninstagram") ||
    host.endsWith(".cdninstagram.com") ||
    host.includes("fbcdn.net") ||
    host.includes("scontent");
  if (!socialCdn) return { ok: false, reason: "host_not_instagram_cdn" };
  return { ok: true };
}

function isVideoishUrl(u: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) || /\/video\//i.test(u);
}

function classifyMedia(u: string): "image" | "video" | "unknown" {
  if (isVideoishUrl(u)) return "video";
  if (IMAGE_EXT.test(u)) return "image";
  if (/\/v\/t\d+/i.test(u) || /\.(jpe?g|png|gif|webp|avif)/i.test(u)) return "image";
  return "unknown";
}

/** Finalize one HTTPS URL for persistence / vision (images + IG CDN videos). */
export function finalizeInstagramEvidenceMediaUrl(raw: string): string | null {
  const chk = isRejectedInstagramMediaUrl(raw);
  if (!chk.ok) return null;
  const t = raw.trim().replace(/^http:/i, "https:");
  if (isVideoishUrl(t)) {
    try {
      new URL(t);
      return finalizeHttpsImageUrlForOpenAiVision(t);
    } catch {
      return null;
    }
  }
  const one = sanitizeOneHttpsImageUrl(t) ?? tryLenientSingleHttpsImageUrlFromSocialCdn(t);
  if (!one) return null;
  return finalizeHttpsImageUrlForOpenAiVision(one);
}

function pushCandidate(
  ordered: InstagramNormalizedMediaAsset[],
  diag: InstagramMediaNormalizerDiagnostics,
  raw: string,
  sourceField: string,
  assetRole: InstagramAssetRole,
  slideIndex: number | null
): void {
  const url = finalizeInstagramEvidenceMediaUrl(raw);
  if (!url) {
    const r = isRejectedInstagramMediaUrl(raw);
    diag.rejected.push({
      url: raw.slice(0, 400),
      reason: r.reason ?? "filtered_or_invalid",
      source_field: sourceField,
    });
    return;
  }
  const mt = classifyMedia(url);
  ordered.push({
    source_url: url,
    source_field: sourceField,
    asset_role: assetRole,
    media_type: mt,
    slide_index: slideIndex,
  });
}

function readJsonArrayField(layer: Record<string, unknown>, snake: string, camel: string): unknown[] | null {
  for (const k of [snake, camel]) {
    const v = layer[k];
    if (v == null) continue;
    if (Array.isArray(v)) return v;
    const p = tryParseJson(v);
    if (Array.isArray(p)) return p;
  }
  return null;
}

function inferIsCarousel(layers: Record<string, unknown>[], slideCountFromAssets: number): boolean {
  const ic = str(firstFromLayers(layers, ["is_carousel", "isCarousel"])).toLowerCase();
  if (ic === "true" || ic === "1" || ic === "yes") return true;
  const mt = str(firstFromLayers(layers, ["media_type", "mediaType"])).toLowerCase();
  if (/\bsidecar\b/.test(mt) || mt.includes("carousel") || mt.includes("graphsidecar")) return true;
  const sc = parseInt(str(firstFromLayers(layers, ["slide_count", "slideCount"])), 10);
  if (!Number.isNaN(sc) && sc >= 2) return true;
  return slideCountFromAssets >= 2;
}

function inferMediaKind(layers: Record<string, unknown>[]): InstagramEvidenceMediaType {
  const mt = str(firstFromLayers(layers, ["media_type", "mediaType"])).toLowerCase();
  if (/\breel\b/.test(mt)) return "reel";
  if (/\bvideo\b/.test(mt)) return "video";
  if (/\bcarousel\b|sidecar|graphsidecar/.test(mt)) return "carousel";
  if (/\bimage\b/.test(mt)) return "image";
  return "unknown";
}

function dedupePreserveOrder(ordered: InstagramNormalizedMediaAsset[]): InstagramNormalizedMediaAsset[] {
  const out: InstagramNormalizedMediaAsset[] = [];
  const seen = new Set<string>();
  for (const a of ordered) {
    const k = a.source_url.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

function appendChildPostLikeArray(
  arr: unknown[] | null,
  ordered: InstagramNormalizedMediaAsset[],
  diag: InstagramMediaNormalizerDiagnostics,
  fieldLabel: string
): void {
  if (!arr) return;
  let i = 0;
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    i++;
    for (const k of ["displayUrl", "display_url", "imageUrl", "image_url", "url", "videoUrl", "video_url"]) {
      const u = str(o[k]);
      if (!u) continue;
      const role: InstagramAssetRole = classifyMedia(u) === "video" ? "video" : "carousel_slide";
      pushCandidate(ordered, diag, u, `${fieldLabel}.${k}`, role, i);
      break;
    }
  }
}

/**
 * Normalize Instagram-related media from evidence `payload_json` (Apify columns, legacy keys, optional `raw_json`).
 * Resolution order: explicit carousel lists → child / sidecar children → bulk arrays → cover → video.
 */
export function normalizeInstagramEvidenceMedia(payload: Record<string, unknown>): NormalizedInstagramEvidenceMedia {
  const layers = payloadLayers(payload);
  const post_url = firstFromLayers(layers, ["post_url", "postUrl", "Post URL", "permalink", "url"]) || null;
  const post_id = firstFromLayers(layers, ["post_id", "postId", "Post ID", "id"]) || null;
  const short_code = firstFromLayers(layers, ["shortcode", "shortCode", "short_code"]) || null;
  const owner_username =
    firstFromLayers(layers, ["owner_username", "ownerUsername", "account_handle", "accountHandle"]) || null;

  const diag: InstagramMediaNormalizerDiagnostics = {
    discovered_count: 0,
    usable_image_count: 0,
    usable_video_count: 0,
    carousel_slide_count: 0,
    source_fields_hit: [],
    rejected: [],
  };

  const ordered: InstagramNormalizedMediaAsset[] = [];

  const layerWalk = (fn: (layer: Record<string, unknown>) => void) => {
    for (const layer of layers) fn(layer);
  };

  // 1) carousel_slides_json / carousel_slides — ordered slides
  layerWalk((layer) => {
    for (const field of ["carousel_slides_json", "carousel_slides", "carouselSlidesJson", "carouselSlides"] as const) {
      const arr = readJsonArrayField(layer, field, field);
      if (!arr) continue;
      let idx = 0;
      for (const item of arr) {
        idx++;
        if (typeof item === "string") {
          pushCandidate(ordered, diag, item, field, "carousel_slide", idx);
          continue;
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const si = o.slide_index != null ? parseInt(String(o.slide_index), 10) : NaN;
        const slideIndex = Number.isFinite(si) ? si : idx;
        const u = str(o.url ?? o.displayUrl ?? o.display_url ?? o.imageUrl ?? o.image_url);
        if (!u) continue;
        pushCandidate(ordered, diag, u, field, "carousel_slide", slideIndex);
      }
    }
  });

  // 2) carousel_slide_urls_json / carousel_slide_urls
  layerWalk((layer) => {
    const arr = readJsonArrayField(layer, "carousel_slide_urls_json", "carouselSlideUrlsJson");
    if (arr) {
      let i = 0;
      for (const cell of arr) {
        const u = str(cell);
        if (!u) continue;
        i++;
        pushCandidate(ordered, diag, u, "carousel_slide_urls_json", "carousel_slide", i);
      }
    }
    const rawCell = layer.carousel_slide_urls ?? layer.carouselSlideUrls;
    if (Array.isArray(rawCell)) {
      let i = 0;
      for (const cell of rawCell) {
        const u = str(cell);
        if (!u) continue;
        i++;
        pushCandidate(ordered, diag, u, "carousel_slide_urls", "carousel_slide", i);
      }
    } else if (typeof rawCell === "string" && rawCell.trim().startsWith("[")) {
      const p = tryParseJson(rawCell);
      if (Array.isArray(p)) {
        let i = 0;
        for (const cell of p) {
          const u = str(cell);
          if (!u) continue;
          i++;
          pushCandidate(ordered, diag, u, "carousel_slide_urls", "carousel_slide", i);
        }
      }
    }
  });

  // 3) child_posts / sidecar children (Apify order: children first, then sidecar lists)
  layerWalk((layer) => {
    appendChildPostLikeArray(
      readJsonArrayField(layer, "child_posts_json", "childPostsJson") ??
        readJsonArrayField(layer, "childPosts", "child_posts"),
      ordered,
      diag,
      "childPosts"
    );
    appendChildPostLikeArray(
      readJsonArrayField(layer, "sidecar_children_json", "sidecarChildrenJson") ??
        readJsonArrayField(layer, "sidecar_children", "sidecarChildren"),
      ordered,
      diag,
      "sidecar_children"
    );
  });

  // 4) images / media_urls (including *_json workbook columns once copied to payload)
  layerWalk((layer) => {
    const mediaSpecs: Array<[string, string]> = [
      ["images_json", "imagesJson"],
      ["images", "images"],
      ["media_urls_json", "mediaUrlsJson"],
      ["media_urls", "mediaUrls"],
      ["mediaUrls", "mediaUrls"],
    ];
    for (const [snake, camel] of mediaSpecs) {
      const arr = readJsonArrayField(layer, snake, camel);
      if (!arr) continue;
      let i = 0;
      for (const cell of arr) {
        const u = str(cell);
        if (!u) continue;
        i++;
        pushCandidate(ordered, diag, u, snake, "carousel_slide", i);
      }
    }
  });

  // 5) cover fallbacks
  layerWalk((layer) => {
    for (const k of ["display_url", "displayUrl", "primary_image_url", "primaryImageUrl", "image_url", "imageUrl", "thumbnail_url", "thumbnailUrl"]) {
      const u = str(layer[k]);
      if (!u) continue;
      pushCandidate(ordered, diag, u, k, "cover_image", null);
    }
  });

  // 6) video
  layerWalk((layer) => {
    const vu = str(layer.video_url ?? layer.videoUrl);
    if (vu) pushCandidate(ordered, diag, vu, "video_url", "video", null);
    const arr = readJsonArrayField(layer, "video_urls_json", "videoUrlsJson");
    if (arr) {
      for (const cell of arr) {
        const u = str(cell);
        if (!u) continue;
        pushCandidate(ordered, diag, u, "video_urls_json", "video", null);
      }
    }
  });

  const media_assets = dedupePreserveOrder(ordered);
  diag.discovered_count = media_assets.length;
  diag.source_fields_hit = [...new Set(media_assets.map((a) => a.source_field))];

  const usable_images = media_assets.filter((a) => a.media_type === "image" || a.media_type === "unknown");
  const usable_videos = media_assets.filter((a) => a.media_type === "video");
  const carouselSlides = media_assets.filter((a) => a.asset_role === "carousel_slide" && a.media_type !== "video");

  diag.usable_image_count = usable_images.length;
  diag.usable_video_count = usable_videos.length;
  diag.carousel_slide_count = carouselSlides.length;

  const slide_count_field = parseInt(str(firstFromLayers(layers, ["slide_count", "slideCount"])), 10);
  const is_carousel = inferIsCarousel(layers, carouselSlides.length);
  let media_type = inferMediaKind(layers);
  if (media_type === "unknown") {
    if (usable_videos.length > 0 && usable_images.length === 0) media_type = "video";
    else if (usable_images.length > 0) media_type = is_carousel ? "carousel" : "image";
  } else if (is_carousel && media_type !== "reel" && media_type !== "video") {
    media_type = "carousel";
  }

  const slide_count =
    !Number.isNaN(slide_count_field) && slide_count_field > 0
      ? slide_count_field
      : Math.max(carouselSlides.length, usable_images.length, usable_videos.length);

  return {
    post_url,
    post_id,
    short_code,
    owner_username,
    source_platform: "instagram",
    media_type,
    is_carousel,
    slide_count,
    media_assets,
    diagnostics: diag,
  };
}

/** Ordered HTTPS image URLs for carousel deck vision (non-video), deduped, ingest priority baked into `media_assets` order. */
export function extractOrderedInstagramCarouselImageUrls(payload: Record<string, unknown>, maxSlides: number): string[] {
  const n = normalizeInstagramEvidenceMedia(payload);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of n.media_assets) {
    if (a.media_type === "video") continue;
    const k = a.source_url.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a.source_url);
    if (out.length >= maxSlides) break;
  }
  return out;
}

/**
 * Copy Apify / XLSX JSON-string columns into canonical keys so parsers (`images`, `childPosts`, …) see arrays in `payload_json`.
 */
export function enrichInstagramApifyPayloadInPlace(payload: Record<string, unknown>): void {
  const pairs: Array<[string, string]> = [
    ["carousel_slide_urls_json", "carousel_slide_urls"],
    ["carousel_slides_json", "carousel_slides"],
    ["images_json", "images"],
    ["media_urls_json", "media_urls"],
    ["child_posts_json", "childPosts"],
    ["video_urls_json", "video_urls"],
  ];
  for (const [from, to] of pairs) {
    const v = payload[from];
    const cur = payload[to];
    if (Array.isArray(cur)) continue;
    if (typeof cur === "string" && cur.trim().startsWith("[")) {
      const inner = tryParseJson(cur);
      if (Array.isArray(inner)) (payload as Record<string, unknown>)[to] = inner as unknown;
      continue;
    }
    if (v == null) continue;
    const p = tryParseJson(v);
    if (p != null) (payload as Record<string, unknown>)[to] = p as unknown;
  }
}
