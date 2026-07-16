/**
 * Transforms Apify / HTTP scraper payloads into INPUTS workbook row shapes.
 * Ported from n8n flows (Instagram, TikTok, Reddit, Facebook, HTML).
 */
import { createHash } from "node:crypto";

const SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
];

const MAX_CELL_LEN = 45_000;

function capString(s: unknown): string {
  if (s === undefined || s === null) return "";
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > MAX_CELL_LEN ? str.slice(0, MAX_CELL_LEN) : str;
}

function safeJson(v: unknown, fallback = "[]"): string {
  if (v === undefined || v === null) return fallback;
  try {
    return capString(JSON.stringify(v));
  } catch {
    return fallback;
  }
}

function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null && x !== "");
  return [v];
}

function isUrl(v: unknown): boolean {
  if (!v || typeof v !== "string") return false;
  return /^https?:\/\/[^\s"'<>]+$/i.test(v.trim());
}

function cleanUrl(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  return isUrl(s) ? s : null;
}

function normalizeUrlArray(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const item of toArray(value)) {
      if (typeof item === "string") {
        const url = cleanUrl(item);
        if (url) out.push(url);
      } else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        for (const key of [
          "displayUrl", "display_url", "imageUrl", "image_url",
          "thumbnailUrl", "thumbnail_url", "videoUrl", "video_url", "url",
        ]) {
          const url = cleanUrl(o[key]);
          if (url) out.push(url);
        }
      }
    }
  }
  return [...new Set(out)];
}

function stripAt(v: unknown): string {
  return String(v ?? "").trim().replace(/^@+/, "");
}

export function normalizeInstagramProfileUrl(row: Record<string, unknown>): string {
  const raw =
    row.instagramUrl ??
    row.instagram_url ??
    row.URL ??
    row.Url ??
    row.url ??
    row.Link ??
    row.link ??
    "";

  let value = String(raw).trim();
  if (!value) {
    const name = stripAt(row.Name ?? row.name ?? row.handle ?? row.username ?? "");
    if (!name) return "";
    value = name;
  }

  if (value.startsWith("@")) {
    value = `https://www.instagram.com/${stripAt(value)}/`;
  }

  if (!/^https?:\/\//i.test(value)) {
    value = value.replace(/^instagram\.com\//i, "");
    value = value.replace(/^www\.instagram\.com\//i, "");
    value = value.replace(/^\/+/, "");
    value = `https://www.instagram.com/${stripAt(value)}/`;
  }

  value = value.split("?")[0].split("#")[0].trim();
  const match = value.match(/instagram\.com\/([^/?#\s]+)/i);
  if (match?.[1]) {
    value = `https://www.instagram.com/${stripAt(match[1])}/`;
  }
  if (!value.endsWith("/")) value += "/";
  return value;
}

export function prepareInstagramSources(
  rows: Record<string, unknown>[]
): Array<Record<string, unknown>> {
  return rows
    .map((row) => {
      const instagramUrl = normalizeInstagramProfileUrl(row);
      const accountHandle =
        stripAt(row.Name ?? row.account_handle ?? row.handle ?? row.username) ||
        instagramUrl.match(/instagram\.com\/([^/?#\s]+)/i)?.[1] ||
        "";
      const skip = row.skip === true || String(row.skip).toLowerCase() === "true";
      return {
        ...row,
        instagramUrl,
        account_handle_src: accountHandle,
        account_id_src: row.account_id ?? row.ownerId ?? row.owner_id ?? null,
        source_name: row.Name ?? row.name ?? accountHandle,
        skip,
      };
    })
    .filter((r) => r.instagramUrl && !r.skip);
}

function extractHashtags(text = ""): string[] {
  const fromText = (text.match(/#[\p{L}\p{N}_]+/gu) || []).map((s) => s.replace("#", "").toLowerCase());
  return [...new Set(fromText)];
}

function extractMentions(text = ""): string[] {
  return [...new Set((text.match(/@[\p{L}\p{N}._]+/gu) || []).map((s) => s.replace("@", "").toLowerCase()))];
}

function detectSigns(text = ""): string[] {
  const t = String(text).toLowerCase();
  const found = SIGNS.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(t));
  const pluralFound = SIGNS.filter((s) => new RegExp(`\\b${s}s\\b`, "i").test(t));
  return [...new Set([...found, ...pluralFound])];
}

function detectCTA(text = ""): string {
  const t = String(text).toLowerCase();
  if (/(comment|drop|tell me|write your|say your|reply|which one)/.test(t)) return "comment";
  if (/(dm|message me|inbox|send me)/.test(t)) return "dm";
  if (/(link in bio|available now|listen|watch|youtube|spotify|download|bio)/.test(t)) return "link";
  if (/(follow|share|save|repost|tag)/.test(t)) return "engage";
  return "";
}

function detectAngle(text = ""): string {
  const t = String(text).toLowerCase();
  if (/(horoscope|forecast|full moon|new moon|retrograde|transit|pluto|neptune|saturn|mercury|venus|mars|moon)/.test(t)) {
    return "horoscope/transits";
  }
  if (/(how to|explained|what is|beginner|lesson|houses|aspects|birth chart|birthchart|learn)/.test(t)) {
    return "education";
  }
  if (/(shop|available now|partner|sponsored|fragrance|amazon|buy|order|book|class|reading)/.test(t)) {
    return "promo";
  }
  if (/(lol|meme|roast|drag|shade|funny|joke)/.test(t)) {
    return "meme/humor";
  }
  return "";
}

function getChildren(p: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["childPosts", "children", "sidecarChildren", "sidecar_children"]) {
    const arr = toArray(p[key]).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    if (arr.length > 0) return arr;
  }
  return [];
}

function buildCarouselSlides(p: Record<string, unknown>): Record<string, unknown>[] {
  const children = getChildren(p);
  const childSlides = children
    .map((child, idx) => {
      const displayUrl = cleanUrl(child.displayUrl ?? child.display_url ?? child.imageUrl ?? child.image_url);
      const videoUrl = cleanUrl(child.videoUrl ?? child.video_url);
      const postUrl = cleanUrl(child.url);
      const url = displayUrl || videoUrl || null;
      if (!url) return null;
      const childType = String(child.type ?? child.mediaType ?? "").toLowerCase();
      const isVideo = !!videoUrl || childType.includes("video");
      return {
        slide_index: idx + 1,
        media_type: isVideo ? "video" : "image",
        url,
        display_url: displayUrl,
        video_url: videoUrl,
        post_url: postUrl,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (childSlides.length > 0) return childSlides;

  const imageUrls = normalizeUrlArray([
    p.images, p.carousel_slide_urls, p.mediaUrls, p.media_urls, p.displayUrl, p.display_url,
  ]);
  return imageUrls.map((url, idx) => ({
    slide_index: idx + 1,
    media_type: "image",
    url,
    display_url: url,
  }));
}

export function transformInstagramApifyPost(
  p: Record<string, unknown>,
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  const caption = String(p.caption ?? "");
  const captionHashtags = extractHashtags(caption);
  const payloadHashtags = Array.isArray(p.hashtags)
    ? p.hashtags.map((h) => String(h).replace("#", "").toLowerCase())
    : [];
  const hashtags = [...new Set([...captionHashtags, ...payloadHashtags])];
  const mentions = [
    ...new Set([
      ...extractMentions(caption),
      ...(Array.isArray(p.mentions)
        ? p.mentions.map((m) => String(m).replace("@", "").toLowerCase())
        : []),
    ]),
  ];
  const signs = detectSigns(caption);
  const children = getChildren(p);
  const carouselSlides = buildCarouselSlides(p);
  const carouselSlideUrls = carouselSlides.map((s) => s.url).filter(Boolean) as string[];
  const videoUrls = normalizeUrlArray([
    p.videoUrl, p.video_url, p.videoUrls, p.video_urls,
    children.map((c) => c.videoUrl ?? c.video_url),
  ]);
  const imageUrls = normalizeUrlArray([
    p.displayUrl, p.display_url, p.imageUrl, p.image_url, p.thumbnailUrl, p.thumbnail_url,
    p.images, p.mediaUrls, p.media_urls,
    carouselSlides.filter((s) => s.media_type === "image").map((s) => s.display_url ?? s.url),
  ]);
  const assetUrls = normalizeUrlArray([imageUrls, videoUrls, carouselSlideUrls]);
  const rawType = String(p.type ?? p.mediaType ?? p.productType ?? "").toLowerCase();
  let mediaType = rawType || "unknown";
  if (children.length > 1 || carouselSlideUrls.length > 1) mediaType = "carousel";
  else if (rawType.includes("sidecar") || rawType.includes("carousel")) mediaType = "carousel";
  else if (rawType.includes("reel") || rawType.includes("clips")) mediaType = "reel";
  else if (rawType.includes("video") || videoUrls.length > 0) mediaType = "video";
  else if (rawType.includes("image") || rawType.includes("photo") || p.displayUrl) mediaType = "image";

  const accountHandle =
    p.ownerUsername ?? (p.owner as Record<string, unknown> | undefined)?.username ?? p.username ??
    context.account_handle_src ?? null;
  const accountId =
    p.ownerId ?? (p.owner as Record<string, unknown> | undefined)?.id ?? context.account_id_src ?? null;
  const postUrl =
    cleanUrl(p.url ?? p.postUrl ?? p.post_url ?? p.permalink) ??
    (p.shortCode || p.shortcode ? `https://www.instagram.com/p/${p.shortCode ?? p.shortcode}/` : null);
  const displayUrl = cleanUrl(p.displayUrl ?? p.display_url ?? p.imageUrl) ?? imageUrls[0] ?? carouselSlideUrls[0] ?? null;
  const postId = p.shortCode ?? p.shortcode ?? p.id ?? null;

  return {
    post_id: postId,
    account_id: accountId,
    account_handle: accountHandle,
    media_type: mediaType,
    caption,
    hashtags: hashtags.length ? hashtags.join(",") : "",
    mentions: mentions.length ? mentions.join(",") : "",
    zodiac_signs_mentioned: signs.length ? signs.join(",") : "",
    cta_type: detectCTA(caption),
    content_angle: detectAngle(caption),
    like_count: p.likesCount === -1 ? null : (p.likesCount ?? null),
    comment_count: p.commentsCount ?? null,
    music_title:
      (p.musicInfo as Record<string, unknown> | undefined)?.title ??
      (p.musicInfo as Record<string, unknown> | undefined)?.song_name ??
      p.audioTitle ??
      null,
    audio_id:
      (p.musicInfo as Record<string, unknown> | undefined)?.audioId ??
      (p.musicInfo as Record<string, unknown> | undefined)?.audio_id ??
      p.audioId ??
      null,
    posted_at: p.timestamp ?? p.takenAt ?? p.createdAt ?? null,
    post_url: postUrl,
    is_carousel: mediaType === "carousel" || carouselSlides.length > 1,
    slide_count: carouselSlides.length,
    asset_url_count: assetUrls.length,
    primary_image_url: displayUrl,
    display_url: displayUrl,
    thumbnail_url: cleanUrl(p.thumbnailUrl ?? p.thumbnail_url) ?? displayUrl,
    image_url: displayUrl,
    video_url: videoUrls[0] ?? cleanUrl(p.videoUrl ?? p.video_url) ?? null,
    carousel_slide_urls: carouselSlideUrls.join("|"),
    carousel_slide_urls_json: safeJson(carouselSlideUrls),
    carousel_slides_json: safeJson(carouselSlides),
    images_json: safeJson(imageUrls),
    media_urls_json: safeJson(assetUrls),
    video_urls_json: safeJson(videoUrls),
    child_posts_json: safeJson(children),
    shortcode: p.shortCode ?? p.shortcode ?? null,
    source_platform: "instagram",
    source_scraper: "apify/instagram-scraper",
    owner_username: accountHandle,
    owner_id: accountId,
    followers_count:
      (p.owner as Record<string, unknown> | undefined)?.followersCount ??
      (p.owner as Record<string, unknown> | undefined)?.followers_count ??
      p.followersCount ??
      p.ownerFollowersCount ??
      null,
    raw_json: safeJson(p, "{}"),
  };
}

export function transformTiktokApifyItem(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.error) return null;
  if (!item.webVideoUrl) return null;
  const hashtags = Array.isArray(item.hashtags)
    ? (item.hashtags as Array<{ name?: string }>)
        .map((h) => h.name)
        .filter(Boolean)
        .join(",")
    : "";
  const author = item.authorMeta as Record<string, unknown> | undefined;
  return {
    recordType: "video",
    videoId: item.id,
    url: item.webVideoUrl,
    caption: item.text ?? "",
    createdAt: item.createTimeISO ?? item.createTime ?? null,
    authorHandle: author?.name ?? null,
    authorFollowers: author?.fans ?? null,
    plays: item.playCount ?? null,
    likes: item.diggCount ?? null,
    comments: item.commentCount ?? null,
    hashtags,
  };
}

export function tiktokProfilesFromSources(rows: Record<string, unknown>[]): string[] {
  const handles: string[] = [];
  for (const row of rows) {
    const link = String(row.Link ?? row.link ?? row.url ?? row.Name ?? row.name ?? "").trim();
    if (!link) continue;
    const m = link.match(/tiktok\.com\/@([^/?#]+)/i);
    if (m?.[1]) handles.push(m[1].replace(/^@/, ""));
    else if (!link.includes("/") && !link.includes(".")) handles.push(link.replace(/^@/, ""));
  }
  return [...new Set(handles.filter(Boolean))];
}

export function buildRedditApifyInput(subredditLinks: string[]): Record<string, unknown> {
  const urls = subredditLinks
    .filter(Boolean)
    .map((u) => u.trim().replace(/\/+$/, ""))
    .map((u) => u.replace(/\/(new|hot|top|rising)(\/.*)?$/i, ""))
    .map((u) => `${u}/top/?t=week`);
  return {
    startUrls: urls.map((url) => ({ url })),
    searchPosts: true,
    searchComments: true,
    searchCommunities: false,
    searchUsers: false,
    maxPostCount: 30,
    maxComments: 3,
    maxItems: 40,
    commentSort: "top",
    scrollTimeout: 60,
    proxy: { useApifyProxy: true },
  };
}

function keywordsFromText(text = "", max = 12): string {
  const stop = new Set([
    "the", "and", "for", "with", "that", "this", "you", "your", "are", "was", "were",
    "have", "has", "had", "but", "not", "from", "they", "their", "them", "his", "her",
    "she", "him", "our", "out", "about", "into", "over", "under", "what", "when", "where",
    "how", "why", "can", "could", "would", "should", "just", "like", "it's", "its", "im",
    "i'm", "we", "us", "to", "of", "in", "on", "at", "as", "is", "it", "a", "an",
  ]);
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) || [])
    .filter((t) => !stop.has(t) && !/^\d+$/.test(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t)
    .join(",");
}

export function transformRedditApifyDataset(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const commentsByPostId = new Map<string, Record<string, unknown>[]>();
  for (const r of items) {
    if (r.dataType === "comment") {
      const key = String(r.postId ?? r.parentId ?? "");
      if (!key) continue;
      if (!commentsByPostId.has(key)) commentsByPostId.set(key, []);
      commentsByPostId.get(key)!.push(r);
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const r of items) {
    if (r.dataType !== "post") continue;
    const postId = r.id ?? null;
    const subreddit =
      r.parsedCommunityName ??
      (String(r.communityName ?? "").startsWith("r/")
        ? String(r.communityName).slice(2)
        : r.communityName) ??
      null;
    const cs = (commentsByPostId.get(String(postId)) || [])
      .slice()
      .sort(
        (a, b) =>
          Number(b.score ?? b.upVotes ?? 0) - Number(a.score ?? a.upVotes ?? 0)
      );
    const top_comment_1 = cs[0]?.body ?? "";
    const top_comment_2 = cs[1]?.body ?? "";
    const top_comment_3 = cs[2]?.body ?? "";
    const title = String(r.title ?? "");
    const body_text = String(r.body ?? "");
    const textForNLP = `${title}\n\n${body_text}\n\n${top_comment_1}\n${top_comment_2}\n${top_comment_3}`.trim();
    const imageUrls = Array.isArray(r.imageUrls) ? r.imageUrls : [];
    const media_url = imageUrls[0] ?? r.link ?? null;
    const media_type =
      imageUrls.length > 1 ? "gallery" :
      imageUrls.length === 1 ? "image" :
      r.isVideo ? "video" :
      r.link ? "link" : "none";
    const permalink = r.url
      ? String(r.url).startsWith("http")
        ? r.url
        : `https://www.reddit.com${r.url}`
      : null;

    out.push({
      post_id: postId,
      source: "reddit",
      subreddit,
      post_type: body_text && !r.link ? "text" : r.link ? "link" : "text",
      title,
      body_text,
      url: r.url ?? null,
      permalink,
      author: r.username ?? null,
      author_flair: r.authorFlairText ?? null,
      is_nsfw: r.over18 === true,
      is_spoiler: false,
      created_utc: r.createdAt ?? null,
      fetched_at: r.scrapedAt ?? new Date().toISOString(),
      score: r.upVotes ?? null,
      upvotes: r.upVotes ?? null,
      upvote_ratio: r.upVoteRatio ?? null,
      comment_count: r.numberOfComments ?? null,
      award_count: null,
      tags_or_flair: r.flair ?? null,
      media_type,
      media_url,
      domain: permalink ? (() => { try { return new URL(String(permalink)).hostname; } catch { return null; } })() : null,
      is_crosspost: false,
      crosspost_parent_id: null,
      is_self: Boolean(body_text && !r.link),
      post_hint: null,
      top_comment_1,
      top_comment_2,
      top_comment_3,
      keywords: keywordsFromText(textForNLP),
      extracted_hashtags: (textForNLP.match(/#[\p{L}\p{N}_]+/gu) || [])
        .map((s) => s.replace("#", "").toLowerCase())
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(","),
      mentioned_entities: "",
      sentiment: "neutral",
      topic_cluster: "",
      notes: "",
    });
  }
  return out;
}

export function transformFacebookApifyPost(
  item: Record<string, unknown>,
  opts?: { minLikes?: number; requireCaption?: boolean }
): Record<string, unknown> | null {
  if (item.error) return null;
  const minLikes = opts?.minLikes ?? 5;
  const requireCaption = opts?.requireCaption !== false;
  const likes = Number(item.likes ?? 0);
  const caption = String(item.text ?? item.caption ?? "").trim();
  if (likes <= minLikes) return null;
  if (requireCaption && !caption) return null;
  const chunks = [caption];
  while (chunks.length < 4 && chunks[chunks.length - 1]!.length > 45_000) {
    const s = chunks.pop()!;
    chunks.push(s.slice(0, 45_000), s.slice(45_000));
  }
  return {
    platform: "facebook",
    inputUrl: item.inputUrl ?? item.url ?? null,
    pageName: item.pageName ?? (item.user as Record<string, unknown> | undefined)?.name ?? null,
    postId: item.postId ?? item.id ?? null,
    postUrl: item.postUrl ?? item.url ?? null,
    postType: item.type ?? null,
    isVideo: item.isVideo ?? false,
    timeISO: item.time ?? item.timestamp ?? null,
    likes,
    comments: item.comments ?? null,
    shares: item.shares ?? null,
    caption: "",
    caption_1: chunks[0] ?? "",
    caption_2: chunks[1] ?? "",
    caption_3: chunks[2] ?? "",
    caption_4: chunks[3] ?? "",
    url: item.url ?? null,
    time: item.time ?? null,
    timestamp: item.timestamp ?? null,
  };
}

function cleanLines(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length >= 30)
    .filter((s, i, a) => a.indexOf(s) === i);
}

export function normalizeLinkedInTargetUrl(row: Record<string, unknown>): string {
  const raw = String(
    row.linkedinUrl ?? row.linkedin_url ?? row.Link ?? row.link ?? row.URL ?? row.url ?? row.Name ?? row.name ?? ""
  ).trim();
  if (!raw) return "";

  let value = raw;
  if (!/^https?:\/\//i.test(value)) {
    const bare = stripAt(value.replace(/^\/+/, ""));
    if (/^company\//i.test(bare) || bare.includes("/company/")) {
      const slug = bare.replace(/^.*company\//i, "").replace(/\/+$/, "");
      value = `https://www.linkedin.com/company/${slug}/`;
    } else {
      const handle = bare.replace(/^.*\/in\//i, "").replace(/\/+$/, "");
      value = `https://www.linkedin.com/in/${handle}/`;
    }
  }

  value = value.split("?")[0].split("#")[0].trim();
  const inMatch = value.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (inMatch?.[1]) return `https://www.linkedin.com/in/${stripAt(inMatch[1])}/`;
  const coMatch = value.match(/linkedin\.com\/company\/([^/?#\s]+)/i);
  if (coMatch?.[1]) return `https://www.linkedin.com/company/${stripAt(coMatch[1])}/`;
  if (/linkedin\.com\/(posts|feed)\//i.test(value)) return value;
  return value.endsWith("/") ? value : `${value}/`;
}

export function linkedinUrlsFromSources(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.map((row) => normalizeLinkedInTargetUrl(row)).filter(Boolean))];
}

export function linkedinSearchQueryFromSource(row: Record<string, unknown>): string {
  return String(row.searchQuery ?? row.SearchQuery ?? row.query ?? row.Name ?? row.name ?? "").trim();
}

export function extractLinkedInProfileUrl(item: Record<string, unknown>): string | null {
  const direct = cleanUrl(item.linkedinUrl ?? item.linkedin_url ?? item.url);
  if (direct && /linkedin\.com\/(in|company)\//i.test(direct)) return direct;
  const id = String(item.publicIdentifier ?? item.public_identifier ?? "").trim();
  if (id) return `https://www.linkedin.com/in/${stripAt(id)}/`;
  return null;
}

function linkedinPostImageUrls(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const img of toArray(item.postImages)) {
    if (typeof img === "string") {
      const u = cleanUrl(img);
      if (u) out.push(u);
    } else if (img && typeof img === "object") {
      const o = img as Record<string, unknown>;
      const u = cleanUrl(o.url ?? o.imageUrl ?? o.image_url);
      if (u) out.push(u);
    }
  }
  const doc = item.document as Record<string, unknown> | undefined;
  if (doc) {
    for (const page of toArray(doc.coverPages)) {
      const p = page as Record<string, unknown>;
      out.push(...normalizeUrlArray([p.imageUrls, p.image_urls]));
    }
  }
  const article = item.article as Record<string, unknown> | undefined;
  if (article) {
    const cover = cleanUrl(article.coverImage ?? article.cover_image ?? article.imageUrl);
    if (cover) out.push(cover);
  }
  return [...new Set(out)];
}

function linkedinMediaType(item: Record<string, unknown>, imageUrls: string[]): string {
  if (item.document && typeof item.document === "object") return "document";
  if (item.article && typeof item.article === "object") return "article";
  const video = item.postVideo ?? item.post_video ?? item.video;
  if (video) return "video";
  if (imageUrls.length > 1) return "multi_image";
  if (imageUrls.length === 1) return "image";
  return "text";
}

export function transformLinkedInApifyPost(
  item: Record<string, unknown>,
  context: Record<string, unknown> = {}
): Record<string, unknown> | null {
  if (item.error) return null;
  const type = String(item.type ?? "post").toLowerCase();
  if (type && type !== "post") return null;

  const postId = String(item.id ?? item.postId ?? item.post_id ?? "").trim();
  const postUrl = String(item.linkedinUrl ?? item.linkedin_url ?? item.postUrl ?? item.post_url ?? "").trim();
  if (!postId && !postUrl) return null;

  const content = String(item.content ?? item.text ?? item.caption ?? "").trim();
  const author = (item.author ?? {}) as Record<string, unknown>;
  const engagement = (item.engagement ?? {}) as Record<string, unknown>;
  const postedAt = (item.postedAt ?? item.posted_at ?? {}) as Record<string, unknown>;
  const imageUrls = linkedinPostImageUrls(item);
  const mediaType = linkedinMediaType(item, imageUrls);
  const hashtags = extractHashtags(content);
  const carouselSlides = imageUrls.map((url, idx) => ({
    slide_index: idx + 1,
    media_type: "image",
    url,
    display_url: url,
  }));
  const doc = item.document as Record<string, unknown> | undefined;

  return {
    platform: "LinkedIn",
    source_platform: "linkedin",
    post_id: postId || null,
    post_url: postUrl || null,
    linkedin_url: postUrl || null,
    url: postUrl || null,
    content,
    caption: content,
    media_type: mediaType,
    image_urls: safeJson(imageUrls),
    image_url: imageUrls[0] ?? null,
    display_url: imageUrls[0] ?? null,
    carousel_slide_urls: safeJson(imageUrls),
    carousel_slides: safeJson(carouselSlides),
    document_title: doc?.title ?? null,
    document_page_count: doc?.totalPageCount ?? doc?.total_page_count ?? null,
    author_name: author.name ?? null,
    author_handle: author.publicIdentifier ?? author.public_identifier ?? null,
    author_url: author.linkedinUrl ?? author.linkedin_url ?? null,
    author_headline: author.info ?? author.headline ?? author.occupation ?? null,
    author_title: author.title ?? author.occupation ?? null,
    author_type: author.type ?? null,
    author_followers:
      author.followerCount ??
      author.followersCount ??
      author.followers ??
      author.follower_count ??
      item.authorFollowers ??
      null,
    author_company: (() => {
      const c = author.companyName ?? author.company ?? null;
      if (c && typeof c === "object" && !Array.isArray(c)) {
        return String((c as Record<string, unknown>).name ?? "").trim() || null;
      }
      return c != null ? String(c).trim() || null : null;
    })(),
    author_location: author.location ?? author.geoLocationName ?? author.addressWithCountry ?? null,
    company_hq: author.companyHeadquarters ?? author.company_hq ?? null,
    author_language: author.language ?? item.language ?? null,
    posted_at: postedAt.date ?? postedAt.timestamp ?? null,
    posted_at_text: postedAt.postedAgoText ?? postedAt.posted_ago_text ?? null,
    like_count: engagement.likes ?? item.likes ?? null,
    likes: engagement.likes ?? item.likes ?? null,
    comment_count: engagement.comments ?? item.comments ?? null,
    comments: engagement.comments ?? item.comments ?? null,
    share_count: engagement.shares ?? item.shares ?? null,
    shares: engagement.shares ?? item.shares ?? null,
    reactions_json: safeJson(engagement.reactions ?? item.reactions ?? []),
    hashtags: hashtags.join(","),
    mentions: extractMentions(content).join(","),
    source_name: context.Name ?? context.name ?? author.name ?? null,
    source_url: context.Link ?? context.link ?? author.linkedinUrl ?? null,
    discovery_source: context.discovery_source ?? null,
    discovery_query: context.discovery_query ?? null,
    seed_profile_url: context.seed_profile_url ?? null,
    fetched_at: new Date().toISOString(),
  };
}

function extractParagraphTexts(html: string, selectorHint: string): string[] {
  const patterns: RegExp[] = [];
  if (selectorHint === "article") {
    patterns.push(/<article[\s\S]*?<\/article>/gi);
  } else if (selectorHint === "main") {
    patterns.push(/<main[\s\S]*?<\/main>/gi);
  } else {
    patterns.push(/<(?:div|section)[^>]*class="[^"]*content[^"]*"[^>]*>[\s\S]*?<\/(?:div|section)>/gi);
  }
  const texts: string[] = [];
  for (const pat of patterns) {
    const blocks = html.match(pat) ?? [];
    for (const block of blocks) {
      const ps = block.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
      for (const p of ps) {
        const inner = p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (inner.length >= 30) texts.push(inner);
      }
    }
  }
  if (texts.length === 0) {
    const ps = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
    for (const p of ps.slice(0, 80)) {
      const inner = p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (inner.length >= 30) texts.push(inner);
    }
  }
  return cleanLines(texts);
}

export function transformHtmlFetch(
  html: string,
  meta: {
    url: string;
    sourceName: string;
    title?: string;
    meta_description?: string;
    maxMainTextChars?: number;
    minParagraphChars?: number;
  }
): Record<string, unknown> {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta.title ?? (titleMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const meta_description = meta.meta_description ?? descMatch?.[1]?.trim() ?? "";

  const minPara = meta.minParagraphChars ?? 30;
  const filterMin = (arr: string[]) => arr.filter((s) => s.length >= minPara);
  const a = filterMin(extractParagraphTexts(html, "article"));
  const b = filterMin(extractParagraphTexts(html, "main"));
  const c = filterMin(extractParagraphTexts(html, "content"));
  const merged = cleanLines([...a, ...b, ...c]);
  const pools = [
    { name: "article", lines: a },
    { name: "main", lines: b },
    { name: "content", lines: c },
    { name: "merged", lines: merged },
  ];
  pools.sort((x, y) => y.lines.reduce((acc, s) => acc + s.length, 0) - x.lines.reduce((acc, s) => acc + s.length, 0));
  const best = pools[0]!;
  const maxChars = meta.maxMainTextChars ?? 30_000;
  const main_text = best.lines.join("\n\n").slice(0, maxChars);
  const content_hash = createHash("sha256").update(main_text).digest("hex");

  return {
    "fetched at": new Date().toISOString(),
    sourceName: meta.sourceName,
    url: meta.url,
    title,
    meta_description,
    main_text,
    extracted_from: best.name,
    content_hash,
  };
}

export function facebookUrlsFromSources(rows: Record<string, unknown>[]): string[] {
  const urls: string[] = [];
  for (const row of rows) {
    let u = String(row["Facebook URL"] ?? row.Link ?? row.link ?? row.url ?? "").trim();
    if (!u) {
      const name = String(row.Name ?? row.name ?? "").trim();
      if (name) u = /^https?:\/\//i.test(name) ? name : `https://www.facebook.com/${name.replace(/^\/+/, "")}`;
    }
    if (u) urls.push(u);
  }
  return [...new Set(urls)];
}

export function subredditLinksFromSources(rows: Record<string, unknown>[]): string[] {
  return [
    ...new Set(
      rows
        .map((r) => {
          const link = String(r.Link ?? r.link ?? "").trim();
          if (link) return link;
          const name = String(r.Name ?? r.name ?? "").trim().replace(/^r\//i, "");
          if (!name) return "";
          return `https://www.reddit.com/r/${name}/`;
        })
        .filter(Boolean)
    ),
  ];
}

export function enabledWebsiteSources(rows: Record<string, unknown>[]): Array<{ url: string; name: string }> {
  return rows
    .filter((r) => {
      const enabled = r.Enabled ?? r.enabled;
      if (enabled === false || String(enabled).toLowerCase() === "false") return false;
      return Boolean(String(r.Link ?? r.link ?? r.Name ?? r.name ?? "").trim());
    })
    .map((r) => {
      let url = String(r.Link ?? r.link ?? "").trim();
      if (!url) {
        const name = String(r.Name ?? r.name ?? "").trim();
        url = /^https?:\/\//i.test(name) ? name : name ? `https://${name}` : "";
      }
      return {
        url,
        name: String(r.Name ?? r.name ?? r.Link ?? "").trim(),
      };
    })
    .filter((r) => r.url);
}
