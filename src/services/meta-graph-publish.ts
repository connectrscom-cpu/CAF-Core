/**
 * Meta Graph API publishing for Facebook Page + Instagram professional accounts.
 * Reads tokens + ids from caf_core.project_integrations (META_FB / META_IG), with optional per-channel
 * env overrides (CAF_META_FB_PAGE_ACCESS_TOKEN, CAF_META_IG_PAGE_ACCESS_TOKEN; legacy CAF_META_PAGE_ACCESS_TOKEN).
 *
 * Coverage:
 * - Facebook: text /feed; single image /photos; multi-image via unpublished /photos then one /feed with attached_media; video via /{page-id}/videos with file_url.
 * - Instagram: single image, carousel (2–10 images), or Reels-style video URL. Polls container status before media_publish, surfaces Meta error codes (e.g. 2207076).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { getProjectIntegration } from "../repositories/project-integrations.js";
import type { PublicationPlacementRow } from "../repositories/publications.js";
import { createSignedUrlForObjectKey } from "./supabase-storage.js";

const GRAPH = "https://graph.facebook.com";

/**
 * Convert a Supabase `/storage/v1/object/public/{bucket}/{key}` URL into a long-lived signed URL.
 * The `assets` bucket is private — anonymous public URLs return 404 "Bucket not found", which Meta
 * surfaces as the opaque error code 2207076. Signed URLs work because they carry a service-role JWT.
 *
 * Returns the original URL unchanged when:
 *  - URL is not a Supabase public-object URL,
 *  - Supabase client isn't configured (no service-role key),
 *  - signing fails for any reason (we'd rather try and let Meta give the real error).
 */
export async function resignSupabasePublicUrlIfNeeded(
  config: AppConfig,
  url: string,
  ttlSec = 7 * 24 * 3600
): Promise<string> {
  const u = url.trim();
  if (!u) return u;
  // Match `<host>/storage/v1/object/public/<bucket>/<objectKey...>`
  const m = /^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i.exec(u);
  if (!m) return u;
  const bucket = decodeURIComponent(m[2]!);
  const objectKey = m[3]!.split("?")[0]!.split("#")[0]!;
  try {
    const signed = await createSignedUrlForObjectKey(config, bucket, decodeURIComponent(objectKey), ttlSec);
    if ("signedUrl" in signed && signed.signedUrl) return signed.signedUrl;
  } catch {
    /* fall back to original URL */
  }
  return u;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function parseMediaUrls(row: PublicationPlacementRow): string[] {
  const m = row.media_urls_json;
  if (Array.isArray(m)) return m.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return [];
}

/**
 * Pre-flight check on a video URL Meta will fetch server-side. Catches the most common cause of
 * IG "Media upload has failed with error code 2207076" (URL not directly downloadable, wrong
 * Content-Type, or tiny payload). HEAD first, then GET range fallback for storage backends that
 * 405 on HEAD (some Supabase rules / CDNs).
 */
export async function preflightCheckVideoUrl(url: string): Promise<
  | { ok: true; contentType: string | null; contentLength: number | null }
  | { ok: false; error: string }
> {
  const u = url.trim();
  if (!u) return { ok: false, error: "Video URL is empty" };
  if (!/^https:\/\//i.test(u)) {
    return { ok: false, error: `Video URL must be HTTPS for Meta to fetch it: ${u}` };
  }
  try {
    let res = await fetch(u, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      // Some object stores reject HEAD; fall back to a tiny GET range that we abort.
      res = await fetch(u, { method: "GET", headers: { Range: "bytes=0-1" }, redirect: "follow" });
      try {
        await res.body?.cancel();
      } catch {
        /* best-effort */
      }
    }
    if (!res.ok && res.status !== 206) {
      return { ok: false, error: `Video URL not reachable: HTTP ${res.status}` };
    }
    const ct = res.headers.get("content-type");
    const cl = res.headers.get("content-length");
    const len = cl ? Number.parseInt(cl, 10) : null;
    if (ct && !/video\/(mp4|quicktime|x-m4v)/i.test(ct) && !/octet-stream/i.test(ct)) {
      return {
        ok: false,
        error: `Video URL Content-Type is "${ct}" — Meta requires video/mp4 (or video/quicktime). Re-encode to MP4 (H.264 + AAC) or fix the storage Content-Type header.`,
      };
    }
    if (Number.isFinite(len) && len! <= 1024) {
      return { ok: false, error: `Video URL returned only ${len} bytes — file is empty or unreadable.` };
    }
    return { ok: true, contentType: ct, contentLength: Number.isFinite(len) ? (len as number) : null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Video URL fetch failed before sending to Meta: ${msg}` };
  }
}

/**
 * Convert Meta's opaque IG container error string into actionable hints. Meta status text is something
 * like "Error: Media upload has failed with error code 2207076"; we extract the code and append
 * documented causes / fixes for the codes we hit most often (Reels publishing).
 */
export function describeIgContainerError(statusText: string, videoUrl?: string | null): string {
  const raw = (statusText ?? "").trim();
  const m = /error code (\d{3,7})/i.exec(raw);
  const code = m ? m[1]! : null;
  const url = (videoUrl ?? "").trim();
  const lines: string[] = [raw || "Instagram container ERROR"];
  if (code === "2207076" || code === "2207077") {
    lines.push(
      "Meta could not transcode the video. Most common causes (in order):",
      "  1) Meta's fetcher could not download the URL — must be HTTPS, return Content-Type video/mp4, no auth/redirect to HTML. Public Supabase URLs sometimes get rate-limited; retry, or use a signed URL.",
      "  2) Reels spec mismatch — H.264 (Main/High), AAC stereo 44.1/48 kHz, 9:16 aspect ratio, ≤ 60 fps, ≤ 1080×1920, ≤ 15 min, ≤ 100 MB.",
      "  3) Known Meta-side outage — try again in a few minutes, or post on Facebook first and reuse the FB video URL on IG.",
      url ? `  Video URL Meta tried to fetch: ${url}` : ""
    );
  } else if (code === "2207020") {
    lines.push("Code 2207020: invalid `video_url` parameter. Make sure the URL is HTTPS and points directly to the .mp4 bytes.");
  } else if (code === "2207026") {
    lines.push("Code 2207026: video duration too short for Reels (minimum 3 seconds).");
  } else if (code === "2207003") {
    lines.push("Code 2207003: media file size too large or invalid — Reels are capped at 100 MB / 15 minutes.");
  } else if (code) {
    lines.push(`Meta error code ${code} — see https://developers.facebook.com/docs/instagram-platform/reference/error-codes for details.`);
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * Polls the Reels container, then waits 5–10 s extra to let Meta finalise. Some accounts need a brief
 * settle before `media_publish` can succeed even after `status_code=FINISHED`.
 */
async function settleAfterIgContainerReady(ms = 6000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Map Review UI platform names to integration keys. */
export function placementPlatformToMetaIntegrationKey(
  platform: string
): "META_FB" | "META_IG" | null {
  const p = platform.trim().toLowerCase();
  if (p === "facebook" || p === "fb" || p === "meta_fb") return "META_FB";
  if (p === "instagram" || p === "ig" || p === "meta_ig") return "META_IG";
  return null;
}

function tokenFromCredentials(cred: Record<string, unknown> | undefined): string | undefined {
  if (!cred) return undefined;
  return str(cred["access_token"]) ?? str(cred["page_access_token"]);
}

/**
 * Token for one Meta channel only: env override for that integration, else legacy single secret, else DB row.
 */
async function getAccessTokenForMetaIntegration(
  db: Pool,
  projectId: string,
  integrationKey: "META_FB" | "META_IG",
  envTokenForChannel?: string | null,
  envTokenLegacyFallback?: string | null
): Promise<string | null> {
  const fromChannel = str(envTokenForChannel ?? undefined);
  if (fromChannel) return fromChannel;
  const fromLegacy = str(envTokenLegacyFallback ?? undefined);
  if (fromLegacy) return fromLegacy;

  const row = await getProjectIntegration(db, projectId, integrationKey);
  return tokenFromCredentials(row?.credentials_json) ?? null;
}

function fbPageIdFromIntegration(row: Awaited<ReturnType<typeof getProjectIntegration>>): string | undefined {
  if (!row?.is_enabled) return undefined;
  const a = row.account_ids_json as Record<string, unknown>;
  return str(a["fb_page_id"]) ?? str(a["facebook_numeric_id_from_url"]);
}

function igUserIdFromIntegration(row: Awaited<ReturnType<typeof getProjectIntegration>>): string | undefined {
  if (!row?.is_enabled) return undefined;
  const a = row.account_ids_json as Record<string, unknown>;
  return str(a["ig_user_id"]) ?? str(a["instagram_user_id"]);
}

/**
 * Graph Explorer often gives a **user** access token. Page endpoints (`/{page-id}/feed`) require a **Page**
 * token or Meta returns deprecated `publish_actions` errors. `GET /me/accounts` returns per-page tokens.
 */
export function pickPageTokenFromAccountsResponse(
  response: { data?: Array<{ id?: string; access_token?: string }> },
  facebookPageId: string
): string | undefined {
  const want = facebookPageId.trim();
  for (const row of response.data ?? []) {
    if (str(row.id) === want) return str(row.access_token);
  }
  return undefined;
}

/**
 * True when `GET me/accounts` failed because the token is already a **Page** token (that edge exists on User, not Page).
 * Meta formats errors as `(#100) …` — not `#(100)`.
 */
export function graphErrorMeansPageTokenCannotListMeAccounts(msg: string): boolean {
  const m = msg.trim();
  return (
    (/nonexisting field/i.test(m) && /\baccounts\b/i.test(m)) ||
    (/\(#[0-9]+\)/i.test(m) && /Page/i.test(m)) ||
    (/Unsupported get request/i.test(m) &&
      /Object with ID ['"]me['"]|cannot be loaded due to missing permissions|does not support this operation/i.test(
        m
      ))
  );
}

/**
 * Resolves a **Page** access token for `{page-id}/…` Graph calls.
 *
 * Facebook **multi-image** posts use `/{page-id}/photos` with `published=false`; Meta requires a **Page**
 * token for that. A **User** token must be exchanged via `GET /me/accounts` (needs `pages_show_list`).
 * If `rawToken` is already a Page token, `GET /me/accounts` fails (#100 on Page) and we keep `rawToken`.
 */
async function resolveTokenForPageGraphApi(
  rawToken: string,
  facebookPageId: string,
  version: string
): Promise<string> {
  try {
    const r = await graphGet<{ data?: Array<{ id?: string; access_token?: string }> }>(
      `me/accounts?fields=access_token,id`,
      rawToken,
      version
    );
    const rows = r.data ?? [];
    const picked = pickPageTokenFromAccountsResponse(r, facebookPageId);
    if (picked) return picked;

    if (rows.length > 0) {
      const ids = rows.map((x) => str(x.id)).filter(Boolean).join(", ");
      throw new Error(
        `User token can list Facebook Pages [${ids}] but none match configured fb_page_id "${facebookPageId.trim()}". Update project_integrations META_FB account_ids_json.fb_page_id (or META_IG linked_fb_page_id) to a Page id this token manages.`
      );
    }

    throw new Error(
      "GET /me/accounts returned no Pages for this token. Use a User token with pages_show_list + pages_manage_posts (so Core can pick a Page token), or set CAF_META_FB_PAGE_ACCESS_TOKEN / CAF_META_IG_PAGE_ACCESS_TOKEN (or legacy CAF_META_PAGE_ACCESS_TOKEN) / project_integrations META_* credentials_json to the Page access_token for this Page (from Graph GET /me/accounts?fields=id,access_token)."
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Configuration errors from the try block above
    if (
      /User token can list Facebook Pages|GET \/me\/accounts returned no Pages|none match configured fb_page_id/.test(
        msg
      )
    ) {
      throw e instanceof Error ? e : new Error(msg);
    }

    // Page access tokens cannot call `GET /me/accounts` — token is already scoped to the Page.
    // Do not treat a bare "Unsupported get request" as Page-token: some User-token / permission
    // failures can match that and would skip the exchange, leaving a User token for unpublished
    // /{page-id}/photos (Meta then returns #200 "must be posted as the page itself").
    if (graphErrorMeansPageTokenCannotListMeAccounts(msg)) {
      return rawToken;
    }

    const metaAuthDead =
      /session has expired|has expired on|has expired\b/i.test(msg) ||
      /invalid.*access token|access token.*invalid|OAuthException|error validating access token|session is invalid/i.test(
        msg
      );
    if (metaAuthDead) {
      throw new Error(
        "Meta access token expired or invalid while calling GET /me/accounts (needed to obtain the Page access token for your configured fb_page_id). " +
          "Both Facebook and Instagram placements use this step when META_FB or META_IG has a linked Page id. " +
          "Renew: set CAF_META_FB_PAGE_ACCESS_TOKEN and/or CAF_META_IG_PAGE_ACCESS_TOKEN on caf-core (Fly secrets), or legacy CAF_META_PAGE_ACCESS_TOKEN for both, or update project_integrations META_FB / META_IG credentials_json.access_token (long-lived Page token or long-lived User with pages_show_list). " +
          `Graph said: ${msg}`
      );
    }

    throw new Error(
      `Could not derive a Page access token via GET /me/accounts (required for Facebook Page posts and for Instagram when a linked Facebook Page is configured): ${msg}`
    );
  }
}

/** Facebook Page id for Graph, or fallback from META_IG.account_ids_json.linked_fb_page_id (single-row setups). */
async function resolveFbPageId(db: Pool, projectId: string): Promise<string | undefined> {
  const fb = await getProjectIntegration(db, projectId, "META_FB");
  const fromFb = fbPageIdFromIntegration(fb);
  if (fromFb) return fromFb;
  const ig = await getProjectIntegration(db, projectId, "META_IG");
  if (!ig?.is_enabled) return undefined;
  const a = ig.account_ids_json as Record<string, unknown>;
  return str(a["linked_fb_page_id"]) ?? str(a["fb_page_id"]);
}

async function graphGet<T = Record<string, unknown>>(
  path: string,
  token: string,
  version: string
): Promise<T> {
  const u = new URL(`${GRAPH}/${version}/${path.replace(/^\//, "")}`);
  u.searchParams.set("access_token", token);
  const res = await fetch(u.toString(), { method: "GET" });
  const j = (await res.json()) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || (j as { error?: unknown }).error) {
    const errObj = (j as { error?: { message?: string; code?: number; error_user_msg?: string } }).error;
    let msg = (errObj?.message ?? errObj?.error_user_msg ?? res.statusText).trim();
    const code = errObj?.code;
    if (code != null && msg && !/^\(#\d+\)/.test(msg)) {
      msg = `(#${code}) ${msg}`;
    }
    throw new Error(msg || `Graph GET ${res.status}`);
  }
  return j;
}

async function graphPostForm<T = Record<string, unknown>>(
  path: string,
  token: string,
  version: string,
  fields: Record<string, string>
): Promise<T> {
  const u = new URL(`${GRAPH}/${version}/${path.replace(/^\//, "")}`);
  const body = new URLSearchParams();
  body.set("access_token", token);
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) body.set(k, v);
  }
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (j as { error?: unknown }).error) {
    const msg = (j as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg || `Graph POST ${res.status}`);
  }
  return j;
}

async function waitIgContainerReady(
  containerId: string,
  token: string,
  version: string,
  opts: { videoUrl?: string | null; maxAttempts?: number; delayMs?: number } = {}
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 90;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await graphGet<{ status_code?: string; status?: string; error_message?: string }>(
      `${containerId}?fields=status_code,status,error_message`,
      token,
      version
    );
    const code = r.status_code ?? "";
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED" || code === "DELETED") {
      const statusText = (r.status ?? r.error_message ?? "").trim();
      const detailed = describeIgContainerError(statusText, opts.videoUrl ?? null);
      throw new Error(`Instagram container ${code}: ${detailed}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("Instagram media container processing timeout (status_code never reached FINISHED)");
}

/**
 * Graph returns Page post ids as `{pageId}_{storyFbid}`. `permalink.php` must use only the story segment
 * as `story_fbid` (using the full compound id breaks Facebook with "Something went wrong").
 */
export function facebookPostWebPermalink(pageId: string, graphPostId: string): string {
  const raw = graphPostId.trim();
  const page = pageId.trim();
  const m = /^(\d+)_(\d+)$/.exec(raw);
  const idParam = m ? m[1]! : page;
  const storyFbid = m ? m[2]! : raw;
  return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(storyFbid)}&id=${encodeURIComponent(idParam)}`;
}

/** Prefer Graph `permalink` (canonical viewer URL, e.g. photo carousel); else web permalink from post id. */
async function resolveFacebookPostedUrl(
  pageId: string,
  graphPostId: string,
  token: string,
  version: string
): Promise<string | null> {
  if (!graphPostId.trim() || graphPostId === "unknown") return null;
  try {
    const r = await graphGet<{ permalink?: string }>(`${graphPostId}?fields=permalink`, token, version);
    const p = str(r.permalink);
    if (p) return p;
  } catch {
    /* optional */
  }
  return facebookPostWebPermalink(pageId, graphPostId);
}

async function publishFacebookPage(
  pageId: string,
  token: string,
  version: string,
  row: PublicationPlacementRow,
  config: AppConfig
): Promise<{ platform_post_id: string; posted_url: string | null; raw: Record<string, unknown> }> {
  const caption = row.caption_snapshot?.trim() ?? "";
  const title = row.title_snapshot?.trim() ?? "";
  const urls = parseMediaUrls(row);
  const rawVideoUrl = row.video_url_snapshot?.trim() ?? "";
  // Re-sign Supabase private-bucket URLs; Meta cannot fetch /object/public/ on a private bucket.
  const videoUrl = rawVideoUrl ? await resignSupabasePublicUrlIfNeeded(config, rawVideoUrl) : "";

  // Facebook Page video: use /{page-id}/videos with file_url. Meta fetches the URL server-side and
  // returns a video_id; the post becomes visible once Meta finishes transcoding (usually seconds).
  if (row.content_format === "video" && videoUrl) {
    const pre = await preflightCheckVideoUrl(videoUrl);
    if (!pre.ok) {
      throw new Error(`Facebook video pre-flight failed: ${pre.error}`);
    }
    const fields: Record<string, string> = {
      file_url: videoUrl,
      // `description` is the visible caption on Facebook video posts (not `message`).
      description: caption,
      published: "true",
    };
    if (title) fields.title = title;
    const r = await graphPostForm<{ id?: string; post_id?: string }>(
      `${pageId}/videos`,
      token,
      version,
      fields
    );
    const videoId = str(r.id);
    const postId = str(r.post_id) ?? (videoId ? `${pageId}_${videoId}` : "unknown");
    return {
      platform_post_id: postId,
      posted_url:
        postId !== "unknown"
          ? await resolveFacebookPostedUrl(pageId, postId, token, version)
          : null,
      raw: {
        ...r,
        mode: "fb_video",
        video_id: videoId ?? null,
        preflight: { content_type: pre.contentType, content_length: pre.contentLength },
      },
    };
  }

  if (urls.length === 0) {
    const r = await graphPostForm<{ id?: string }>(`${pageId}/feed`, token, version, {
      message: caption || "(no caption)",
      published: "true",
    });
    const postId = str(r.id) ?? "unknown";
    return {
      platform_post_id: postId,
      posted_url: postId !== "unknown" ? await resolveFacebookPostedUrl(pageId, postId, token, version) : null,
      raw: { ...r, mode: "fb_feed_text" },
    };
  }

  // Facebook multi-image: upload each photo as unpublished, then create one feed post attaching them.
  // This keeps a single post_id (good for learning joins) and publishes all images.
  if (urls.length > 1) {
    const mediaFbids: string[] = [];
    for (const u of urls) {
      const up = await graphPostForm<{ id?: string }>(`${pageId}/photos`, token, version, {
        url: u,
        published: "false",
      });
      const fid = str(up.id);
      if (!fid) throw new Error("Facebook photo upload missing id");
      mediaFbids.push(fid);
    }

    const fields: Record<string, string> = {
      message: caption || "(no caption)",
      // Unpublished photo uploads attach to a feed story; without this, Meta can keep the Page post as draft/unpublished.
      published: "true",
    };
    mediaFbids.forEach((fid, i) => {
      fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: fid });
    });

    const r = await graphPostForm<{ id?: string }>(`${pageId}/feed`, token, version, fields);
    const postId = str(r.id) ?? "unknown";
    return {
      platform_post_id: postId,
      posted_url: postId !== "unknown" ? await resolveFacebookPostedUrl(pageId, postId, token, version) : null,
      raw: {
        ...r,
        mode: "fb_feed_attached_media",
        media_fbids: mediaFbids,
        media_urls_used: urls,
      },
    };
  }

  // Single image: post as a photo with caption.
  const first = urls[0]!;
  const photoFields: Record<string, string> = { url: first, published: "true" };
  if (caption) photoFields.caption = caption;
  const r = await graphPostForm<{ id?: string; post_id?: string }>(`${pageId}/photos`, token, version, photoFields);
  const postId = str(r.post_id) ?? str(r.id) ?? "unknown";
  return {
    platform_post_id: postId,
    posted_url: postId !== "unknown" ? await resolveFacebookPostedUrl(pageId, postId, token, version) : null,
    raw: { ...r, mode: "fb_photo", media_urls_used: [first] },
  };
}

async function publishInstagram(
  igUserId: string,
  token: string,
  version: string,
  row: PublicationPlacementRow,
  config: AppConfig
): Promise<{ platform_post_id: string; posted_url: string | null; raw: Record<string, unknown> }> {
  const caption = row.caption_snapshot?.trim() ?? "";
  const title = row.title_snapshot?.trim() ?? "";
  const urls = parseMediaUrls(row);
  const rawVideoUrl = row.video_url_snapshot?.trim() ?? "";
  // Re-sign Supabase private-bucket URLs; Meta cannot fetch /object/public/ on a private bucket
  // (returns "Bucket not found" → IG container errors with code 2207076).
  const videoUrl = rawVideoUrl ? await resignSupabasePublicUrlIfNeeded(config, rawVideoUrl) : "";

  if (row.content_format === "video" && videoUrl) {
    // Catch the most common cause of IG 2207076 (URL not directly downloadable, wrong Content-Type)
    // *before* we burn 30+ seconds polling a doomed container.
    const pre = await preflightCheckVideoUrl(videoUrl);
    if (!pre.ok) {
      throw new Error(`Instagram pre-flight failed: ${pre.error}`);
    }

    const fields: Record<string, string> = {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      // Default Reels to the main feed so they aren't hidden in the Reels-only tab — matches Composer behaviour.
      share_to_feed: "true",
    };
    // Reels have an optional `title` (used internally / on FB cross-posting). IG ignores it for the
    // public caption, but it is harmless and useful for analytics joins.
    if (title) fields.title = title;
    const create = await graphPostForm<{ id?: string }>(`${igUserId}/media`, token, version, fields);
    const cid = str(create.id);
    if (!cid) throw new Error("Instagram Reels container missing id");
    await waitIgContainerReady(cid, token, version, { videoUrl });
    await settleAfterIgContainerReady();
    const pub = await graphPostForm<{ id?: string }>(`${igUserId}/media_publish`, token, version, {
      creation_id: cid,
    });
    const mid = str(pub.id) ?? cid;
    let permalink: string | null = null;
    try {
      const m = await graphGet<{ permalink?: string }>(`${mid}?fields=permalink`, token, version);
      permalink = str(m.permalink) ?? null;
    } catch {
      /* optional */
    }
    return {
      platform_post_id: mid,
      posted_url: permalink,
      raw: {
        ...pub,
        create,
        mode: "ig_reels",
        preflight: { content_type: pre.contentType, content_length: pre.contentLength },
      },
    };
  }

  if (urls.length === 0) {
    throw new Error("Instagram publish needs at least one image URL in media_urls_json or a video_url_snapshot for video");
  }

  if (urls.length === 1) {
    const create = await graphPostForm<{ id?: string }>(`${igUserId}/media`, token, version, {
      image_url: urls[0]!,
      caption,
    });
    const cid = str(create.id);
    if (!cid) throw new Error("Instagram image container missing id");
    await waitIgContainerReady(cid, token, version);
    const pub = await graphPostForm<{ id?: string }>(`${igUserId}/media_publish`, token, version, {
      creation_id: cid,
    });
    const mid = str(pub.id) ?? cid;
    let permalink: string | null = null;
    try {
      const m = await graphGet<{ permalink?: string }>(`${mid}?fields=permalink`, token, version);
      permalink = str(m.permalink) ?? null;
    } catch {
      /* optional */
    }
    return { platform_post_id: mid, posted_url: permalink, raw: { ...pub, create, mode: "ig_single_image" } };
  }

  const childIds: string[] = [];
  for (const u of urls.slice(0, 10)) {
    const c = await graphPostForm<{ id?: string }>(`${igUserId}/media`, token, version, {
      image_url: u,
      is_carousel_item: "true",
    });
    const id = str(c.id);
    if (!id) throw new Error("Instagram carousel child missing id");
    await waitIgContainerReady(id, token, version);
    childIds.push(id);
  }
  const carousel = await graphPostForm<{ id?: string }>(`${igUserId}/media`, token, version, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  const carId = str(carousel.id);
  if (!carId) throw new Error("Instagram carousel container missing id");
  await waitIgContainerReady(carId, token, version);
  const pub = await graphPostForm<{ id?: string }>(`${igUserId}/media_publish`, token, version, {
    creation_id: carId,
  });
  const mid = str(pub.id) ?? carId;
  let permalink: string | null = null;
  try {
    const m = await graphGet<{ permalink?: string }>(`${mid}?fields=permalink`, token, version);
    permalink = str(m.permalink) ?? null;
  } catch {
    /* optional */
  }
  return {
    platform_post_id: mid,
    posted_url: permalink,
    raw: { ...pub, carousel_create: carousel, mode: "ig_carousel", child_count: childIds.length },
  };
}

export type MetaPublishResult =
  | {
      ok: true;
      platform_post_id: string;
      posted_url: string | null;
      result_json: Record<string, unknown>;
    }
  | { ok: false; error: string };

/**
 * Publishes a publication placement row via Meta Graph using project integration rows.
 */
export async function publishPlacementToMeta(
  db: Pool,
  placement: PublicationPlacementRow,
  projectId: string,
  graphApiVersion: string,
  config: AppConfig,
  opts?: {
    fbPageAccessTokenFromEnv?: string | null;
    igPageAccessTokenFromEnv?: string | null;
    /** If platform-specific env is unset, used for that platform (legacy single Fly secret). */
    metaPageAccessTokenLegacyFromEnv?: string | null;
  }
): Promise<MetaPublishResult> {
  const key = placementPlatformToMetaIntegrationKey(placement.platform);
  if (!key) {
    return { ok: false, error: `Unsupported platform for Meta executor: ${placement.platform}` };
  }

  const rawToken = await getAccessTokenForMetaIntegration(
    db,
    projectId,
    key,
    key === "META_FB" ? opts?.fbPageAccessTokenFromEnv : opts?.igPageAccessTokenFromEnv,
    opts?.metaPageAccessTokenLegacyFromEnv
  );
  if (!rawToken) {
    return {
      ok: false,
      error:
        key === "META_FB"
          ? "Missing Facebook access token: set CAF_META_FB_PAGE_ACCESS_TOKEN (or legacy CAF_META_PAGE_ACCESS_TOKEN) on caf-core, or META_FB credentials_json.access_token in project_integrations."
          : "Missing Instagram access token: set CAF_META_IG_PAGE_ACCESS_TOKEN (or legacy CAF_META_PAGE_ACCESS_TOKEN) on caf-core, or META_IG credentials_json.access_token in project_integrations.",
    };
  }

  const v = graphApiVersion.trim().startsWith("v") ? graphApiVersion.trim() : `v${graphApiVersion.trim()}`;

  const facebookPageId = await resolveFbPageId(db, projectId);

  try {
    const token =
      facebookPageId && facebookPageId.length > 0
        ? await resolveTokenForPageGraphApi(rawToken, facebookPageId, v)
        : rawToken;

    if (key === "META_FB") {
      const pageId = facebookPageId;
      if (!pageId) {
        return {
          ok: false,
          error:
            "META_FB missing account_ids_json.fb_page_id (or set META_IG.account_ids_json.linked_fb_page_id for the same Page)",
        };
      }
      const out = await publishFacebookPage(pageId, token, v, placement, config);
      return {
        ok: true,
        platform_post_id: out.platform_post_id,
        posted_url: out.posted_url,
        result_json: { graph: "facebook", ...out.raw },
      };
    }

    const integ = await getProjectIntegration(db, projectId, "META_IG");
    const igUserId = igUserIdFromIntegration(integ);
    if (!igUserId) {
      return { ok: false, error: "META_IG integration missing account_ids_json.ig_user_id" };
    }
    const out = await publishInstagram(igUserId, token, v, placement, config);
    return {
      ok: true,
      platform_post_id: out.platform_post_id,
      posted_url: out.posted_url,
      result_json: { graph: "instagram", ...out.raw },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let tokenHint = "";
    if (/publish_actions|deprecated.*sharing/i.test(msg)) {
      tokenHint =
        " Ensure CAF_META_FB_PAGE_ACCESS_TOKEN (Facebook) is a user token with pages_show_list (so Core can call GET /me/accounts) or paste the Page access_token for your fb_page_id. App needs pages_manage_posts, not publish_actions.";
    } else if (/Unpublished posts must be posted to a page as the page itself/i.test(msg)) {
      tokenHint =
        " Facebook multi-image uses unpublished /{page-id}/photos uploads, which require a **Page** access token (not a plain User token). Use GET /me/accounts?fields=id,access_token with a User token that has pages_show_list, copy the Page access_token for your fb_page_id into CAF_META_FB_PAGE_ACCESS_TOKEN (or META_FB credentials_json), or fix fb_page_id so it matches a Page returned by /me/accounts.";
    } else if (
      /expired|invalid.*session|invalid oauth|OAuthException|invalid.*access token|error validating access token|Session has expired|Meta access token expired/i.test(
        msg
      )
    ) {
      tokenHint =
        " Regenerate long-lived tokens. Fly: CAF_META_FB_PAGE_ACCESS_TOKEN and CAF_META_IG_PAGE_ACCESS_TOKEN (or legacy CAF_META_PAGE_ACCESS_TOKEN for both), or META_FB / META_IG credentials_json.access_token in the DB.";
    }
    return { ok: false, error: msg + tokenHint };
  }
}
