/**
 * OpenAI vision fetches image URLs from its own egress. Instagram / TikTok CDN URLs
 * typically return `invalid_image_url`. Core downloads bytes (optional HTTP proxy) and
 * inlines `data:image/…;base64,…` for the multimodal request.
 */
import type { AppConfig } from "../config.js";
import { finalizeHttpsImageUrlForOpenAiVision } from "./inputs-image-url-for-analysis.js";
import { tryCreateInstagramEmbedProxyAgent } from "./inputs-instagram-embed-carousel-resolver.js";
import { fetchRemoteImageFile } from "./inputs-top-performer-media-archive.js";

const SOCIAL_CDN_HOST_RE =
  /(?:^|\.)cdninstagram\.com$|(?:^|\.)fbcdn\.net$|(?:^|\.)tiktokcdn\.com$|(?:^|\.)tiktokv\.com$/i;

/** Signed Supabase (or similar) URLs are fetchable by OpenAI without inlining. */
export function isOpenAiDirectFetchableImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith("data:image/")) return true;
  if (u.includes("/object/sign/") || u.includes("X-Amz-Signature=") || u.includes("X-Amz-Credential=")) {
    return true;
  }
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (SOCIAL_CDN_HOST_RE.test(host)) return false;
    if (host.includes("instagram.") && !host.includes("supabase")) return false;
  } catch {
    return false;
  }
  return true;
}

export function shouldRelayImageUrlForOpenAi(url: string): boolean {
  const u = finalizeHttpsImageUrlForOpenAiVision(url);
  return !isOpenAiDirectFetchableImageUrl(u);
}

export const VISION_CDN_PROXY_HINT =
  "Set Fly secret CAF_INSTAGRAM_EMBED_HTTP_PROXY (HTTP CONNECT) so Core can download Instagram CDN slides, " +
  "or ensure Supabase top-performer media archive succeeds (signed storage URLs). " +
  "Old XLSX imports often store expired Instagram CDN links — carousel pass re-fetches slides from the post permalink when possible.";

/**
 * Remote vision providers (NVIDIA Nemotron, OpenAI) cannot fetch Instagram/TikTok CDN URLs from datacenter IPs.
 * Call after archive + relay; throws if any URL would still be fetched server-side from a blocked host.
 */
export function assertVisionImageUrlsSafeForRemoteFetch(urls: string[]): void {
  const blocked: string[] = [];
  for (const raw of urls) {
    const u = finalizeHttpsImageUrlForOpenAiVision(raw);
    if (shouldRelayImageUrlForOpenAi(u)) blocked.push(u);
  }
  if (blocked.length === 0) return;
  const sample = blocked[0]!.length > 96 ? `${blocked[0]!.slice(0, 96)}…` : blocked[0];
  throw new Error(
    `Vision blocked: ${blocked.length} slide image URL(s) are not reachable by the vision API ` +
      `(Instagram/TikTok CDN returns 403 from server egress). Example: ${sample}. ${VISION_CDN_PROXY_HINT}`
  );
}

export interface RelayImageUrlsForOpenAiResult {
  urls: string[];
  relayed_count: number;
  errors: Array<{ index: number; source_url: string; error: string }>;
}

/**
 * Replace social CDN HTTPS URLs with inline data URLs when OpenAI cannot download them.
 */
export async function relayImageUrlsForOpenAiVision(
  config: AppConfig,
  urls: string[],
  opts?: { http_proxy_url?: string | null }
): Promise<RelayImageUrlsForOpenAiResult> {
  const out: string[] = [];
  const errors: RelayImageUrlsForOpenAiResult["errors"] = [];
  let relayed_count = 0;
  const dispatcher = tryCreateInstagramEmbedProxyAgent(opts?.http_proxy_url);
  const timeoutMs = config.CAF_TOP_PERFORMER_ARCHIVE_FETCH_TIMEOUT_MS;
  const maxBytes = config.CAF_TOP_PERFORMER_ARCHIVE_MAX_BYTES_PER_FILE;
  const minBytes = config.CAF_TOP_PERFORMER_ARCHIVE_MIN_BYTES_CAROUSEL_IMAGE;

  try {
    for (let i = 0; i < urls.length; i++) {
      const raw = urls[i] ?? "";
      const finalized = finalizeHttpsImageUrlForOpenAiVision(raw);
      if (!shouldRelayImageUrlForOpenAi(finalized)) {
        out.push(finalized);
        continue;
      }
      try {
        const { buf, contentType } = await fetchRemoteImageFile(
          finalized,
          timeoutMs,
          maxBytes,
          minBytes,
          dispatcher ?? undefined
        );
        out.push(`data:${contentType};base64,${buf.toString("base64")}`);
        relayed_count++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ index: i, source_url: raw, error: msg });
        throw new Error(
          `Could not download slide image ${i + 1} for vision (${msg}). ${VISION_CDN_PROXY_HINT}`
        );
      }
    }
  } finally {
    try {
      await dispatcher?.close();
    } catch {
      /* ignore */
    }
  }

  return { urls: out, relayed_count, errors };
}
