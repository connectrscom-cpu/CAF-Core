/**
 * Best-effort resolution of Instagram **carousel** image URLs by fetching the public `/embed/`
 * HTML for a permalink. Used when ingest has `media_type: Sidecar` (or similar) but no child
 * `display_url` list in `payload_json`.
 *
 * Tries multiple embed URL shapes (`/embed/`, `/embed/captioned/`, `/embed/?omitscript=true`) and
 * merges extracted CDN URLs — Instagram sometimes serves richer JSON on one variant.
 *
 * Instagram may return login walls or empty markup from datacenter IPs — treat as optional enrichment.
 * Optional **HTTP CONNECT** proxy: `CAF_INSTAGRAM_EMBED_HTTP_PROXY` or `criteria_json.inputs_insights.instagram_embed_http_proxy`
 * (undici {@link ProxyAgent}; embed HTML fetches and **top-performer slide/frame archive** downloads to Supabase).
 *
 * **Meta Graph `instagram_oembed`:** can return `thumbnail_url` / embed HTML for public posts with an app token,
 * but Meta’s terms restrict using that content for purposes other than **front-end embedding** — do not wire
 * oEmbed into this **top-performer / analytics** pipeline without legal review ([Instagram oEmbed docs](https://developers.facebook.com/docs/instagram-platform/oembed)).
 *
 * **Two modes:** **permissive** (default for **eligibility / vision merge**) keeps CDN URLs that strict
 * mode drops (e.g. small `/s150x150/` paths) so `/embed/` can still yield ≥2 slide URLs when JSON is thin.
 * **Strict** uses the full UI-asset filter — useful in tests / diagnostics.
 * **Storage** still rejects tiny placeholder bodies via `CAF_TOP_PERFORMER_ARCHIVE_MIN_BYTES_CAROUSEL_IMAGE`.
 */

import type { AppConfig } from "../config.js";
import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";
import { finalizeHttpsImageUrlForOpenAiVision } from "./inputs-image-url-for-analysis.js";

const PERMALINK_SC = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,32})\/?/i;

/**
 * Build an undici {@link ProxyAgent} for `CAF_INSTAGRAM_EMBED_HTTP_PROXY` / criteria override.
 * Caller must {@link ProxyAgent.close} after the embed prefetch batch or an archive download batch.
 */
export function tryCreateInstagramEmbedProxyAgent(proxyUrl: string | undefined | null): ProxyAgent | undefined {
  const u = proxyUrl?.trim();
  if (!u) return undefined;
  try {
    return new ProxyAgent(u);
  } catch {
    return undefined;
  }
}

/** Same proxy URL rules as embed + archive: criteria override, else env. */
export function resolveInstagramEmbedHttpProxy(
  config: AppConfig,
  criteria: Record<string, unknown>
): { url: string | undefined; source: "criteria" | "env" | "none" } {
  const ins = criteria.inputs_insights;
  const insObj = ins && typeof ins === "object" && !Array.isArray(ins) ? (ins as Record<string, unknown>) : null;
  const fromCriteria = insObj?.instagram_embed_http_proxy;
  if (typeof fromCriteria === "string" && fromCriteria.trim()) {
    return { url: fromCriteria.trim(), source: "criteria" };
  }
  const fromEnv = config.CAF_INSTAGRAM_EMBED_HTTP_PROXY?.trim();
  if (fromEnv) return { url: fromEnv, source: "env" };
  return { url: undefined, source: "none" };
}

export function extractInstagramPermalinkShortcode(postUrl: string): string | null {
  const m = postUrl.match(PERMALINK_SC);
  return m?.[1] ?? null;
}

function normalizeExtractedUrl(raw: string): string | null {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  u = u.replace(/^http:/i, "https:");
  u = u.replace(/\\u0026/g, "&");
  u = u.replace(/\\\//g, "/");
  u = finalizeHttpsImageUrlForOpenAiVision(u);
  if (!/^https:\/\//i.test(u)) return null;
  let host = "";
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.includes("cdninstagram") && !host.includes("fbcdn") && !host.includes("scontent")) {
    return null;
  }
  if (/instagram\.com\/(p|reel|tv)\//i.test(u)) return null;
  return u;
}

/** Hard reject: static bundles / rsrc sprites — never useful as slide art. */
export function isHardRejectedInstagramEmbedCdnUrl(u: string): boolean {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase();
    const path = x.pathname;
    if (host.includes("static.cdninstagram")) return true;
    if (/rsrc\.php/i.test(path)) return true;
  } catch {
    return true;
  }
  return false;
}

/** Extra strict: small `/s150x150/` style paths (embed chrome) — use only in `strict` extract mode. */
export function isLikelyInstagramEmbedUiAssetUrl(u: string): boolean {
  if (isHardRejectedInstagramEmbedCdnUrl(u)) return true;
  try {
    const path = new URL(u).pathname;
    const m = path.match(/\/s(\d+)x(\d+)\//i);
    if (m) {
      const w = parseInt(m[1], 10);
      const h = parseInt(m[2], 10);
      if (w > 0 && h > 0 && w * h < 320 * 320) return true;
    }
  } catch {
    return true;
  }
  return false;
}

/** Prefer larger explicit CDN renditions when sorting (higher = better). */
export function scoreInstagramCarouselCdnUrl(u: string): number {
  try {
    const m = u.match(/\/s(\d+)x(\d+)\//i);
    if (!m) return 2_000_000;
    return parseInt(m[1], 10) * parseInt(m[2], 10);
  } catch {
    return 0;
  }
}

/** Rough signals on embed HTML (datacenter login walls vs JSON-rich responses). */
export function instagramEmbedHtmlDiagnostics(html: string): {
  /** Legacy substring check (Instagram may omit this key while still shipping other JSON). */
  html_contains_display_url: boolean;
  /** Broader hints that the body may carry extractable media (not proof extraction succeeded). */
  html_has_embed_media_signals: boolean;
  /** Body mentions slide-relevant Instagram CDNs (excludes `static.cdninstagram` bundles that often appear on login/minimal pages). */
  html_has_cdninstagram_host: boolean;
  login_wall_likely: boolean;
} {
  const head = html.slice(0, 50_000);
  const low = head.toLowerCase();
  /** Avoid counting `static.cdninstagram.com` script/sprites as “has CDN slides”. */
  const cdnHost =
    /\bscontent[\w.-]*\.cdninstagram\.com\b/i.test(html) ||
    /\.fbcdn\.net\/[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i.test(html) ||
    /https:\/\/(?!static\.cdninstagram\.com)[a-z0-9.-]*cdninstagram\.com\/[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i.test(
      html
    );
  const mediaSignals =
    low.includes("display_url") ||
    low.includes("thumbnail_url") ||
    low.includes("thumbnail_src") ||
    low.includes("edge_sidecar_to_children") ||
    low.includes("carousel_media") ||
    low.includes("image_versions2") ||
    low.includes("displayresources") ||
    (low.includes("og:image") && cdnHost) ||
    (low.includes("twitter:image") && cdnHost);
  return {
    html_contains_display_url: low.includes("display_url"),
    html_has_embed_media_signals: mediaSignals,
    html_has_cdninstagram_host: cdnHost,
    login_wall_likely:
      /\/accounts\/login|\/challenge\//i.test(head) ||
      (/log\s*in/i.test(low) && /instagram/i.test(low)),
  };
}

function pushNormalized(out: string[], seen: Set<string>, raw: string): void {
  const u = normalizeExtractedUrl(raw);
  if (!u || seen.has(u)) return;
  seen.add(u);
  out.push(u);
}

function collectOgTwitterMeta(html: string, out: string[], seen: Set<string>, cap: number): void {
  for (const m of html.matchAll(
    /<meta[^>]+property=["']og:image["'][^>]*content=["'](https:\/\/[^"']+)["']/gi
  )) {
    pushNormalized(out, seen, m[1]);
    if (out.length >= cap) return;
  }
  for (const m of html.matchAll(
    /<meta[^>]+content=["'](https:\/\/[^"']+)["'][^>]*property=["']og:image["']/gi
  )) {
    pushNormalized(out, seen, m[1]);
    if (out.length >= cap) return;
  }
  for (const m of html.matchAll(/<meta[^>]+name=["']twitter:image["'][^>]*content=["'](https:\/\/[^"']+)["']/gi)) {
    pushNormalized(out, seen, m[1]);
    if (out.length >= cap) return;
  }
}

export type InstagramEmbedCarouselExtractMode = "permissive" | "strict";

/**
 * Pull CDN image URLs from embed HTML / embedded JSON (unit-testable; no network).
 * @param mode **permissive** (default): maximize chance of ≥2 slide URLs for vision merge (keeps small CDN paths).
 * **strict**: filter small thumbnails; `og:image` only when still &lt; 2 URLs after JSON / src / loose.
 */
export function extractInstagramCarouselUrlsFromEmbedHtml(
  html: string,
  maxSlides: number,
  mode: InstagramEmbedCarouselExtractMode = "permissive"
): string[] {
  if (maxSlides <= 0) return [];
  const strict = mode === "strict";
  const assetFilter = strict ? isLikelyInstagramEmbedUiAssetUrl : isHardRejectedInstagramEmbedCdnUrl;

  const primary: string[] = [];
  const seen = new Set<string>();

  const jsonEscUrl = /\\?"(display_url|thumbnail_url|thumbnail_src)\\?"\s*:\s*\\?"(https?:\\?\/\\?\/[^"\\]+)\\?"/gi;
  for (const m of html.matchAll(jsonEscUrl)) {
    pushNormalized(primary, seen, m[2]);
    if (primary.length >= maxSlides * 4) break;
  }
  const jsonPlainUrl = /"(display_url|thumbnail_url|thumbnail_src)"\s*:\s*"(https?:\\\/\\\/[^"]+)"/g;
  for (const m of html.matchAll(jsonPlainUrl)) {
    pushNormalized(primary, seen, m[2]);
    if (primary.length >= maxSlides * 4) break;
  }

  const noOgTwitterMeta = html
    .replace(/<meta[^>]+property=["']og:image["'][^>]*>/gi, "")
    .replace(/<meta[^>]+name=["']twitter:image["'][^>]*>/gi, "")
    .replace(/<meta[^>]+content=["'][^"']+["'][^>]*property=["']og:image["'][^>]*>/gi, "");
  for (const m of noOgTwitterMeta.matchAll(/src=\\?"(https?:\\?\/\\?\/[^"\\]+\.(?:jpe?g|png|webp)[^"\\]*)\\?"/gi)) {
    pushNormalized(primary, seen, m[1]);
    if (primary.length >= maxSlides * 4) break;
  }
  const slashFixed = noOgTwitterMeta.replace(/\\\//g, "/");
  for (const m of slashFixed.matchAll(
    /https:\/\/scontent[^\s"'<>]+\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi
  )) {
    pushNormalized(primary, seen, m[0]);
    if (primary.length >= maxSlides * 4) break;
  }
  for (const m of slashFixed.matchAll(
    /https:\/\/[a-z0-9.-]*cdninstagram[^\s"'<>]+\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi
  )) {
    pushNormalized(primary, seen, m[0]);
    if (primary.length >= maxSlides * 4) break;
  }

  let filtered = primary.filter((u) => !assetFilter(u));
  filtered.sort((a, b) => scoreInstagramCarouselCdnUrl(b) - scoreInstagramCarouselCdnUrl(a));

  const out: string[] = [];
  const outSeen = new Set<string>();
  for (const u of filtered) {
    if (outSeen.has(u)) continue;
    outSeen.add(u);
    out.push(u);
    if (out.length >= maxSlides) return out;
  }

  if (out.length >= 2 || maxSlides < 2) return out;

  const metaFallback: string[] = [];
  const metaSeen = new Set<string>();
  collectOgTwitterMeta(html, metaFallback, metaSeen, maxSlides * 4);
  const metaOk = metaFallback.filter((u) => !assetFilter(u));
  metaOk.sort((a, b) => scoreInstagramCarouselCdnUrl(b) - scoreInstagramCarouselCdnUrl(a));
  for (const u of metaOk) {
    if (outSeen.has(u)) continue;
    outSeen.add(u);
    out.push(u);
    if (out.length >= maxSlides) break;
  }
  return out;
}

export interface InstagramEmbedFetchOutcome {
  urls: string[];
  http_ok: boolean;
  html_bytes: number;
  html_contains_display_url: boolean;
  html_has_embed_media_signals: boolean;
  html_has_cdninstagram_host: boolean;
  login_wall_likely: boolean;
}

/** `/p|reel|tv/{shortcode}/embed/…` URL variants (standard, captioned, omitscript). */
export function instagramPermalinkEmbedFetchUrls(postUrl: string, shortcode: string): string[] {
  const sc = encodeURIComponent(shortcode);
  const u = postUrl.toLowerCase();
  const kind = u.includes("/reel/") ? "reel" : u.includes("/tv/") ? "tv" : "p";
  const base = `https://www.instagram.com/${kind}/${sc}`;
  return [`${base}/embed/`, `${base}/embed/captioned/`, `${base}/embed/?omitscript=true`];
}

function mergeInstagramEmbedFetchOutcomes(
  a: InstagramEmbedFetchOutcome,
  b: InstagramEmbedFetchOutcome,
  maxSlides: number
): InstagramEmbedFetchOutcome {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of [...a.urls, ...b.urls]) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
    if (urls.length >= maxSlides) break;
  }
  return {
    urls,
    http_ok: a.http_ok || b.http_ok,
    html_bytes: Math.max(a.html_bytes, b.html_bytes),
    html_contains_display_url: a.html_contains_display_url || b.html_contains_display_url,
    html_has_embed_media_signals: a.html_has_embed_media_signals || b.html_has_embed_media_signals,
    html_has_cdninstagram_host: a.html_has_cdninstagram_host || b.html_has_cdninstagram_host,
    login_wall_likely: a.login_wall_likely || b.login_wall_likely,
  };
}

async function fetchOneInstagramEmbedPage(
  embedPageUrl: string,
  opts: { maxSlides: number; timeoutMs: number; maxBytes: number; dispatcher?: Dispatcher }
): Promise<InstagramEmbedFetchOutcome> {
  const empty = (http_ok: boolean): InstagramEmbedFetchOutcome => ({
    urls: [],
    http_ok,
    html_bytes: 0,
    html_contains_display_url: false,
    html_has_embed_media_signals: false,
    html_has_cdninstagram_host: false,
    login_wall_likely: false,
  });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const init: RequestInit & { dispatcher?: Dispatcher } = {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.instagram.com/",
        "Upgrade-Insecure-Requests": "1",
      },
    };
    if (opts.dispatcher) init.dispatcher = opts.dispatcher;
    const res = await fetch(embedPageUrl, init);
    if (!res.ok) return empty(false);
    const text = await res.text();
    const html = text.length > opts.maxBytes ? text.slice(0, opts.maxBytes) : text;
    const diag = instagramEmbedHtmlDiagnostics(html);
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, opts.maxSlides, "permissive");
    return {
      urls,
      http_ok: true,
      html_bytes: html.length,
      html_contains_display_url: diag.html_contains_display_url,
      html_has_embed_media_signals: diag.html_has_embed_media_signals,
      html_has_cdninstagram_host: diag.html_has_cdninstagram_host,
      login_wall_likely: diag.login_wall_likely,
    };
  } catch {
    return empty(false);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchInstagramCarouselUrlsFromEmbedDetailed(
  postUrl: string,
  opts: { maxSlides: number; timeoutMs: number; maxBytes: number; dispatcher?: Dispatcher }
): Promise<InstagramEmbedFetchOutcome> {
  const empty = (http_ok: boolean): InstagramEmbedFetchOutcome => ({
    urls: [],
    http_ok,
    html_bytes: 0,
    html_contains_display_url: false,
    html_has_embed_media_signals: false,
    html_has_cdninstagram_host: false,
    login_wall_likely: false,
  });

  const shortcode = extractInstagramPermalinkShortcode(postUrl);
  if (!shortcode) return empty(false);

  const urlsToTry = instagramPermalinkEmbedFetchUrls(postUrl, shortcode);
  let acc: InstagramEmbedFetchOutcome | null = null;
  for (const embedPageUrl of urlsToTry) {
    const one = await fetchOneInstagramEmbedPage(embedPageUrl, opts);
    acc = acc == null ? one : mergeInstagramEmbedFetchOutcomes(acc, one, opts.maxSlides);
    if (acc.http_ok && acc.urls.length >= 2) break;
  }
  return acc ?? empty(false);
}

/** Returns {@link fetchInstagramCarouselUrlsFromEmbedDetailed} `.urls` only. */
export async function fetchInstagramCarouselUrlsFromEmbed(
  postUrl: string,
  opts: { maxSlides: number; timeoutMs: number; maxBytes: number; dispatcher?: Dispatcher }
): Promise<string[]> {
  const o = await fetchInstagramCarouselUrlsFromEmbedDetailed(postUrl, opts);
  return o.urls;
}
