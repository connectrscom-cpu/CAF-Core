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

export function finalJobStatusAfterRender(recommendedRoute: string | null): string {
  if (recommendedRoute === "AUTO_PUBLISH") return "APPROVED";
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
