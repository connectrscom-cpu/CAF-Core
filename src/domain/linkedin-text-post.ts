/**
 * `generation_payload.linkedin_text_post_v1` — LinkedIn copy-only post (no companion images).
 */
export const LINKEDIN_TEXT_POST_V1_KEY = "linkedin_text_post_v1";

export interface LinkedInTextPostV1 {
  post_text: string;
  hashtags?: string[];
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
    return [...new Set(v.map((x) => str(x).replace(/^#+/, "")).filter(Boolean))].slice(0, 3);
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
  ].slice(0, 3);
}

export function pickLinkedInTextPostV1(
  payload: Record<string, unknown> | null | undefined
): LinkedInTextPostV1 | null {
  const raw = asRecord(payload?.[LINKEDIN_TEXT_POST_V1_KEY]);
  if (!raw) return null;
  const post_text = str(raw.post_text);
  if (!post_text) return null;
  return { post_text, hashtags: hashtagsFromUnknown(raw.hashtags) };
}

export function buildLinkedInTextPostV1FromGenerated(generated: Record<string, unknown>): LinkedInTextPostV1 {
  const post_text =
    str(generated.post_text) ||
    str(generated.linkedin_post_text) ||
    str(generated.caption) ||
    str(generated.body) ||
    str(generated.text) ||
    [str(generated.hook), str(generated.body_text)].filter(Boolean).join("\n\n");

  return {
    post_text,
    hashtags: hashtagsFromUnknown(generated.hashtags),
  };
}

export function mergeLinkedInTextPostV1(
  payload: Record<string, unknown>,
  slice: LinkedInTextPostV1
): Record<string, unknown> {
  return { ...payload, [LINKEDIN_TEXT_POST_V1_KEY]: slice };
}

export const LINKEDIN_TEXT_POST_LLM_SYSTEM_APPENDIX = `You are writing a **LinkedIn text-only post** (no images, no carousel).

Return valid JSON with:
- "post_text": string — full LinkedIn post (strong first line, short paragraphs, line breaks, soft CTA; professional insight-led tone).
- "hashtags": array of 0–3 tags without # prefix (optional; LinkedIn hashtags are sparse).

Do NOT include companion_images, slides, or image briefs. Do not write Instagram-style caption spam.`;
