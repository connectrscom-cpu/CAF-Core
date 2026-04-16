import type { ReviewJobDetail } from "./caf-core-client";
import { pickVideoUrlFromGenerationPayload } from "./job-preview-fields";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pickFromNestedCaptionObjects(root: Record<string, unknown> | null): string {
  if (!root) return "";
  const direct = str(root.caption) || str(root.post_caption) || str(root.description);
  if (direct.trim()) return direct.trim();
  for (const k of ["content", "publish", "publication", "post", "video", "result", "output", "data", "carousel"]) {
    const nest = recordVal(root[k]);
    if (!nest) continue;
    const v = str(nest.caption) || str(nest.post_caption) || str(nest.description);
    if (v.trim()) return v.trim();
  }
  return "";
}

export function pickTitleFromJob(job: ReviewJobDetail): string {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  if (!gp) return "";
  return str(gp.title ?? gp.generated_title ?? gp.hook);
}

export function pickCaptionFromJob(job: ReviewJobDetail): string {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  if (!gp) return "";
  const direct =
    str(gp.caption) ||
    str(gp.generated_caption) ||
    str(gp.post_caption) ||
    str(gp.description) ||
    str(gp.final_caption) ||
    str(gp.final_caption_override);
  if (direct) return direct;

  const generatedOutput = recordVal(gp.generated_output);
  const fromGo = pickFromNestedCaptionObjects(generatedOutput) || str(generatedOutput?.generated_caption);
  if (fromGo) return fromGo;

  const fromCarousel = pickFromNestedCaptionObjects(recordVal(generatedOutput?.carousel));
  if (fromCarousel) return fromCarousel;

  return "";
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
    if (t.includes("video") || /\.(mp4|webm|mov)(\?|#|$)/i.test(u)) return u;
  }
  return "";
}
