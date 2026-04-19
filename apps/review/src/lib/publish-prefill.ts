import type { ReviewJobDetail } from "./caf-core-client";
import {
  pickCaptionFromGenerationPayload,
  pickTitleFromGenerationPayload,
} from "./generation-display-fields";
import { pickVideoUrlFromGenerationPayload } from "./job-preview-fields";
import { isVideoFlow } from "./flow-kind";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Editorial overrides (`final_*_override`) live on the job's latest review row, not in `generation_payload`. */
function latestOverrides(job: ReviewJobDetail): Record<string, unknown> {
  return recordVal(job.latest_overrides_json as Record<string, unknown> | null) ?? {};
}

/** Title for publishing: prefer human override, else the rich generation-payload picker (handles hook_line). */
export function pickTitleFromJob(job: ReviewJobDetail): string {
  const ov = str(latestOverrides(job).final_title_override);
  if (ov) return ov;
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  return pickTitleFromGenerationPayload(gp);
}

/**
 * Caption for publishing: prefer human override, else the rich generation-payload picker
 * (handles video-script JSON: cta_line + on_screen_text + disclaimer_line composition).
 */
export function pickCaptionFromJob(job: ReviewJobDetail): string {
  const ov = str(latestOverrides(job).final_caption_override);
  if (ov) return ov;
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  return pickCaptionFromGenerationPayload(gp);
}

/** Image URLs for carousel n8n (`publish_media_urls`); prefers signed assets, then payload fallbacks. */
export function carouselUrlsFromJob(job: ReviewJobDetail): string[] {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  const sorted = [...(job.assets ?? [])]
    .filter((a) => (a.public_url ?? "").trim())
    .sort((a, b) => a.position - b.position);
  const urls: string[] = [];
  for (const a of sorted) {
    const t = (a.asset_type ?? "").toLowerCase();
    if (t.includes("video")) continue;
    const u = (a.public_url ?? "").trim();
    if (u) urls.push(u);
  }
  if (urls.length > 0) return [...new Set(urls)];

  // Fallback: publish-media URLs baked into the generation payload (can be stale/unsigned).
  if (!gp) return [];
  const j = gp.publish_media_urls_json;
  if (typeof j === "string" && j.trim()) {
    try {
      const a = JSON.parse(j) as unknown;
      if (Array.isArray(a)) {
        return a.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  const pm = gp.publish_media_urls;
  if (typeof pm === "string" && pm.trim()) {
    return pm
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(pm)) {
    return pm.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  }
  return [];
}

/**
 * Video URL for publishing — IG Reels / TikTok / FB video.
 * Order: generation_payload (n8n shapes) → first .mp4-style asset → for video flows, the first asset
 * of any extension (HeyGen / Supabase signed URLs sometimes drop the extension).
 */
export function videoUrlFromJob(job: ReviewJobDetail): string {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  const fromPayload = pickVideoUrlFromGenerationPayload(gp);
  if (fromPayload) return fromPayload;
  const sorted = [...(job.assets ?? [])]
    .filter((a) => (a.public_url ?? "").trim())
    .sort((a, b) => a.position - b.position);
  for (const a of sorted) {
    const t = (a.asset_type ?? "").toLowerCase();
    const u = (a.public_url ?? "").trim();
    if (t.includes("video") || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u)) return u;
  }
  // Video flows with a single asset: trust it as the deliverable even when extension/asset_type is missing.
  if (isVideoFlow(job.flow_type ?? "") && sorted.length > 0) {
    return (sorted[0]!.public_url ?? "").trim();
  }
  return "";
}
