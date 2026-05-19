/**
 * Download slide / frame HTTPS URLs used for top-performer vision and upload **verified image files**
 * to Supabase Storage (magic-byte sniff → correct `Content-Type` and extension; bucket keys under
 * `top_performer_inspection/`).
 *
 * Optional `http_proxy_url` (same as Instagram embed): undici {@link ProxyAgent} so Core can reach
 * Instagram CDN URLs from datacenter egress when direct `fetch` returns 403 / HTML / tiny placeholders.
 *
 * For `top_performer_video`, optionally also archives **one** verified source video (MP4 / WebM / Matroska)
 * from `source_video_url` when enabled.
 */

import type { Dispatcher } from "undici";
import type { AppConfig } from "../config.js";
import { tryCreateInstagramEmbedProxyAgent } from "./inputs-instagram-embed-carousel-resolver.js";
import { createSignedUrlForObjectKey, getSupabaseStorageClient, uploadBuffer } from "./supabase-storage.js";

/** Long enough for OpenAI multimodal fetch + admin retries (signed URLs work when the bucket is not public). */
const VISION_ARCHIVE_SIGNED_URL_TTL_SEC = 604800; // 7d

export interface TopPerformerArchivedMediaItem {
  index: number;
  role: "carousel_slide" | "video_frame" | "source_video";
  source_url: string;
  bucket: string;
  object_path: string;
  public_url: string | null;
  /** Prefer this for remote vision fetchers (OpenAI); service-role signed URL when the bucket is private. */
  vision_fetch_url: string | null;
  content_type: string;
  bytes: number;
  ok: boolean;
  error?: string;
}

export interface TopPerformerArchiveMediaResult {
  archived_at: string;
  tier: "top_performer_carousel" | "top_performer_video" | "top_performer_deep";
  project_slug: string;
  inputs_import_id: string;
  source_evidence_row_id: string;
  items: TopPerformerArchivedMediaItem[];
  skipped_reason?: string;
}

function truthyArchive(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function explicitArchiveDisable(v: unknown): boolean {
  if (v === false) return true;
  const s = String(v).trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/**
 * Whether to run the archive step before persisting the insight row.
 * - **Env `off`:** never.
 * - **Env `on`:** always (Supabase upload may still skip if not configured).
 * - **Env `auto` (default):** yes when Supabase is configured, unless criteria explicitly disables.
 * - **Criteria `archive_top_performer_media_to_storage`:** `true` forces on; `false` forces off in auto mode.
 */
export function resolveTopPerformerArchiveMedia(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const mode = config.CAF_TOP_PERFORMER_ARCHIVE_MEDIA;
  if (mode === "off") return false;
  if (mode === "on") return true;

  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const raw = (ins as Record<string, unknown>).archive_top_performer_media_to_storage;
    if (explicitArchiveDisable(raw)) return false;
    if (truthyArchive(raw)) return true;
  }

  return !!getSupabaseStorageClient(config);
}

/**
 * When slide/frame archiving runs for `top_performer_video`, controls the **extra** full-file source
 * video download (see `parseVideoSourceUrlForArchive`).
 * - **Env `off`:** never archive source video.
 * - **Env `on`:** always attempt when a URL is supplied.
 * - **Env `auto` (default):** attempt unless criteria sets `archive_top_performer_source_video` to false.
 */
export function resolveTopPerformerArchiveSourceVideo(config: AppConfig, criteria: Record<string, unknown>): boolean {
  const mode = config.CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO;
  if (mode === "off") return false;
  if (mode === "on") return true;

  const ins = criteria.inputs_insights;
  if (ins && typeof ins === "object" && !Array.isArray(ins)) {
    const raw = (ins as Record<string, unknown>).archive_top_performer_source_video;
    if (explicitArchiveDisable(raw)) return false;
    if (truthyArchive(raw)) return true;
  }

  return true;
}

function slugPathSegment(slug: string): string {
  const s = slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64);
  return s || "project";
}

/** OpenAI fetches image URLs anonymously; private buckets need a signed URL (public URL may 403). */
async function setVisionFetchUrlAfterUpload(config: AppConfig, item: TopPerformerArchivedMediaItem): Promise<void> {
  if (!item.ok || !item.object_path) {
    item.vision_fetch_url = null;
    return;
  }
  const signed = await createSignedUrlForObjectKey(config, item.bucket, item.object_path, VISION_ARCHIVE_SIGNED_URL_TTL_SEC);
  item.vision_fetch_url = "signedUrl" in signed ? signed.signedUrl : item.public_url;
}

/** Detect real image media from file magic bytes (not just HTTP headers). */
export function sniffImageMedia(buf: Buffer): { contentType: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: "image/jpeg", ext: ".jpg" };
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { contentType: "image/png", ext: ".png" };
  }
  const sig6 = buf.subarray(0, 6).toString("ascii");
  if (sig6 === "GIF87a" || sig6 === "GIF89a") {
    return { contentType: "image/gif", ext: ".gif" };
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: ".webp" };
  }
  const head = buf.subarray(0, Math.min(64, buf.length)).toString("latin1");
  if (head.includes("ftyp") && (head.includes("avif") || head.includes("avis") || head.includes("mif1"))) {
    return { contentType: "image/avif", ext: ".avif" };
  }
  return null;
}

/** ISO BMFF / WebM / Matroska — not audio-only checks; callers guard size and context. */
export function sniffVideoMedia(buf: Buffer): { contentType: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand4 = buf.subarray(8, 12).toString("latin1");
    if (/^qt/i.test(brand4)) return { contentType: "video/quicktime", ext: ".mov" };
    return { contentType: "video/mp4", ext: ".mp4" };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.subarray(0, Math.min(4096, buf.length)).toString("latin1");
    if (head.includes("matroska")) return { contentType: "video/x-matroska", ext: ".mkv" };
    return { contentType: "video/webm", ext: ".webm" };
  }
  return null;
}

export async function fetchRemoteImageFile(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  minAcceptBytes?: number,
  dispatcher?: Dispatcher
): Promise<{ buf: Buffer; contentType: string; ext: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; CAF-Core/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new Error(`body too large (${ab.byteLength} > ${maxBytes})`);
    const buf = Buffer.from(ab);
    const sniffed = sniffImageMedia(buf);
    if (!sniffed) {
      const hdr = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
      throw new Error(hdr ? `not a valid image file (magic bytes; server said ${hdr})` : "not a valid image file (magic bytes)");
    }
    if (minAcceptBytes != null && buf.length < minAcceptBytes) {
      throw new Error(
        `image smaller than ${minAcceptBytes} bytes (${buf.length}B); likely Instagram embed logo or placeholder (fix slide URLs in evidence / embed extraction)`
      );
    }
    return { buf, contentType: sniffed.contentType, ext: sniffed.ext };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchRemoteVideoFile(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  dispatcher?: Dispatcher
): Promise<{ buf: Buffer; contentType: string; ext: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        Accept: "video/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; CAF-Core/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new Error(`body too large (${ab.byteLength} > ${maxBytes})`);
    const buf = Buffer.from(ab);
    const sniffed = sniffVideoMedia(buf);
    if (!sniffed) {
      const hdr = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
      throw new Error(hdr ? `not a valid video file (magic bytes; server said ${hdr})` : "not a valid video file (magic bytes)");
    }
    return { buf, contentType: sniffed.contentType, ext: sniffed.ext };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch each URL and upload under `top_performer_inspection/{slug}/{importId}/{tier}/row_{id}/…`.
 * No-op when Supabase is not configured and there is nothing to archive.
 */
export async function archiveTopPerformerVisionMedia(
  config: AppConfig,
  args: {
    projectSlug: string;
    inputsImportId: string;
    sourceEvidenceRowId: string;
    tier: "top_performer_carousel" | "top_performer_video" | "top_performer_deep";
    role: "carousel_slide" | "video_frame";
    urls: string[];
    /** When tier is `top_performer_video` and this flag is true, download + upload this URL after frames. */
    archive_source_video?: boolean;
    source_video_url?: string | null;
    /** HTTP CONNECT proxy (e.g. `CAF_INSTAGRAM_EMBED_HTTP_PROXY`) for slide/frame/source CDN fetches. */
    http_proxy_url?: string | null;
  }
): Promise<TopPerformerArchiveMediaResult> {
  const base: TopPerformerArchiveMediaResult = {
    archived_at: new Date().toISOString(),
    tier: args.tier,
    project_slug: args.projectSlug,
    inputs_import_id: args.inputsImportId,
    source_evidence_row_id: args.sourceEvidenceRowId,
    items: [],
  };
  if (!getSupabaseStorageClient(config)) {
    base.skipped_reason = "supabase_not_configured";
    return base;
  }

  const srcUrl = args.source_video_url?.trim() || "";
  const wantsSourceVideo =
    args.tier === "top_performer_video" && !!srcUrl && (args.archive_source_video ?? false);

  if (!args.urls.length && !wantsSourceVideo) {
    base.skipped_reason = "no_urls";
    return base;
  }

  const slug = slugPathSegment(args.projectSlug);
  const imp = args.inputsImportId.replace(/-/g, "");
  const row = String(args.sourceEvidenceRowId).replace(/\D/g, "") || "0";
  const prefix = `top_performer_inspection/${slug}/${imp}/${args.tier}/row_${row}`;

  const archiveProxyAgent = tryCreateInstagramEmbedProxyAgent(args.http_proxy_url);
  try {
    for (let i = 0; i < args.urls.length; i++) {
      const source_url = args.urls[i];
      const item: TopPerformerArchivedMediaItem = {
        index: i,
        role: args.role,
        source_url,
        bucket: config.SUPABASE_ASSETS_BUCKET || "assets",
        object_path: "",
        public_url: null,
        vision_fetch_url: null,
        content_type: "",
        bytes: 0,
        ok: false,
      };
      try {
        const minCarouselBytes =
          args.tier === "top_performer_carousel" || args.tier === "top_performer_deep"
            ? config.CAF_TOP_PERFORMER_ARCHIVE_MIN_BYTES_CAROUSEL_IMAGE
            : undefined;
        const { buf, contentType, ext } = await fetchRemoteImageFile(
          source_url,
          config.CAF_TOP_PERFORMER_ARCHIVE_FETCH_TIMEOUT_MS,
          config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_PER_FILE,
          minCarouselBytes,
          archiveProxyAgent
        );
        const name =
          args.role === "carousel_slide" ? `slide_${String(i + 1).padStart(2, "0")}` : `frame_${String(i + 1).padStart(2, "0")}`;
        const objectPathRel = `${prefix}/${name}${ext}`;
        const up = await uploadBuffer(config, objectPathRel, buf, contentType);
        item.bucket = up.bucket;
        item.object_path = up.object_path;
        item.public_url = up.public_url;
        item.content_type = contentType;
        item.bytes = buf.length;
        item.ok = true;
        await setVisionFetchUrlAfterUpload(config, item);
      } catch (e) {
        item.error = e instanceof Error ? e.message : String(e);
      }
      base.items.push(item);
    }

    if (wantsSourceVideo) {
      const idx = args.urls.length;
      const item: TopPerformerArchivedMediaItem = {
        index: idx,
        role: "source_video",
        source_url: srcUrl,
        bucket: config.SUPABASE_ASSETS_BUCKET || "assets",
        object_path: "",
        public_url: null,
        vision_fetch_url: null,
        content_type: "",
        bytes: 0,
        ok: false,
      };
      try {
        const { buf, contentType, ext } = await fetchRemoteVideoFile(
          srcUrl,
          config.CAF_TOP_PERFORMER_ARCHIVE_SOURCE_VIDEO_TIMEOUT_MS,
          config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_SOURCE_VIDEO,
          archiveProxyAgent
        );
        const objectPathRel = `${prefix}/source${ext}`;
        const up = await uploadBuffer(config, objectPathRel, buf, contentType);
        item.bucket = up.bucket;
        item.object_path = up.object_path;
        item.public_url = up.public_url;
        item.content_type = contentType;
        item.bytes = buf.length;
        item.ok = true;
        await setVisionFetchUrlAfterUpload(config, item);
      } catch (e) {
        item.error = e instanceof Error ? e.message : String(e);
      }
      base.items.push(item);
    }

    return base;
  } finally {
    try {
      await archiveProxyAgent?.close();
    } catch {
      /* ignore */
    }
  }
}
