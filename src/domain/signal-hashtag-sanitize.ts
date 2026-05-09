/**
 * Signal-pack hashtag leaderboards often include URL/HTML artifacts (#https, #jpeg).
 * Filter before feeding models or enforcing product-flow allowlists.
 */

/** Lowercase bare token (no #) */
export function bareHashtagToken(raw: string): string {
  let t = String(raw ?? "").trim().toLowerCase();
  t = t.replace(/^#+/, "");
  t = t.replace(/[^\p{L}\p{N}_]/gu, "");
  return t;
}

const JUNK_BARE = new Set([
  "https",
  "http",
  "redd",
  "reddit",
  "jpeg",
  "jpg",
  "png",
  "gif",
  "webp",
  "svg",
  "preview",
  "image",
  "images",
  "img",
  "url",
  "uri",
  "link",
  "amp",
  "auto",
  "thumbnail",
  "thumbnails",
  "post",
  "posts",
  "page",
  "com",
  "org",
  "net",
  "www",
  "src",
  "cdn",
  "api",
  "html",
  "css",
  "js",
  "pdf",
  "zip",
]);

/** Single-letter or ultra-generic tokens that hurt discovery when scraped from HTML. */
const SHORT_MAX = 2;

export function isUsableSignalPackHashtag(bare: string): boolean {
  const t = bareHashtagToken(bare);
  if (t.length <= SHORT_MAX) return false;
  if (/^\d+$/.test(t)) return false;
  if (JUNK_BARE.has(t)) return false;
  return true;
}

export function filterSignalPackHashtagCandidates(raw: Iterable<string>, opts?: { max?: number }): string[] {
  const max = opts?.max ?? 48;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const bare = bareHashtagToken(String(x ?? ""));
    if (!bare || !isUsableSignalPackHashtag(bare)) continue;
    if (seen.has(bare)) continue;
    seen.add(bare);
    out.push(bare);
    if (out.length >= max) break;
  }
  return out;
}
