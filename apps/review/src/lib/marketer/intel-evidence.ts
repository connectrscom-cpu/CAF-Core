import {
  isLikelySocialPostPageUrl,
  pickInspectionMediaPreviewUrl,
  pickRenderableThumb,
} from "@/lib/marketer/inspection-media";
import type { IntelEvidenceFilter, IntelEvidencePost, MarketInsight } from "@/lib/marketer/types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function inspectionMediaFromStored(stored: unknown) {
  const im = asRecord(stored);
  if (!im) return null;
  return {
    items: asArray(im.items)
      .map((it) => {
        const o = asRecord(it);
        return o
          ? {
              role: str(o.role),
              public_url: str(o.public_url) || null,
              vision_fetch_url: str(o.vision_fetch_url) || null,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null),
  };
}

function thumbnailForInsightsId(pack: Record<string, unknown> | null, insightsId: string): string | null {
  const derived = asRecord(pack?.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  for (const raw of asArray(vg?.entries)) {
    const entry = asRecord(raw);
    if (!entry || str(entry.insights_id) !== insightsId) continue;
    return pickInspectionMediaPreviewUrl(inspectionMediaFromStored(entry.inspection_media));
  }
  return null;
}

export function resolveThumbnailUrl(row: Record<string, unknown>, pack: Record<string, unknown> | null): string | null {
  const insightsId = str(row.insights_id);
  const candidates = [
    thumbnailForInsightsId(pack, insightsId),
    pickInspectionMediaPreviewUrl(inspectionMediaFromStored(row.stored_inspection_media_json)),
    str(row.evidence_thumbnail_url) || null,
  ];

  return pickRenderableThumb(...candidates);
}

function normalizePostUrl(url: string): string {
  return url.trim().replace(/\/$/, "").split("?")[0]!.toLowerCase();
}

function instagramPostId(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m?.[1]?.toLowerCase() ?? null;
}

function httpUrlsInText(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,);]+$/, ""));
}

/** Best thumbnail for a competitive-landscape brand card. */
export function resolveCompetitorThumbnail(
  brand: {
    handle: string;
    platform: string;
    standoutExample?: string | null;
    examplePostUrl?: string | null;
  },
  posts: IntelEvidencePost[]
): string | null {
  const thumbs: (string | null | undefined)[] = [];
  const platformNeedle = brand.platform.toLowerCase();
  const handleNeedle = brand.handle.replace(/^@/, "").toLowerCase();

  const targetUrls = new Set<string>();
  if (brand.examplePostUrl?.startsWith("http")) targetUrls.add(normalizePostUrl(brand.examplePostUrl));
  if (brand.standoutExample) {
    for (const u of httpUrlsInText(brand.standoutExample)) {
      targetUrls.add(normalizePostUrl(u));
    }
  }
  const targetPostIds = new Set(
    [...targetUrls].map((u) => instagramPostId(u)).filter((x): x is string => Boolean(x))
  );

  for (const p of posts) {
    if (p.platform.toLowerCase() !== platformNeedle) continue;
    const thumb = p.thumbnailUrl;
    if (!thumb) continue;

    if (p.postUrl?.startsWith("http")) {
      const norm = normalizePostUrl(p.postUrl);
      if (targetUrls.has(norm)) {
        thumbs.unshift(thumb);
        continue;
      }
      const pid = instagramPostId(p.postUrl);
      if (pid && targetPostIds.has(pid)) {
        thumbs.unshift(thumb);
        continue;
      }
      if (handleNeedle && norm.includes(`instagram.com/${handleNeedle}`)) {
        thumbs.push(thumb);
        continue;
      }
    }

    const hay = [p.title, p.hookText, p.customLabel1, p.customLabel2, p.customLabel3, p.hashtags]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (handleNeedle && (hay.includes(handleNeedle) || hay.includes(`@${handleNeedle}`))) {
      thumbs.push(thumb);
    }
  }

  return pickRenderableThumb(...thumbs);
}

export function buildEvidenceThumbnailMap(
  rows: Record<string, unknown>[],
  pack: Record<string, unknown> | null
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const insightsId = str(row.insights_id);
    if (!insightsId || map.has(insightsId)) continue;
    map.set(insightsId, resolveThumbnailUrl(row, pack));
  }
  return map;
}

function humanFormat(fmt: string): string {
  if (!fmt || fmt === "unknown") return "Post";
  return fmt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function platformFromKind(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("instagram")) return "Instagram";
  if (k.includes("tiktok")) return "TikTok";
  if (k.includes("facebook")) return "Facebook";
  if (k.includes("youtube")) return "YouTube";
  return kind.replace(/_/g, " ") || "Social";
}

/** Map Core evidence-insight rows into marketer evidence posts. */
export function mapEnrichedRowToEvidencePost(
  row: Record<string, unknown>,
  pack: Record<string, unknown> | null
): IntelEvidencePost | null {
  const insightsId = str(row.insights_id);
  if (!insightsId) return null;
  const hookText = str(row.hook_text) || null;
  const title = hookText || str(row.why_it_worked) || "Research post";
  const postUrl = str(row.evidence_post_url) || str(row.source_url) || null;

  return {
    insightsId,
    title: title.length > 120 ? `${title.slice(0, 118)}…` : title,
    hookText,
    platform: platformFromKind(str(row.evidence_kind)),
    format: humanFormat(
      str(row.evidence_post_format) || str(row.evidence_display_kind) || str(row.evidence_kind)
    ),
    postUrl: postUrl?.startsWith("http") ? postUrl : null,
    thumbnailUrl: resolveThumbnailUrl(row, pack),
    customLabel1: str(row.custom_label_1) || null,
    customLabel2: str(row.custom_label_2) || null,
    customLabel3: str(row.custom_label_3) || null,
    primaryEmotion: str(row.primary_emotion) || null,
    hookType: str(row.hook_type) || null,
    hashtags: str(row.hashtags) || null,
  };
}

function normalizeHashtag(tag: string): string {
  const t = tag.trim().toLowerCase();
  if (!t) return "";
  return t.startsWith("#") ? t : `#${t}`;
}

function postMatchesHashtag(post: IntelEvidencePost, tag: string): boolean {
  const hay = `${post.hashtags ?? ""} ${post.hookText ?? ""} ${post.title}`.toLowerCase();
  const needle = normalizeHashtag(tag);
  return needle ? hay.includes(needle) : false;
}

export function filterEvidencePosts(posts: IntelEvidencePost[], filter: IntelEvidenceFilter): IntelEvidencePost[] {
  switch (filter.kind) {
    case "theme":
      return posts.filter((p) => p.customLabel1?.toLowerCase() === filter.key.toLowerCase());
    case "emotion":
      return posts.filter((p) => p.primaryEmotion?.toLowerCase() === filter.key.toLowerCase());
    case "format":
      return posts.filter(
        (p) =>
          p.format.toLowerCase().replace(/\s+/g, "_") === filter.key.toLowerCase() ||
          p.format.toLowerCase() === filter.key.toLowerCase().replace(/_/g, " ")
      );
    case "hook_type":
      return posts.filter((p) => p.hookType?.toLowerCase() === filter.key.toLowerCase());
    case "hashtag":
      return posts.filter((p) => postMatchesHashtag(p, filter.key));
    case "custom_label": {
      const field =
        filter.slot === 2 ? "customLabel2" : filter.slot === 3 ? "customLabel3" : "customLabel1";
      return posts.filter((p) => (p[field] ?? "").toLowerCase() === filter.key.toLowerCase());
    }
    default:
      return [];
  }
}

export function resolveEvidencePostsForInsight(
  insight: MarketInsight,
  posts: IntelEvidencePost[]
): IntelEvidencePost[] {
  if (insight.sourceInsightIds?.length) {
    const wanted = new Set(insight.sourceInsightIds);
    const matched = posts.filter((p) => wanted.has(p.insightsId));
    if (matched.length) return matched;
  }
  if (insight.evidenceFilter) {
    const matched = filterEvidencePosts(posts, insight.evidenceFilter);
    if (matched.length) return matched;
  }
  if (insight.evidenceUrls?.length) {
    const urls = new Set(insight.evidenceUrls);
    const matched = posts.filter((p) => p.postUrl && urls.has(p.postUrl));
    if (matched.length) return matched;
  }
  return [];
}

export function insightHasInspectableEvidence(insight: MarketInsight, posts: IntelEvidencePost[]): boolean {
  if (resolveEvidencePostsForInsight(insight, posts).length > 0) return true;
  return (
    (insight.evidenceCount ?? 0) > 0 &&
    Boolean(insight.sourceInsightIds?.length || insight.evidenceFilter || insight.evidenceUrls?.length)
  );
}

export function statBucketToInsight(
  bucket: {
    key: string;
    count: number;
    evidence_urls?: string[];
    source_insight_ids?: string[];
    evidenceUrls?: string[];
    sourceInsightIds?: string[];
  },
  filter: IntelEvidenceFilter,
  title?: string
): MarketInsight {
  const urls = (bucket.evidenceUrls ?? bucket.evidence_urls ?? []).filter((u) => u.startsWith("http"));
  const ids = bucket.sourceInsightIds ?? bucket.source_insight_ids ?? [];
  return {
    id: `stat_${filter.kind}_${bucket.key.slice(0, 24)}`,
    category: "winning_pattern",
    title: title ?? bucket.key,
    summary: `${bucket.count} posts in this research brief.`,
    evidenceCount: bucket.count,
    confidence: null,
    evidenceUrls: urls.length ? urls : undefined,
    sourceInsightIds: ids.length ? ids : undefined,
    evidenceFilter: ids.length ? undefined : filter,
  };
}
