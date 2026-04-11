/**
 * Post-QC routing (n8n 4.1) and decision-side effects (n8n 4.2 subset — no social publish).
 */
import type { Pool } from "pg";
import { listAssetsByTask } from "../repositories/assets.js";

export type PostQcStopReason = "none" | "discard" | "rework_required";

/** Routes that skip rendering and downstream generation when set after QC. */
export async function routeJobAfterQc(
  db: Pool,
  jobId: string,
  recommendedRoute: string
): Promise<PostQcStopReason> {
  if (recommendedRoute === "DISCARD") {
    await db.query(`UPDATE caf_core.content_jobs SET status = 'REJECTED', updated_at = now() WHERE id = $1`, [jobId]);
    return "discard";
  }
  if (recommendedRoute === "REWORK_REQUIRED") {
    await db.query(`UPDATE caf_core.content_jobs SET status = 'NEEDS_EDIT', updated_at = now() WHERE id = $1`, [jobId]);
    return "rework_required";
  }
  return "none";
}

/**
 * Post-render terminal status: always human review. QC `recommended_route` is usually `HUMAN_REVIEW` when
 * `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` is on (default); Core does not auto-approve from QC alone.
 */
export function finalJobStatusAfterRender(_recommendedRoute: string | null): string {
  return "IN_REVIEW";
}

/** Non-video image URLs for export / downstream (mirrors n8n Build URLS). */
export async function buildCarouselPublishUrls(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<string[]> {
  const assets = await listAssetsByTask(db, projectId, taskId);
  const urls: string[] = [];
  for (const a of assets) {
    const t = (a.asset_type ?? "").toLowerCase();
    if (t.includes("video")) continue;
    let url = a.public_url;
    if (!url && a.bucket && a.object_path) {
      // Caller may use Supabase public URL pattern; storage helper normally sets public_url
      url = null;
    }
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

export async function mergePublishUrlsIntoJob(
  db: Pool,
  projectId: string,
  taskId: string,
  urls: string[]
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now()
     WHERE project_id = $2 AND task_id = $3`,
    [JSON.stringify({ publish_media_urls_json: urls, publish_media_urls: urls.join("\n") }), projectId, taskId]
  );
}

function pickVideoUrlFromPayload(gp: Record<string, unknown> | null | undefined): string {
  if (!gp || typeof gp !== "object") return "";
  const keys = [
    "merged_video_url",
    "final_video_url",
    "heygen_video_url",
    "rendered_video_url",
    "video_url",
    "mux_playback_url",
    "output_video_url",
  ];
  for (const k of keys) {
    const v = gp[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const data = gp.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return pickVideoUrlFromPayload(data as Record<string, unknown>);
  }
  return "";
}

/** Prefer explicit video URLs in payload, else first video-like asset. */
export async function buildVideoPublishUrl(
  db: Pool,
  projectId: string,
  taskId: string,
  generationPayload: Record<string, unknown> | null | undefined
): Promise<string | null> {
  const fromPayload = pickVideoUrlFromPayload(generationPayload ?? null);
  if (fromPayload) return fromPayload;
  const assets = await listAssetsByTask(db, projectId, taskId);
  const sorted = [...assets].sort((a, b) => a.position - b.position);
  for (const a of sorted) {
    const u = (a.public_url ?? "").trim();
    if (!u) continue;
    const t = (a.asset_type ?? "").toLowerCase();
    if (t.includes("video") || /\.(mp4|webm|mov)(\?|#|$)/i.test(u)) return u;
  }
  return null;
}

export async function mergeVideoPublishUrlIntoJob(
  db: Pool,
  projectId: string,
  taskId: string,
  videoUrl: string
): Promise<void> {
  const u = (videoUrl ?? "").trim();
  if (!u) return;
  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now()
     WHERE project_id = $2 AND task_id = $3`,
    [JSON.stringify({ publish_video_url: u, video_url: u }), projectId, taskId]
  );
}
