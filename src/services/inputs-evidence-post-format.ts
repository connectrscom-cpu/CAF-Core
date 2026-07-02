/**
 * Structural **post format** for evidence rows (broad insights + downstream context).
 * Derived from `evidence_kind` + `payload_json` only — no vision.
 */
import {
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  instagramCarouselStructuralHintPresent,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";
import { isVideoLikeEvidence, pickPrimaryImageUrlForDeepAnalysis } from "./inputs-image-url-for-analysis.js";

export const EVIDENCE_POST_FORMATS = [
  "video",
  "carousel",
  "single_image",
  "text_native",
  "article_or_page",
  "unknown",
] as const;

export type EvidencePostFormat = (typeof EVIDENCE_POST_FORMATS)[number];

export function isEvidencePostFormat(s: string): s is EvidencePostFormat {
  return (EVIDENCE_POST_FORMATS as readonly string[]).includes(s);
}

/**
 * Coarse format label for LLM grounding and filters.
 * - **video** — short-form / reel-style (TT, IG/FB video flags, reels).
 * - **carousel** — ≥2 static slide image URLs in payload, **or** Instagram structural hints (`img_index≥2`
 *   on a permalink, or `media_type` Sidecar/Carousel) when child CDN URLs were not ingested.
 * - **single_image** — one primary image surface (IG/FB photo, Reddit with image).
 * - **text_native** — Reddit-style text thread without a usable image URL.
 * - **article_or_page** — scraped web page / longform source.
 */
export function deriveEvidencePostFormat(evidenceKind: string, payload: Record<string, unknown>): EvidencePostFormat {
  if (evidenceKind === "tiktok_video") return "video";
  if (evidenceKind === "scraped_page") return "article_or_page";

  if (evidenceKind === "reddit_post") {
    const img = pickPrimaryImageUrlForDeepAnalysis("reddit_post", payload);
    return img ? "single_image" : "text_native";
  }

  if (isVideoLikeEvidence(evidenceKind, payload)) return "video";

  if (parseCarouselSlideUrls(payload, 15).length >= MIN_CAROUSEL_SLIDES_FOR_DEEP) return "carousel";

  if (evidenceKind === "instagram_post" && instagramCarouselStructuralHintPresent(payload)) {
    return "carousel";
  }

  if (evidenceKind === "instagram_post" || evidenceKind === "facebook_post") return "single_image";

  return "unknown";
}

/**
 * Human/API-facing kind for tables and clients. DB `evidence_kind` stays sheet-level
 * (`instagram_post`, …); this splits IG/FB rows into `*_video` / `*_carousel` when the payload says so.
 */
export function deriveEvidenceDisplayKind(evidenceKind: string, payload: Record<string, unknown>): string {
  const k = String(evidenceKind ?? "").trim();
  if (!k) return "unknown";
  const fmt = deriveEvidencePostFormat(k, payload);
  if (k === "instagram_post") {
    if (fmt === "video") return "instagram_video";
    if (fmt === "carousel") return "instagram_carousel";
    return "instagram_post";
  }
  if (k === "facebook_post") {
    if (fmt === "video") return "facebook_video";
    if (fmt === "carousel") return "facebook_carousel";
    return "facebook_post";
  }
  return k;
}
