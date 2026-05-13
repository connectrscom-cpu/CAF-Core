/**
 * Admin / API preview rows: who qualifies for top-performer carousel or video passes
 * (same gates as the vision pool, including rows that already have tier insights when rescan is off).
 */

import { instagramPostPermalinkFromPayload } from "./inputs-carousel-evidence-bundle.js";

export interface TopPerformerMediaQualifierPreviewRow {
  row_id: string;
  evidence_kind: string;
  pre_llm_score: number;
  /** Carousel: HTTPS slide count; video: sampled frame URL count */
  media_count: number;
  caption_excerpt: string;
  post_url: string | null;
  /** True when this import already has `top_performer_*` insight for the row and rescan is false */
  already_has_tier_insight: boolean;
}

const PREVIEW_CAP = 200;

export function capAndSortQualifierPreview(rows: TopPerformerMediaQualifierPreviewRow[]): TopPerformerMediaQualifierPreviewRow[] {
  const sorted = [...rows].sort((a, b) => b.pre_llm_score - a.pre_llm_score);
  return sorted.slice(0, PREVIEW_CAP);
}

export function excerptForTopPerformerPreview(payload: Record<string, unknown>, maxChars = 160): string {
  const keys = ["caption", "Caption", "title", "Title", "body_text", "main_text", "video_description", "description"];
  for (const k of keys) {
    const v = payload[k];
    if (v != null) {
      const t = String(v).trim();
      if (t) return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
    }
  }
  return "";
}

export function postUrlForTopPerformerPreview(evidenceKind: string, payload: Record<string, unknown>): string | null {
  if (evidenceKind === "instagram_post") {
    const u = instagramPostPermalinkFromPayload(payload);
    if (u) return u;
  }
  for (const k of ["url", "post_url", "permalink", "link", "postUrl", "shortcode_url"] as const) {
    const v = payload[k];
    if (v != null) {
      const s = String(v).trim();
      if (s.startsWith("http")) return s;
    }
  }
  return null;
}
