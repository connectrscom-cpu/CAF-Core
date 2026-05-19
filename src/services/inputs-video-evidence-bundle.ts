import {
  enrichInstagramApifyPayloadInPlace,
  extractInstagramVideoSourceUrl,
} from "./instagram-media-normalizer.js";

/**
 * Video deep analysis uses **pre-extracted frames + transcript** for vision; ingestion may also set
 * `video_url` / `source_video_url` / … so Core can **optionally archive** one HTTPS source video to Supabase.
 *
 * Ingestion / workers should populate `payload_json.analysis_frame_urls` (HTTPS URLs, e.g. Supabase)
 * and optionally `transcript` / `analysis_transcript`.
 *
 * Frame lists also accept common scraper keys (`frame_urls`, `video_frame_urls`, `thumbnail_url`, …)
 * and **arrays of objects** `{ url | display_url | … }`. Single-cell Instagram/TikTok CDN URLs use the
 * same lenient host rules as `parseHttpsImageUrlsFromEvidenceCell` when strict extension regex misses.
 */

import { parseHttpsImageUrlsFromEvidenceCell, trimTrailingJunkFromImageUrl } from "./inputs-image-url-for-analysis.js";

/** Frame rows from scrapers: `[{ url, display_url, ... }, ...]`. */
function imageUrlsFromFrameObject(o: Record<string, unknown>, max: number): string[] {
  if (max <= 0) return [];
  const keys = ["url", "display_url", "thumbnail_url", "image_url", "src", "uri"] as const;
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

function firstStr(payload: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function parseVideoUrlArray(raw: unknown, max = 4): string[] {
  const fromImageCell = parseUrlArray(raw, max);
  if (fromImageCell.length > 0) return fromImageCell;
  const out: string[] = [];
  const push = (u: string) => {
    const n = normalizeHttpsArchiveUrl(u);
    if (!n || out.includes(n)) return;
    if (VIDEO_FILE_EXT_IN_PATH.test(n)) out.push(n);
  };
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (x != null && typeof x === "object" && !Array.isArray(x)) {
        for (const k of ["url", "video_url", "videoUrl", "playback_url", "download_url"] as const) {
          const v = (x as Record<string, unknown>)[k];
          if (v != null) push(String(v));
        }
      } else push(String(x));
      if (out.length >= max) return out;
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      return parseVideoUrlArray(JSON.parse(raw) as unknown, max);
    } catch {
      return [];
    }
  }
  if (typeof raw === "string" && raw.trim()) push(raw.trim());
  return out;
}

function parseUrlArray(raw: unknown, maxFrames: number): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const x of raw) {
      if (x != null && typeof x === "object" && !Array.isArray(x)) {
        for (const u of imageUrlsFromFrameObject(x as Record<string, unknown>, maxFrames - out.length)) {
          if (!out.includes(u)) out.push(u);
          if (out.length >= maxFrames) return out;
        }
        continue;
      }
      for (const u of parseHttpsImageUrlsFromEvidenceCell(String(x), maxFrames - out.length)) {
        if (!out.includes(u)) out.push(u);
        if (out.length >= maxFrames) return out;
      }
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const a = JSON.parse(raw) as unknown;
      return parseUrlArray(a, maxFrames);
    } catch {
      return [];
    }
  }
  if (typeof raw === "string" && raw.trim()) {
    return parseHttpsImageUrlsFromEvidenceCell(raw.trim(), maxFrames);
  }
  return [];
}

/**
 * HTTPS image URLs suitable for vision (sampled frames from a video or story).
 */
export function parseVideoAnalysisFrameUrls(
  payload: Record<string, unknown>,
  maxFrames = 12
): string[] {
  const keys = [
    "analysis_frame_urls",
    "evidence_frame_urls",
    "frame_urls",
    "video_frame_urls",
    "keyframes",
    "keyframes_urls",
    "preview_frames",
    "preview_frame_urls",
    "thumbnail_urls",
    /** Single-image fallbacks (common on TikTok / IG imports before a frame-extraction worker runs). */
    "thumbnail_url",
    "display_url",
    "cover_url",
    "poster_url",
    "preview_image_url",
    "og_image",
    "image_url",
  ];
  for (const k of keys) {
    const arr = parseUrlArray(payload[k], maxFrames);
    if (arr.length > 0) return arr;
  }
  return [];
}

export function parseVideoAnalysisTranscript(payload: Record<string, unknown>, maxChars = 8000): string {
  const t = firstStr(payload, [
    "transcript",
    "analysis_transcript",
    "caption",
    "Caption",
    "body_text",
    "main_text",
  ]);
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}

const VIDEO_FILE_EXT_IN_PATH = /\.(mp4|m4v|webm|mov|mkv)(\?|#|$)/i;

function normalizeHttpsArchiveUrl(raw: string): string | null {
  let u = raw.trim().replace(/^http:/i, "https:");
  u = trimTrailingJunkFromImageUrl(u);
  if (!/^https:\/\//i.test(u)) return null;
  return u;
}

/**
 * Best HTTPS URL for **one** downloadable source video (MP4/WebM/MOV/MKV) to archive alongside frame images.
 * Prioritises explicit video fields from scrapers / workers; `media_url` / `url` are only used when the path
 * looks like a direct media file (has a video extension) to avoid treating post pages as video.
 */
export function parseVideoSourceUrlForArchive(payload: Record<string, unknown>): string | null {
  const str = (v: unknown) => (v != null ? String(v).trim() : "");
  const layers: Record<string, unknown> = { ...payload };
  enrichInstagramApifyPayloadInPlace(layers);

  const priorityKeys = [
    "source_video_url",
    "raw_video_url",
    "analysis_video_url",
    "source_media_video_url",
    "video_url",
    "videoUrl",
    "video_play_url",
    "video_playback_url",
    "videoPlayUrl",
    "playback_url",
    "download_url",
    "mp4_url",
    "cdn_video_url",
    "mux_playback_url",
    "merged_video_url",
    "final_video_url",
    "rendered_video_url",
    "heygen_video_url",
  ];
  for (const k of priorityKeys) {
    const u = normalizeHttpsArchiveUrl(str(layers[k]));
    if (u) return u;
  }
  for (const k of ["video_urls", "video_urls_json", "videoUrls", "videoUrlsJson"]) {
    const raw = layers[k];
    const arr = parseVideoUrlArray(raw, 4);
    for (const u of arr) {
      const n = normalizeHttpsArchiveUrl(u);
      if (n) return n;
    }
  }
  for (const k of ["media_url", "url"]) {
    const u = normalizeHttpsArchiveUrl(str(layers[k]));
    if (u && VIDEO_FILE_EXT_IN_PATH.test(u)) return u;
  }
  return extractInstagramVideoSourceUrl(layers);
}
