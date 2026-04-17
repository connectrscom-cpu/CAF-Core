/**
 * Meta Graph API publishing for Facebook Page + Instagram professional accounts.
 * Reads tokens + ids from caf_core.project_integrations (META_FB / META_IG).
 *
 * Limitations (MVP):
 * - Facebook: text /feed; single image /photos; multi-image via unpublished /photos then one /feed with attached_media (explicit published=true so the post is public).
 * - Instagram: single image, carousel (2–10 images), or Reels-style video URL. Polls container status before media_publish.
 */
import type { Pool } from "pg";
import { getProjectIntegration } from "../repositories/project-integrations.js";
import type { PublicationPlacementRow } from "../repositories/publications.js";

const GRAPH = "https://graph.facebook.com";

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

async function getPageAccessToken(
  db: Pool,
  projectId: string,
  envToken?: string | null
): Promise<string | null> {
  const fromEnv = str(envToken ?? undefined);
  if (fromEnv) return fromEnv;

  const fb = await getProjectIntegration(db, projectId, "META_FB");
  const ig = await getProjectIntegration(db, projectId, "META_IG");
  const t =
    tokenFromCredentials(fb?.credentials_json) ??
    tokenFromCredentials(ig?.credentials_json);
  return t ?? null;
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
      "GET /me/accounts returned no Pages for this token. Use a User token with pages_show_list + pages_manage_posts (so Core can pick a Page token), or set CAF_META_PAGE_ACCESS_TOKEN / META_* credentials_json to the Page access_token for this Page (from Graph GET /me/accounts?fields=id,access_token)."
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
    const looksLikePageTokenCannotListAccounts =
      (/#\(100\)|\(100\)/i.test(msg) && /Page/i.test(msg)) ||
      (/nonexisting field/i.test(msg) && /accounts/i.test(msg) && /Page/i.test(msg)) ||
      (/Unsupported get request/i.test(msg) &&
        /Object with ID ['"]me['"]|cannot be loaded due to missing permissions|does not support this operation/i.test(
          msg
        ));
    if (looksLikePageTokenCannotListAccounts) {
      return rawToken;
    }

    throw new Error(
      `Could not derive a Page access token via GET /me/accounts (required for Facebook, including multi-image / unpublished photo uploads): ${msg}`
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
  const j = (await res.json()) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || (j as { error?: unknown }).error) {
    const msg = (j as { error?: { message?: string } }).error?.message ?? res.statusText;
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
  maxAttempts = 45,
  delayMs = 2000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await graphGet<{ status_code?: string; status?: string }>(
      `${containerId}?fields=status_code,status`,
      token,
      version
    );
    const code = r.status_code ?? "";
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED" || code === "DELETED") {
      throw new Error(`Instagram container ${code}: ${r.status ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("Instagram media container processing timeout");
}

function fbPermalink(pageId: string, postId: string): string {
  return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(postId)}&id=${encodeURIComponent(pageId)}`;
}

async function publishFacebookPage(
  pageId: string,
  token: string,
  version: string,
  row: PublicationPlacementRow
): Promise<{ platform_post_id: string; posted_url: string | null; raw: Record<string, unknown> }> {
  const caption = row.caption_snapshot?.trim() ?? "";
  const urls = parseMediaUrls(row);

  if (urls.length === 0) {
    const r = await graphPostForm<{ id?: string }>(`${pageId}/feed`, token, version, {
      message: caption || "(no caption)",
      published: "true",
    });
    const postId = str(r.id) ?? "unknown";
    return {
      platform_post_id: postId,
      posted_url: postId !== "unknown" ? fbPermalink(pageId, postId) : null,
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
      posted_url: postId !== "unknown" ? fbPermalink(pageId, postId) : null,
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
    posted_url: postId !== "unknown" ? fbPermalink(pageId, postId) : null,
    raw: { ...r, mode: "fb_photo", media_urls_used: [first] },
  };
}

async function publishInstagram(
  igUserId: string,
  token: string,
  version: string,
  row: PublicationPlacementRow
): Promise<{ platform_post_id: string; posted_url: string | null; raw: Record<string, unknown> }> {
  const caption = row.caption_snapshot?.trim() ?? "";
  const urls = parseMediaUrls(row);
  const videoUrl = row.video_url_snapshot?.trim() ?? "";

  if (row.content_format === "video" && videoUrl) {
    const create = await graphPostForm<{ id?: string }>(`${igUserId}/media`, token, version, {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
    });
    const cid = str(create.id);
    if (!cid) throw new Error("Instagram Reels container missing id");
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
    return { platform_post_id: mid, posted_url: permalink, raw: { ...pub, create, mode: "ig_reels" } };
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
  opts?: { pageAccessTokenFromEnv?: string | null }
): Promise<MetaPublishResult> {
  const key = placementPlatformToMetaIntegrationKey(placement.platform);
  if (!key) {
    return { ok: false, error: `Unsupported platform for Meta executor: ${placement.platform}` };
  }

  const rawToken = await getPageAccessToken(db, projectId, opts?.pageAccessTokenFromEnv);
  if (!rawToken) {
    return {
      ok: false,
      error:
        "Missing Page access token: set CAF_META_PAGE_ACCESS_TOKEN in Core .env, or credentials_json.access_token on META_FB / META_IG.",
    };
  }

  const v = graphApiVersion.trim().startsWith("v") ? graphApiVersion.trim() : `v${graphApiVersion.trim()}`;

  const facebookPageId = await resolveFbPageId(db, projectId);
  const token =
    facebookPageId && facebookPageId.length > 0
      ? await resolveTokenForPageGraphApi(rawToken, facebookPageId, v)
      : rawToken;

  try {
    if (key === "META_FB") {
      const pageId = facebookPageId;
      if (!pageId) {
        return {
          ok: false,
          error:
            "META_FB missing account_ids_json.fb_page_id (or set META_IG.account_ids_json.linked_fb_page_id for the same Page)",
        };
      }
      const out = await publishFacebookPage(pageId, token, v, placement);
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
    const out = await publishInstagram(igUserId, token, v, placement);
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
        " Ensure CAF_META_PAGE_ACCESS_TOKEN is a user token with pages_show_list (so Core can call GET /me/accounts) or paste the Page access_token for your fb_page_id from /me/accounts. App needs pages_manage_posts, not publish_actions.";
    } else if (/Unpublished posts must be posted to a page as the page itself/i.test(msg)) {
      tokenHint =
        " Facebook multi-image uses unpublished /{page-id}/photos uploads, which require a **Page** access token (not a plain User token). Use GET /me/accounts?fields=id,access_token with a User token that has pages_show_list, copy the access_token for your fb_page_id into CAF_META_PAGE_ACCESS_TOKEN (or META_FB credentials_json), or fix fb_page_id so it matches a Page returned by /me/accounts.";
    } else if (/expired|invalid.*session|invalid oauth|OAuthException|access token/i.test(msg)) {
      tokenHint =
        " Regenerate a long-lived Page token and set CAF_META_PAGE_ACCESS_TOKEN (Fly secret) or META_FB/META_IG credentials_json.access_token.";
    }
    return { ok: false, error: msg + tokenHint };
  }
}
