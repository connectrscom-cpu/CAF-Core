/**
 * Follower-normalized engagement signals for pre-LLM evidence scoring.
 * Used when `criteria_json.pre_llm.relative_page_performance` is enabled.
 */

/** Weighted engagement rate at or above this value maps to feature score 1.0. */
export const PAGE_RELATIVE_ER_CAP = 0.12;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function numFromPayload(payload: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = payload[k];
    if (v == null || v === "") continue;
    const parsed = parseFollowerCountValue(v);
    if (parsed != null && parsed > 0) return parsed;
    const n = parseFloat(String(v).replace(/,/g, ""));
    if (!Number.isNaN(n) && Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/** Parse follower counts from numbers or human strings (`12.5k`, `1.2M`, `12,345`). */
export function parseFollowerCountValue(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return null;
  const scaled = s.match(/^(\d+(?:\.\d+)?)\s*([kmb])$/i);
  if (scaled) {
    let n = parseFloat(scaled[1]!);
    const suf = scaled[2]!.toLowerCase();
    if (suf === "k") n *= 1000;
    else if (suf === "m") n *= 1_000_000;
    else if (suf === "b") n *= 1_000_000_000;
    return n > 0 ? Math.floor(n) : null;
  }
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 1) {
    const n = parseInt(digits.slice(0, 14), 10);
    return n > 0 ? n : null;
  }
  return null;
}

function collectPayloadLayers(payload: Record<string, unknown>): Record<string, unknown>[] {
  const layers: Record<string, unknown>[] = [payload];
  for (const key of ["raw_json", "_raw_data", "payload_json"]) {
    const raw = payload[key];
    if (typeof raw === "string") {
      const t = raw.trim();
      if (!t || (!t.startsWith("{") && !t.startsWith("["))) continue;
      try {
        const p = JSON.parse(t) as unknown;
        if (p && typeof p === "object" && !Array.isArray(p)) layers.push(p as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      layers.push(raw as Record<string, unknown>);
    }
  }
  return layers;
}

const FOLLOWER_KEYS_BY_KIND: Record<string, string[]> = {
  instagram_post: [
    "followers_count",
    "follower_count",
    "owner_followers_count",
    "ownerFollowersCount",
    "followersCount",
    "Followers",
    "followers",
  ],
  tiktok_video: [
    "authorFollowers",
    "author_followers",
    "followers",
    "followerCount",
    "followers_count",
    "Followers",
  ],
  facebook_post: ["page_followers", "pageFollowers", "followers_count", "fan_count", "pageFans", "Followers"],
};

const OWNER_FOLLOWER_KEYS = [
  "followersCount",
  "followers_count",
  "followerCount",
  "follower_count",
  "fans",
  "fanCount",
];

/** Extract account/page follower count when present on the evidence payload (incl. nested Apify blobs). */
export function extractFollowerCount(evidenceKind: string, payload: Record<string, unknown>): number | null {
  const keys = FOLLOWER_KEYS_BY_KIND[evidenceKind];
  if (!keys) return null;

  for (const layer of collectPayloadLayers(payload)) {
    for (const k of keys) {
      const parsed = parseFollowerCountValue(layer[k]);
      if (parsed != null && parsed > 0) return parsed;
    }
    const owner = layer.owner;
    if (owner && typeof owner === "object" && !Array.isArray(owner)) {
      const o = owner as Record<string, unknown>;
      for (const k of OWNER_FOLLOWER_KEYS) {
        const parsed = parseFollowerCountValue(o[k]);
        if (parsed != null && parsed > 0) return parsed;
      }
    }
    const authorMeta = layer.authorMeta;
    if (authorMeta && typeof authorMeta === "object" && !Array.isArray(authorMeta)) {
      const a = authorMeta as Record<string, unknown>;
      for (const k of OWNER_FOLLOWER_KEYS) {
        const parsed = parseFollowerCountValue(a[k]);
        if (parsed != null && parsed > 0) return parsed;
      }
    }
  }
  return null;
}

export function normalizeSocialHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

function handleFromInstagramLink(link: string): string | null {
  const m = link.match(/instagram\.com\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  const seg = m[1].toLowerCase();
  if (["p", "reel", "tv", "stories", "explore", "accounts"].includes(seg)) return null;
  return normalizeSocialHandle(seg);
}

function handleFromTiktokLink(link: string): string | null {
  const m = link.match(/tiktok\.com\/@([^/?#]+)/i);
  return m?.[1] ? normalizeSocialHandle(m[1]) : null;
}

/** Account handle on a social post row (for registry join). */
export function extractSocialAccountHandle(
  evidenceKind: string,
  payload: Record<string, unknown>
): string | null {
  if (evidenceKind === "instagram_post") {
    for (const layer of collectPayloadLayers(payload)) {
      for (const k of ["owner_username", "account_handle", "ownerUsername", "username", "accountHandle"]) {
        const v = layer[k];
        if (v != null && String(v).trim()) return normalizeSocialHandle(String(v));
      }
      const owner = layer.owner;
      if (owner && typeof owner === "object" && !Array.isArray(owner)) {
        const u = (owner as Record<string, unknown>).username;
        if (u != null && String(u).trim()) return normalizeSocialHandle(String(u));
      }
    }
  } else if (evidenceKind === "tiktok_video") {
    for (const layer of collectPayloadLayers(payload)) {
      for (const k of ["authorHandle", "author_handle", "authorUsername", "username"]) {
        const v = layer[k];
        if (v != null && String(v).trim()) return normalizeSocialHandle(String(v));
      }
      const author = layer.authorMeta;
      if (author && typeof author === "object" && !Array.isArray(author)) {
        const name = (author as Record<string, unknown>).name;
        if (name != null && String(name).trim()) return normalizeSocialHandle(String(name));
      }
      const url = String(layer.url ?? layer.URL ?? "").trim();
      const fromUrl = url ? handleFromTiktokLink(url) : null;
      if (fromUrl) return fromUrl;
    }
  } else if (evidenceKind === "facebook_post") {
    for (const k of ["page_name", "pageName", "page_id", "pageId"]) {
      const v = payload[k];
      if (v != null && String(v).trim()) return normalizeSocialHandle(String(v));
    }
  }
  return null;
}

/**
 * Map normalized account handle → follower count from `source_registry` rows
 * (IG Accounts / TikTok Accounts tabs in the INPUTS workbook).
 */
export function buildRegistryFollowerLookup(registryRows: Record<string, unknown>[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of registryRows) {
    const followers = parseFollowerCountValue(
      row.Followers ?? row.followers ?? row.Fan_Count ?? row.fan_count ?? row.fans
    );
    if (!followers) continue;

    const link = String(row.Link ?? row.link ?? row.URL ?? row.url ?? row["Facebook URL"] ?? "").trim();
    if (link) {
      const ig = handleFromInstagramLink(link);
      if (ig) map.set(ig, followers);
      const tt = handleFromTiktokLink(link);
      if (tt) map.set(tt, followers);
    }

    const name = String(row.Name ?? row.name ?? "").trim();
    if (name) {
      const h = normalizeSocialHandle(name);
      if (h && !h.includes(" ") && h.length <= 64) map.set(h, followers);
    }
  }
  return map;
}

/**
 * When a post row lacks follower fields, copy from the source-registry lookup by account handle.
 */
export function enrichPayloadFollowerBaseline(
  evidenceKind: string,
  payload: Record<string, unknown>,
  registryLookup?: ReadonlyMap<string, number>
): Record<string, unknown> {
  if (extractFollowerCount(evidenceKind, payload) != null) return payload;
  if (!registryLookup?.size) return payload;

  const handle = extractSocialAccountHandle(evidenceKind, payload);
  if (!handle) return payload;

  const followers = registryLookup.get(handle);
  if (!followers || followers < 1) return payload;

  if (evidenceKind === "tiktok_video") {
    return { ...payload, authorFollowers: followers, followers_count: followers };
  }
  if (evidenceKind === "facebook_post") {
    return { ...payload, page_followers: followers, followers_count: followers };
  }
  return { ...payload, followers_count: followers };
}

export function normPageRelativeEngagementRate(rate: number): number {
  if (rate <= 0) return 0;
  return clamp(rate / PAGE_RELATIVE_ER_CAP, 0, 1);
}

/** Normalize a per-follower ratio (e.g. comment rate) against a cap. */
function normPerFollowerRatio(count: number, followers: number, cap: number): number {
  if (count <= 0 || followers <= 0 || cap <= 0) return 0;
  return clamp(count / followers / cap, 0, 1);
}

/**
 * Add follower-relative features to a pre-LLM feature map.
 * Always sets `has_follower_baseline` (0 or 1) for social post kinds.
 */
export function augmentPreLlmFeaturesWithRelative(
  evidenceKind: string,
  payload: Record<string, unknown>,
  base: Record<string, number>
): Record<string, number> {
  const socialKinds = new Set(["instagram_post", "tiktok_video", "facebook_post"]);
  if (!socialKinds.has(evidenceKind)) return base;

  const followers = extractFollowerCount(evidenceKind, payload);
  if (!followers || followers < 1) {
    return { ...base, has_follower_baseline: 0 };
  }

  const out: Record<string, number> = { ...base, has_follower_baseline: 1 };

  if (evidenceKind === "instagram_post") {
    const likes = numFromPayload(payload, ["like_count", "likes", "likesCount"]);
    const comments = numFromPayload(payload, ["comment_count", "comments", "commentsCount"]);
    const engagement = likes + comments * 2;
    out.page_relative_engagement = normPageRelativeEngagementRate(engagement / followers);
    out.page_relative_comments = normPerFollowerRatio(comments, followers, 0.02);
  } else if (evidenceKind === "facebook_post") {
    const likes = numFromPayload(payload, ["likes", "Likes"]);
    const comments = numFromPayload(payload, ["comments", "Comments"]);
    const shares = numFromPayload(payload, ["shares", "Shares"]);
    const engagement = likes + comments * 2 + shares * 3;
    out.page_relative_engagement = normPageRelativeEngagementRate(engagement / followers);
    out.page_relative_shares = normPerFollowerRatio(shares, followers, 0.01);
  } else if (evidenceKind === "tiktok_video") {
    const likes = numFromPayload(payload, ["likes", "Likes"]);
    const comments = numFromPayload(payload, ["comments", "Comments"]);
    const plays = numFromPayload(payload, ["plays", "Plays"]);
    const engRate = (likes + comments * 2) / followers;
    out.page_relative_engagement = normPageRelativeEngagementRate(engRate);
    // Plays per follower: ~10× audience is a strong reach signal.
    const reachRatio = plays / followers;
    out.page_relative_reach = clamp(Math.log1p(reachRatio) / Math.log1p(10), 0, 1);
  }

  return out;
}
