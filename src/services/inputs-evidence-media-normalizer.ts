/**
 * Register pending `evidence_media_assets` rows at evidence ingest (video + thumbnails).
 * Complements Instagram-specific normalization in `instagram-media-normalizer.ts`.
 */

import { parseVideoSourceUrlForArchive } from "./inputs-video-evidence-bundle.js";
import { parseHttpsImageUrlsFromEvidenceCell } from "./inputs-image-url-for-analysis.js";

export interface PendingEvidenceMediaAsset {
  source_url: string;
  source_field: string;
  asset_role: "source_video" | "thumbnail" | "video" | "carousel_slide" | "cover_image" | "unknown";
  media_type: "image" | "video" | "unknown";
  slide_index: number | null;
}

export interface NormalizedEvidenceMediaIngest {
  source_platform: string;
  post_url: string | null;
  post_id: string | null;
  owner_username: string | null;
  media_assets: PendingEvidenceMediaAsset[];
}

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function pushUnique(assets: PendingEvidenceMediaAsset[], row: PendingEvidenceMediaAsset): void {
  if (assets.some((a) => a.source_url === row.source_url && a.asset_role === row.asset_role)) return;
  assets.push(row);
}

function thumbnailFromPayload(payload: Record<string, unknown>): string | null {
  for (const k of ["thumbnail_url", "display_url", "cover_url", "poster_url", "preview_image_url", "og_image"]) {
    const urls = parseHttpsImageUrlsFromEvidenceCell(str(payload[k]), 1);
    if (urls[0]) return urls[0];
  }
  return null;
}

/** TikTok / Facebook / other video evidence kinds (Instagram uses `normalizeInstagramEvidenceMedia`). */
export function normalizeGenericVideoEvidenceMedia(
  evidenceKind: string,
  payload: Record<string, unknown>
): NormalizedEvidenceMediaIngest | null {
  const assets: PendingEvidenceMediaAsset[] = [];
  const videoUrl = parseVideoSourceUrlForArchive(payload);
  const thumb = thumbnailFromPayload(payload);

  if (evidenceKind === "tiktok_video") {
    const postUrl = str(payload.url) || str(payload.webVideoUrl) || str(payload.share_url) || null;
    const postId = str(payload.id) || str(payload.video_id) || null;
    const authorMeta = payload.authorMeta;
    const authorName =
      authorMeta && typeof authorMeta === "object" && !Array.isArray(authorMeta)
        ? str((authorMeta as Record<string, unknown>).name)
        : "";
    const owner = authorName || str(payload.author) || str(payload.username) || null;
    if (videoUrl) {
      pushUnique(assets, {
        source_url: videoUrl,
        source_field: "video_url",
        asset_role: "source_video",
        media_type: "video",
        slide_index: null,
      });
    }
    if (thumb) {
      pushUnique(assets, {
        source_url: thumb,
        source_field: "thumbnail_url",
        asset_role: "thumbnail",
        media_type: "image",
        slide_index: 0,
      });
    }
    if (assets.length === 0) return null;
    return {
      source_platform: "tiktok",
      post_url: postUrl,
      post_id: postId,
      owner_username: owner,
      media_assets: assets,
    };
  }

  if (evidenceKind === "facebook_post") {
    const postUrl = str(payload.url) || str(payload.post_url) || null;
    const postId = str(payload.post_id) || str(payload.id) || null;
    const owner = str(payload.page_name) || str(payload.owner) || null;
    if (videoUrl) {
      pushUnique(assets, {
        source_url: videoUrl,
        source_field: "video_url",
        asset_role: "source_video",
        media_type: "video",
        slide_index: null,
      });
    }
    if (thumb) {
      pushUnique(assets, {
        source_url: thumb,
        source_field: "thumbnail_url",
        asset_role: "thumbnail",
        media_type: "image",
        slide_index: 0,
      });
    }
    if (assets.length === 0) return null;
    return {
      source_platform: "facebook",
      post_url: postUrl,
      post_id: postId,
      owner_username: owner,
      media_assets: assets,
    };
  }

  return null;
}
