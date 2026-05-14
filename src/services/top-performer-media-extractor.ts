/**
 * Top-performer Instagram media: thin helpers over {@link normalizeInstagramEvidenceMedia}
 * for diagnostics and admin/debug summaries (keeps carousel bundle imports one-way).
 */

import { maxInstagramCarouselImgIndexFromPayload } from "./inputs-carousel-evidence-bundle.js";
import { normalizeInstagramEvidenceMedia } from "./instagram-media-normalizer.js";

export { extractOrderedInstagramCarouselImageUrls, normalizeInstagramEvidenceMedia } from "./instagram-media-normalizer.js";

export interface InstagramTopPerformerMediaIngestSummary {
  payload_media_assets_found: number;
  carousel_slide_count: number;
  usable_image_count: number;
  usable_video_count: number;
  only_img_index_hint_no_url: boolean;
  no_payload_media_urls: boolean;
  all_urls_rejected_static_assets: boolean;
  source_fields_hit: string[];
}

const STATIC_REJECT = new Set(["static.cdninstagram", "instagram_static_path", "rsrc_bundle"]);

export function summarizeInstagramTopPerformerMediaIngest(payload: Record<string, unknown>): InstagramTopPerformerMediaIngestSummary {
  const n = normalizeInstagramEvidenceMedia(payload);
  const imgHint = maxInstagramCarouselImgIndexFromPayload(payload) >= 2;
  const rej = n.diagnostics.rejected;
  const allStatic =
    n.media_assets.length === 0 &&
    rej.length > 0 &&
    rej.every((r) => r.reason && STATIC_REJECT.has(r.reason));
  return {
    payload_media_assets_found: n.media_assets.length,
    carousel_slide_count: n.diagnostics.carousel_slide_count,
    usable_image_count: n.diagnostics.usable_image_count,
    usable_video_count: n.diagnostics.usable_video_count,
    only_img_index_hint_no_url: imgHint && n.media_assets.length === 0,
    no_payload_media_urls: n.media_assets.length === 0,
    all_urls_rejected_static_assets: allStatic,
    source_fields_hit: n.diagnostics.source_fields_hit,
  };
}
