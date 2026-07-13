/**
 * LinkedIn REST Posts API — text + up to 3 companion images.
 * Credentials: project_integrations LINKEDIN (access_token, author_urn) or env overrides.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { getProjectIntegration } from "../repositories/project-integrations.js";
import type { PublicationPlacementRow } from "../repositories/publications.js";
import { resignSupabasePublicUrlIfNeeded } from "./meta-graph-publish.js";

const LINKEDIN_REST = "https://api.linkedin.com/rest";
const LINKEDIN_API_VERSION = "202405";

export type LinkedInPublishResult =
  | {
      ok: true;
      platform_post_id: string;
      posted_url: string | null;
      result_json: Record<string, unknown>;
    }
  | { ok: false; error: string };

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function parseMediaUrls(row: PublicationPlacementRow): string[] {
  const m = row.media_urls_json;
  if (Array.isArray(m)) {
    return m.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  }
  return [];
}

async function resolveLinkedInCredentials(
  db: Pool,
  projectId: string,
  config: AppConfig
): Promise<{ accessToken: string; authorUrn: string } | { error: string }> {
  const envToken = str(config.CAF_LINKEDIN_ACCESS_TOKEN);
  const envAuthor = str(config.CAF_LINKEDIN_AUTHOR_URN);
  if (envToken && envAuthor) {
    return { accessToken: envToken, authorUrn: envAuthor };
  }

  const row = await getProjectIntegration(db, projectId, "LINKEDIN");
  if (!row?.is_enabled) {
    return {
      error:
        "LinkedIn integration disabled or missing. Enable LINKEDIN in project_integrations or set CAF_LINKEDIN_ACCESS_TOKEN + CAF_LINKEDIN_AUTHOR_URN.",
    };
  }
  const creds = row.credentials_json ?? {};
  const accessToken = str(creds.access_token) ?? envToken;
  const authorUrn =
    str(creds.author_urn) ??
    str(creds.person_urn) ??
    str((row.account_ids_json ?? {}).author_urn) ??
    envAuthor;
  if (!accessToken || !authorUrn) {
    return {
      error:
        "Missing LinkedIn credentials: set credentials_json.access_token and credentials_json.author_urn (urn:li:person:… or urn:li:organization:…).",
    };
  }
  return { accessToken, authorUrn };
}

async function linkedInJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(`${LINKEDIN_REST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && body !== null && "message" in body
        ? String((body as { message?: unknown }).message ?? text)
        : text || res.statusText;
    return { ok: false, error: `LinkedIn API ${res.status}: ${detail}` };
  }
  return { ok: true, data: body as T };
}

async function initializeImageUpload(
  accessToken: string,
  authorUrn: string
): Promise<{ ok: true; uploadUrl: string; imageUrn: string } | { ok: false; error: string }> {
  const init = await linkedInJson<{
    value?: { uploadUrl?: string; image?: string };
  }>(accessToken, "/images?action=initializeUpload", {
    method: "POST",
    body: JSON.stringify({
      initializeUploadRequest: { owner: authorUrn },
    }),
  });
  if (!init.ok) return init;
  const uploadUrl = str(init.data.value?.uploadUrl);
  const imageUrn = str(init.data.value?.image);
  if (!uploadUrl || !imageUrn) {
    return { ok: false, error: "LinkedIn initializeUpload missing uploadUrl or image URN" };
  }
  return { ok: true, uploadUrl, imageUrn };
}

async function uploadImageBinary(uploadUrl: string, buffer: Buffer, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LinkedIn image upload failed (${res.status}): ${t.slice(0, 400)}`);
  }
}

async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType };
}

function buildCommentary(row: PublicationPlacementRow): string {
  const title = str(row.title_snapshot);
  const caption = str(row.caption_snapshot) ?? "";
  if (title && caption) return `${title}\n\n${caption}`.trim();
  return caption || title || "";
}

export async function publishPlacementToLinkedIn(
  db: Pool,
  placement: PublicationPlacementRow,
  projectId: string,
  config: AppConfig
): Promise<LinkedInPublishResult> {
  const platform = String(placement.platform ?? "").trim().toLowerCase();
  if (!platform.includes("linkedin")) {
    return { ok: false, error: `Unsupported platform for LinkedIn executor: ${placement.platform}` };
  }

  const creds = await resolveLinkedInCredentials(db, projectId, config);
  if ("error" in creds) return { ok: false, error: creds.error };

  const commentary = buildCommentary(placement);
  if (!commentary.trim()) {
    return { ok: false, error: "LinkedIn post requires caption_snapshot or title_snapshot" };
  }

  const mediaUrls = parseMediaUrls(placement).slice(0, 3);
  const imageUrns: string[] = [];

  try {
    for (const rawUrl of mediaUrls) {
      const signed = await resignSupabasePublicUrlIfNeeded(config, rawUrl);
      const { buffer, contentType } = await fetchImageBuffer(signed);
      const init = await initializeImageUpload(creds.accessToken, creds.authorUrn);
      if (!init.ok) return { ok: false, error: init.error };
      await uploadImageBinary(init.uploadUrl, buffer, contentType);
      imageUrns.push(init.imageUrn);
    }

    const postBody: Record<string, unknown> = {
      author: creds.authorUrn,
      commentary,
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      distribution: { feedDistribution: "MAIN_FEED" },
    };

    if (imageUrns.length === 1) {
      postBody.content = { media: { id: imageUrns[0] } };
    } else if (imageUrns.length > 1) {
      postBody.content = {
        multiImage: {
          images: imageUrns.map((id) => ({ id })),
        },
      };
    }

    const created = await linkedInJson<{ id?: string }>(creds.accessToken, "/posts", {
      method: "POST",
      body: JSON.stringify(postBody),
    });
    if (!created.ok) return { ok: false, error: created.error };

    const postId = str(created.data.id) ?? `linkedin_${Date.now()}`;
    return {
      ok: true,
      platform_post_id: postId,
      posted_url: null,
      result_json: {
        executor: "linkedin",
        image_count: imageUrns.length,
        author_urn: creds.authorUrn,
        linkedin_post_id: postId,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
