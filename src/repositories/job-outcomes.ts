import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type JobOutcomeTrackingStatus = "published" | "metrics_present" | "analyzed";

export interface JobOutcomeRow {
  id: string;
  project_id: string;
  task_id: string;
  placement_id: string | null;
  platform: string | null;
  platform_post_id: string | null;
  posted_url: string | null;
  published_at: string | null;
  tracking_status: JobOutcomeTrackingStatus;
  outcome_summary_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function upsertJobOutcomeOnPublish(
  db: Pool,
  projectId: string,
  taskId: string,
  entry: {
    placement_id: string;
    platform: string;
    posted_url: string | null;
    platform_post_id: string | null;
    published_at: string;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.job_outcomes (
       project_id, task_id, placement_id, platform, platform_post_id,
       posted_url, published_at, tracking_status, updated_at
     ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::timestamptz, 'published', now())
     ON CONFLICT (project_id, task_id) DO UPDATE SET
       placement_id = EXCLUDED.placement_id,
       platform = EXCLUDED.platform,
       platform_post_id = EXCLUDED.platform_post_id,
       posted_url = EXCLUDED.posted_url,
       published_at = COALESCE(EXCLUDED.published_at, caf_core.job_outcomes.published_at),
       tracking_status = CASE
         WHEN caf_core.job_outcomes.tracking_status = 'analyzed' THEN caf_core.job_outcomes.tracking_status
         ELSE 'published'
       END,
       updated_at = now()`,
    [
      projectId,
      taskId.trim(),
      entry.placement_id,
      entry.platform,
      entry.platform_post_id,
      entry.posted_url,
      entry.published_at,
    ]
  );
}

export async function markJobOutcomeMetricsPresent(
  db: Pool,
  projectId: string,
  taskIds: string[]
): Promise<number> {
  const ids = [...new Set(taskIds.map((t) => t.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const res = await db.query(
    `UPDATE caf_core.job_outcomes
     SET tracking_status = 'metrics_present', updated_at = now()
     WHERE project_id = $1::uuid AND task_id = ANY($2::text[])
       AND tracking_status = 'published'`,
    [projectId, ids]
  );
  return res.rowCount ?? 0;
}

export async function markJobOutcomesAnalyzed(
  db: Pool,
  projectId: string,
  taskIds: string[]
): Promise<number> {
  const ids = [...new Set(taskIds.map((t) => t.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const res = await db.query(
    `UPDATE caf_core.job_outcomes
     SET tracking_status = 'analyzed', updated_at = now()
     WHERE project_id = $1::uuid AND task_id = ANY($2::text[])`,
    [projectId, ids]
  );
  return res.rowCount ?? 0;
}

export async function getJobOutcomeByTaskId(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<JobOutcomeRow | null> {
  return qOne<JobOutcomeRow>(
    db,
    `SELECT id::text, project_id::text, task_id, placement_id::text, platform,
            platform_post_id, posted_url, published_at::text, tracking_status,
            outcome_summary_json, created_at::text, updated_at::text
     FROM caf_core.job_outcomes
     WHERE project_id = $1::uuid AND task_id = $2`,
    [projectId, taskId.trim()]
  );
}

export async function listJobOutcomesForProject(
  db: Pool,
  projectId: string,
  limit = 200
): Promise<JobOutcomeRow[]> {
  const lim = Math.min(500, Math.max(1, limit));
  return q<JobOutcomeRow>(
    db,
    `SELECT id::text, project_id::text, task_id, placement_id::text, platform,
            platform_post_id, posted_url, published_at::text, tracking_status,
            outcome_summary_json, created_at::text, updated_at::text
     FROM caf_core.job_outcomes
     WHERE project_id = $1::uuid
     ORDER BY updated_at DESC
     LIMIT $2`,
    [projectId, lim]
  );
}
