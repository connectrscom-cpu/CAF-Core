import type { ReviewJobDetail } from "./caf-core-client";
import { pickVideoUrlFromGenerationPayload } from "./job-preview-fields";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function pickTitleFromJob(job: ReviewJobDetail): string {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  if (!gp) return "";
  return str(gp.title ?? gp.generated_title ?? gp.hook);
}

export function pickCaptionFromJob(job: ReviewJobDetail): string {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
  if (!gp) return "";
  const c = gp.caption ?? gp.post_caption ?? gp.description;
  return str(c);
}

/** Image URLs for carousel n8n (`publish_media_urls`); prefers approved merge, then assets. */
export function carouselUrlsFromJob(job: ReviewJobDetail): string[] {
  const gp = job.generation_payload as Record<string, unknown> | undefined;
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
  return [...new Set(urls)];
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
