/**
 * Human-facing fields for Admin / Review previews (URLs, caption, hashtags).
 */

function firstStr(payload: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = payload[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function joinCaptionsFb(payload: Record<string, unknown>): string {
  const parts = [payload.caption, payload.caption_1, payload.caption_2, payload.caption_3, payload.caption_4]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

export interface EvidenceDisplayFields {
  url: string | null;
  caption: string | null;
  hashtags: string | null;
}

/** Compact text bundle for LLM prompts (bounded). */
export function summarizePayloadForLlm(evidenceKind: string, payload: Record<string, unknown>, maxChars = 3500): string {
  const disp = extractEvidenceDisplayFields(evidenceKind, payload);
  const head = [
    `evidence_kind=${evidenceKind}`,
    disp.url ? `url=${disp.url}` : "",
    disp.caption ? `caption=${disp.caption.slice(0, 2000)}` : "",
    disp.hashtags ? `hashtags=${disp.hashtags.slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = JSON.stringify(payload);
  const rest = raw.length > maxChars ? raw.slice(0, maxChars) + "…" : raw;
  return `${head}\n\npayload_json:\n${rest}`;
}

export function extractEvidenceDisplayFields(
  evidenceKind: string,
  payload: Record<string, unknown>
): EvidenceDisplayFields {
  switch (evidenceKind) {
    case "reddit_post":
      return {
        url: firstStr(payload, ["permalink", "url", "URL"]),
        caption: [firstStr(payload, ["title", "Title"]), firstStr(payload, ["body_text", "body"])].filter(Boolean).join("\n\n") || null,
        hashtags: firstStr(payload, ["extracted_hashtags", "keywords"]) || null,
      };
    case "tiktok_video":
      return {
        url: firstStr(payload, ["url", "URL"]),
        caption: firstStr(payload, ["caption", "Caption"]) || null,
        hashtags: firstStr(payload, ["hashtags", "Hashtags"]) || null,
      };
    case "instagram_post":
      return {
        url: firstStr(payload, ["post_url", "url", "URL"]),
        caption: firstStr(payload, ["caption", "Caption"]) || null,
        hashtags: firstStr(payload, ["hashtags", "Hashtags"]) || null,
      };
    case "facebook_post": {
      const cap = joinCaptionsFb(payload);
      return {
        url: firstStr(payload, ["url", "postUrl", "post_url", "URL"]),
        caption: cap || null,
        hashtags: null,
      };
    }
    case "scraped_page":
      return {
        url: firstStr(payload, ["url", "Url", "URL"]),
        caption: [firstStr(payload, ["title", "Title"]), firstStr(payload, ["main_text", "meta_description"])].filter(Boolean).join("\n\n") || null,
        hashtags: null,
      };
    case "source_registry":
      return {
        url: firstStr(payload, ["Link", "link", "URL", "url", "Facebook URL"]),
        caption: firstStr(payload, ["Topic", "topic", "Name", "name"]) || null,
        hashtags: null,
      };
    default:
      return {
        url: firstStr(payload, ["url", "URL", "Link", "link"]),
        caption: firstStr(payload, ["caption", "title", "Name"]),
        hashtags: firstStr(payload, ["hashtags", "keywords"]),
      };
  }
}
