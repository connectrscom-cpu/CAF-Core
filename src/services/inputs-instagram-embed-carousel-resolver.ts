/**
 * Best-effort resolution of Instagram **carousel** image URLs by fetching the public `/embed/`
 * HTML for a permalink. Used when ingest has `media_type: Sidecar` (or similar) but no child
 * `display_url` list in `payload_json`.
 *
 * Instagram may return login walls or empty markup from datacenter IPs — treat as optional enrichment.
 *
 * **Important:** embed HTML often includes `og:image` / `twitter:image` pointing at the Instagram **logo**
 * or a single tiny preview — those must not be preferred over JSON `display_url` rows for multi-slide decks.
 */

import { finalizeHttpsImageUrlForOpenAiVision } from "./inputs-image-url-for-analysis.js";

const PERMALINK_SC = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,32})\/?/i;

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

/** CDN paths that are almost always embed chrome, sprites, or profile glyphs — not carousel slides. */
export function isLikelyInstagramEmbedUiAssetUrl(u: string): boolean {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase();
    const path = x.pathname;
    if (host.includes("static.cdninstagram")) return true;
    if (/rsrc\.php/i.test(path)) return true;
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
  html_contains_display_url: boolean;
  login_wall_likely: boolean;
} {
  const head = html.slice(0, 20_000);
  const low = head.toLowerCase();
  return {
    html_contains_display_url: html.includes("display_url"),
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

/**
 * Pull CDN image URLs from embed HTML / embedded JSON (unit-testable; no network).
 * OpenGraph / Twitter meta are **last-resort only** (often the IG logo on `/embed/` pages).
 */
export function extractInstagramCarouselUrlsFromEmbedHtml(html: string, maxSlides: number): string[] {
  if (maxSlides <= 0) return [];
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

  let filtered = primary.filter((u) => !isLikelyInstagramEmbedUiAssetUrl(u));
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
  for (const m of html.matchAll(
    /<meta[^>]+property=["']og:image["'][^>]*content=["'](https:\/\/[^"']+)["']/gi
  )) {
    pushNormalized(metaFallback, metaSeen, m[1]);
  }
  for (const m of html.matchAll(
    /<meta[^>]+content=["'](https:\/\/[^"']+)["'][^>]*property=["']og:image["']/gi
  )) {
    pushNormalized(metaFallback, metaSeen, m[1]);
  }
  for (const m of html.matchAll(/<meta[^>]+name=["']twitter:image["'][^>]*content=["'](https:\/\/[^"']+)["']/gi)) {
    pushNormalized(metaFallback, metaSeen, m[1]);
  }
  const metaOk = metaFallback.filter((u) => !isLikelyInstagramEmbedUiAssetUrl(u));
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
  login_wall_likely: boolean;
}

export async function fetchInstagramCarouselUrlsFromEmbedDetailed(
  postUrl: string,
  opts: { maxSlides: number; timeoutMs: number; maxBytes: number }
): Promise<InstagramEmbedFetchOutcome> {
  const empty = (http_ok: boolean): InstagramEmbedFetchOutcome => ({
    urls: [],
    http_ok,
    html_bytes: 0,
    html_contains_display_url: false,
    login_wall_likely: false,
  });

  const shortcode = extractInstagramPermalinkShortcode(postUrl);
  if (!shortcode) return empty(false);
  const embedUrl = `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(embedUrl, {
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
    });
    if (!res.ok) return empty(false);
    const text = await res.text();
    const html = text.length > opts.maxBytes ? text.slice(0, opts.maxBytes) : text;
    const diag = instagramEmbedHtmlDiagnostics(html);
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, opts.maxSlides);
    return {
      urls,
      http_ok: true,
      html_bytes: html.length,
      html_contains_display_url: diag.html_contains_display_url,
      login_wall_likely: diag.login_wall_likely,
    };
  } catch {
    return empty(false);
  } finally {
    clearTimeout(t);
  }
}

/** Returns {@link fetchInstagramCarouselUrlsFromEmbedDetailed} `.urls` only. */
export async function fetchInstagramCarouselUrlsFromEmbed(
  postUrl: string,
  opts: { maxSlides: number; timeoutMs: number; maxBytes: number }
): Promise<string[]> {
  const o = await fetchInstagramCarouselUrlsFromEmbedDetailed(postUrl, opts);
  return o.urls;
}
