/**
 * Operator-facing read model for `caf_core.inputs_evidence_rows` (no raw payload as primary UX).
 */
import { extractEvidenceDisplayFields } from "../services/inputs-evidence-display.js";
import { deriveEvidenceDisplayKind, deriveEvidencePostFormat } from "../services/inputs-evidence-post-format.js";

export interface EvidenceMetricsReadModel {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  engagement_rate: number | null;
}

export interface EvidenceReadModelItem {
  id: string;
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id: string | null;
  run_id: string | null;
  source_type: string;
  platform: string;
  source_url: string | null;
  thumbnail_url: string | null;
  media_urls: string[];
  creator: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string[] | null;
  format: string;
  metrics: EvidenceMetricsReadModel;
  rating_score: number | null;
  scraped_at: string | null;
  created_at: string;
  raw_ref: { table: string; column: string };
}

function numFromPayload(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = payload[k];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = parseFloat(String(v).replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstLine(text: string | null, maxLen = 280): string | null {
  if (!text?.trim()) return null;
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!line) return null;
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

/** Map `evidence_kind` (DB) to a short platform slug for filters and UX. */
export function platformSlugFromEvidenceKind(evidenceKind: string): string {
  const k = String(evidenceKind ?? "").trim();
  if (k === "instagram_post") return "instagram";
  if (k === "tiktok_video") return "tiktok";
  if (k === "reddit_post") return "reddit";
  if (k === "facebook_post") return "facebook";
  if (k === "scraped_page" || k === "html_summary") return "web";
  if (k === "source_registry" || k === "reference_pool") return "sources";
  return k.replace(/_post$/, "").replace(/_video$/, "") || "unknown";
}

/** Resolve `platform` query (instagram, …) to exact `evidence_kind` when unambiguous. */
export function evidenceKindFromPlatformQuery(platform: string | null | undefined): string | null {
  const p = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (!p) return null;
  const map: Record<string, string> = {
    instagram: "instagram_post",
    ig: "instagram_post",
    tiktok: "tiktok_video",
    tt: "tiktok_video",
    reddit: "reddit_post",
    rdt: "reddit_post",
    facebook: "facebook_post",
    fb: "facebook_post",
    web: "scraped_page",
  };
  return map[p] ?? null;
}

export function extractEngagementMetrics(evidenceKind: string, payload: Record<string, unknown>): EvidenceMetricsReadModel {
  const k = String(evidenceKind ?? "");
  let likes: number | null = null;
  let comments: number | null = null;
  let shares: number | null = null;
  let saves: number | null = null;
  let views: number | null = null;
  let engagement_rate: number | null = null;

  if (k === "instagram_post") {
    likes = numFromPayload(payload, ["likesCount", "likes", "like_count", "Like count"]);
    comments = numFromPayload(payload, ["commentsCount", "comments", "comment_count"]);
    shares = numFromPayload(payload, ["sharesCount", "shares", "share_count"]);
    saves = numFromPayload(payload, ["savesCount", "saves", "save_count"]);
    views = numFromPayload(payload, ["videoViewCount", "views", "view_count", "play_count"]);
  } else if (k === "tiktok_video") {
    likes = numFromPayload(payload, ["diggCount", "likes", "like_count"]);
    comments = numFromPayload(payload, ["commentCount", "comments", "comments_count"]);
    shares = numFromPayload(payload, ["shareCount", "shares"]);
    saves = numFromPayload(payload, ["collectCount", "saves", "save_count"]);
    views = numFromPayload(payload, ["playCount", "views", "video_views"]);
  } else if (k === "reddit_post") {
    likes = numFromPayload(payload, ["score", "upvotes", "Score"]);
    comments = numFromPayload(payload, ["num_comments", "comment_count", "comments"]);
    shares = numFromPayload(payload, ["share_count"]);
    engagement_rate = numFromPayload(payload, ["upvote_ratio", "upRatio"]);
  } else if (k === "facebook_post") {
    likes = numFromPayload(payload, ["fb_likes", "likes", "like_count", "reactions_count"]);
    comments = numFromPayload(payload, ["fb_comments", "comments", "comment_count"]);
    shares = numFromPayload(payload, ["fb_shares", "shares", "share_count"]);
    views = numFromPayload(payload, ["fb_views", "views", "video_views"]);
  } else {
    likes = numFromPayload(payload, ["likes", "likesCount", "like_count", "fb_likes", "diggCount", "score"]);
    comments = numFromPayload(payload, ["comments", "commentsCount", "comment_count", "fb_comments", "num_comments"]);
    shares = numFromPayload(payload, ["shares", "sharesCount", "share_count", "fb_shares"]);
    saves = numFromPayload(payload, ["saves", "savesCount", "save_count", "collectCount"]);
    views = numFromPayload(payload, ["views", "view_count", "playCount", "video_views", "videoViewCount"]);
    engagement_rate = numFromPayload(payload, ["engagement_rate", "engagementRate", "upvote_ratio"]);
  }

  return { likes, comments, shares, saves, views, engagement_rate };
}

function extractCreator(evidenceKind: string, payload: Record<string, unknown>): string | null {
  const k = String(evidenceKind ?? "");
  if (k === "instagram_post") {
    const h =
      String(payload.account_handle ?? payload.owner_username ?? payload.username ?? "").trim() ||
      String(payload.account_name ?? payload.fullName ?? "").trim();
    return h || null;
  }
  if (k === "tiktok_video") {
    const h = String(payload.authorHandle ?? payload.author_name ?? "").trim();
    return h || null;
  }
  if (k === "reddit_post") {
    const a = String(payload.author ?? payload.author_username ?? "").trim();
    const sub = String(payload.subreddit ?? "").trim();
    if (a && sub) return `u/${a} · r/${sub}`;
    return a || sub || null;
  }
  if (k === "facebook_post") {
    return String(payload.page_name ?? payload.pageName ?? payload.author ?? "").trim() || null;
  }
  return (
    String(payload.author ?? payload.owner ?? payload.sourceName ?? payload.Name ?? payload.name ?? "").trim() || null
  );
}

function extractScrapedAt(payload: Record<string, unknown>): string | null {
  const keys = [
    "scraped_at",
    "scrapedAt",
    "datePosted",
    "posted_at",
    "postedAt",
    "created_utc",
    "timestamp",
    "takePublishedAt",
  ];
  for (const key of keys) {
    const v = payload[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

export function buildEvidenceReadModelItem(input: {
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id: string | null;
  run_id: string | null;
  id: string;
  evidence_kind: string;
  payload_json: Record<string, unknown>;
  created_at: string;
  rating_score: string | number | null;
  thumbnail_url: string | null;
  media_urls: string[];
}): EvidenceReadModelItem {
  const payload = input.payload_json ?? {};
  const disp = extractEvidenceDisplayFields(input.evidence_kind, payload);
  const fmt = deriveEvidencePostFormat(input.evidence_kind, payload);
  const displayKind = deriveEvidenceDisplayKind(input.evidence_kind, payload);
  const metrics = extractEngagementMetrics(input.evidence_kind, payload);
  const rs =
    input.rating_score == null || input.rating_score === ""
      ? null
      : typeof input.rating_score === "number"
        ? input.rating_score
        : parseFloat(String(input.rating_score));
  const rating_score = rs != null && Number.isFinite(rs) ? rs : null;

  const thumb =
    input.thumbnail_url ||
    (Array.isArray(input.media_urls) ? input.media_urls.find((u) => typeof u === "string" && u.trim()) ?? null : null);

  return {
    id: input.id,
    project_slug: input.project_slug,
    inputs_import_id: input.inputs_import_id,
    signal_pack_id: input.signal_pack_id,
    run_id: input.run_id,
    source_type: displayKind,
    platform: platformSlugFromEvidenceKind(input.evidence_kind),
    source_url: disp.url,
    thumbnail_url: thumb,
    media_urls: [...new Set((input.media_urls ?? []).filter((u) => typeof u === "string" && u.trim()))].slice(0, 12),
    creator: extractCreator(input.evidence_kind, payload),
    hook: firstLine(disp.caption),
    caption: disp.caption,
    hashtags: disp.hashtags
      ? disp.hashtags
          .split(/[\s,#]+/)
          .map((t) => t.trim().replace(/^#+/, ""))
          .filter(Boolean)
          .slice(0, 80)
      : null,
    format: fmt,
    metrics,
    rating_score,
    scraped_at: extractScrapedAt(payload),
    created_at: input.created_at,
    raw_ref: { table: "caf_core.inputs_evidence_rows", column: "payload_json" },
  };
}
