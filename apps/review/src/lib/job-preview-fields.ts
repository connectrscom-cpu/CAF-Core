import type { ReviewJobDetail } from "./caf-core-client";
import { mediaKindFromAsset } from "./media-url";

/** Common generation_payload / n8n shapes for a deliverable video URL. */
export function pickVideoUrlFromGenerationPayload(p: Record<string, unknown> | null | undefined): string {
  if (!p || typeof p !== "object") return "";
  const tryKeys = (obj: Record<string, unknown>): string => {
    const keys = [
      "video_url_caption",
      "video_url",
      "merged_video_url",
      "final_video_url",
      "heygen_video_url",
      "rendered_video_url",
      "output_video_url",
      "mux_playback_url",
    ];
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const top = tryKeys(p);
  if (top) return top;
  const data = p.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return tryKeys(data as Record<string, unknown>);
  }
  return "";
}

/** preview_url + video_url for TaskViewer / workbench parity with list rows. */
export function previewFieldsFromJob(job: ReviewJobDetail): { preview_url: string; video_url: string } {
  const sorted = [...(job.assets ?? [])]
    .filter((a) => (a.public_url ?? "").trim())
    .sort((a, b) => a.position - b.position);
  const first = sorted[0];
  const fromAssets = (first?.public_url ?? "").trim();
  const payload = job.generation_payload as Record<string, unknown> | undefined;
  const fromPayload = pickVideoUrlFromGenerationPayload(payload);
  const kind = fromAssets ? mediaKindFromAsset(fromAssets, first?.asset_type ?? null) : "unknown";
  const preview_url = fromAssets;
  const video_url =
    fromPayload ||
    (kind === "video" ? fromAssets : "") ||
    (fromAssets && /\.(m3u8|mpd)(\?|#|$)/i.test(fromAssets) ? fromAssets : "");
  return { preview_url, video_url };
}
