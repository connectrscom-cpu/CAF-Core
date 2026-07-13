/**
 * `generation_payload.linkedin_document_post_v1` — LinkedIn copy + companion image briefs/assets.
 */
import {
  normalizeLinkedInImageCount,
  parseLinkedInAspectRatio,
  type LinkedInAspectRatio,
} from "./linkedin-document-post-flow-types.js";

export const LINKEDIN_DOCUMENT_POST_V1_KEY = "linkedin_document_post_v1";

export interface LinkedInCompanionImageV1 {
  index: number;
  visual_brief: string;
  alt_text?: string | null;
  asset_id?: string | null;
  public_url?: string | null;
}

export interface LinkedInDocumentPostV1 {
  post_text: string;
  hashtags?: string[];
  aspect_ratio: LinkedInAspectRatio;
  image_count: 2 | 3;
  companion_images: LinkedInCompanionImageV1[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function hashtagsFromUnknown(v: unknown): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.map((x) => str(x).replace(/^#+/, "")).filter(Boolean))].slice(0, 5);
  }
  const s = str(v);
  if (!s) return [];
  return [
    ...new Set(
      s
        .split(/[\s,;#]+/)
        .map((h) => h.replace(/^#+/, ""))
        .filter(Boolean)
    ),
  ].slice(0, 5);
}

export function pickLinkedInDocumentPostV1(
  payload: Record<string, unknown> | null | undefined
): LinkedInDocumentPostV1 | null {
  const raw = asRecord(payload?.[LINKEDIN_DOCUMENT_POST_V1_KEY]);
  if (!raw) return null;
  const post_text = str(raw.post_text);
  if (!post_text) return null;
  const aspect_ratio = parseLinkedInAspectRatio(raw.aspect_ratio);
  const image_count = normalizeLinkedInImageCount(raw.image_count);
  const companionsIn = Array.isArray(raw.companion_images) ? raw.companion_images : [];
  const companion_images: LinkedInCompanionImageV1[] = [];
  for (let i = 0; i < image_count; i++) {
    const row = asRecord(companionsIn[i]) ?? {};
    companion_images.push({
      index: i + 1,
      visual_brief: str(row.visual_brief) || str(row.brief) || str(row.prompt) || `Companion image ${i + 1}`,
      alt_text: str(row.alt_text) || null,
      asset_id: str(row.asset_id) || null,
      public_url: str(row.public_url) || null,
    });
  }
  return {
    post_text,
    hashtags: hashtagsFromUnknown(raw.hashtags),
    aspect_ratio,
    image_count,
    companion_images,
  };
}

/** Build v1 slice from LLM `generated_output` (FLOW_TEXT or custom JSON). */
export function buildLinkedInDocumentPostV1FromGenerated(
  generated: Record<string, unknown>,
  candidateData: Record<string, unknown>
): LinkedInDocumentPostV1 {
  const aspect_ratio = parseLinkedInAspectRatio(
    candidateData.linkedin_aspect_ratio ?? candidateData.aspect_ratio ?? "4:5"
  );
  const image_count = normalizeLinkedInImageCount(
    candidateData.linkedin_image_count ?? candidateData.companion_image_count ?? 3
  );

  const post_text =
    str(generated.post_text) ||
    str(generated.linkedin_post_text) ||
    str(generated.caption) ||
    str(generated.body) ||
    str(generated.text) ||
    [str(generated.hook), str(generated.body_text)].filter(Boolean).join("\n\n");

  const companionsRaw = generated.companion_images ?? generated.images ?? generated.slides;
  const companion_images: LinkedInCompanionImageV1[] = [];
  if (Array.isArray(companionsRaw)) {
    for (let i = 0; i < image_count; i++) {
      const row = asRecord(companionsRaw[i]) ?? {};
      companion_images.push({
        index: i + 1,
        visual_brief:
          str(row.visual_brief) ||
          str(row.visual_prompt) ||
          str(row.image_brief) ||
          str(row.headline) ||
          `Editorial companion visual ${i + 1} supporting the LinkedIn post theme`,
        alt_text: str(row.alt_text) || str(row.alt) || null,
      });
    }
  }
  while (companion_images.length < image_count) {
    const i = companion_images.length;
    companion_images.push({
      index: i + 1,
      visual_brief: `Premium editorial companion image ${i + 1} for LinkedIn — no text in image`,
      alt_text: null,
    });
  }

  return {
    post_text,
    hashtags: hashtagsFromUnknown(generated.hashtags),
    aspect_ratio,
    image_count,
    companion_images: companion_images.slice(0, image_count),
  };
}

export function mergeLinkedInDocumentPostV1(
  payload: Record<string, unknown>,
  slice: LinkedInDocumentPostV1
): Record<string, unknown> {
  return { ...payload, [LINKEDIN_DOCUMENT_POST_V1_KEY]: slice };
}

export const LINKEDIN_DOCUMENT_POST_LLM_SYSTEM_APPENDIX = `You are writing for **LinkedIn** (document-style post + companion images).

Return valid JSON with:
- "post_text": string — full LinkedIn post (hook first line, short paragraphs, line breaks, soft CTA; no hashtag spam).
- "companion_images": array of exactly 2 or 3 objects, each with "visual_brief" (art-only image prompt, ZERO readable text in image) and "alt_text" (accessibility, ≤120 chars).
- "hashtags": array of 0–3 tags without # prefix.

Tone: professional, specific, insight-led. Do not write Instagram carousel slide copy.`;
