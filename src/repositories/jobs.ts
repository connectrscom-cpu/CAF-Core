import type { Pool } from "pg";
import { qOne } from "../db/queries.js";

/**
 * Remove all jobs for a run and related rows (for replan). Does not delete signal_packs or the run row.
 */
export async function deleteAllJobsForRun(db: Pool, projectId: string, runIdText: string): Promise<number> {
  const { rows } = await db.query<{ task_id: string }>(
    `SELECT task_id FROM caf_core.content_jobs WHERE project_id = $1 AND run_id = $2`,
    [projectId, runIdText]
  );
  const taskIds = rows.map((r) => r.task_id);
  await db.query(`DELETE FROM caf_core.decision_traces WHERE project_id = $1 AND run_id = $2`, [
    projectId,
    runIdText,
  ]);
  if (taskIds.length === 0) return 0;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const p: unknown[] = [projectId, taskIds];
    const tid = `SELECT UNNEST($2::text[])`;
    await client.query(
      `DELETE FROM caf_core.auto_validation_results WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.diagnostic_audits WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.editorial_reviews WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.job_state_transitions WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.validation_events WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.performance_metrics WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(
      `DELETE FROM caf_core.assets WHERE project_id = $1 AND task_id IN (${tid})`,
      p
    );
    await client.query(`DELETE FROM caf_core.job_drafts WHERE project_id = $1 AND run_id = $2`, [
      projectId,
      runIdText,
    ]);
    const del = await client.query(
      `DELETE FROM caf_core.content_jobs WHERE project_id = $1 AND run_id = $2`,
      [projectId, runIdText]
    );
    await client.query("COMMIT");
    return del.rowCount ?? taskIds.length;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function upsertContentJob(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    run_id: string;
    candidate_id?: string | null;
    variation_name?: string | null;
    flow_type?: string | null;
    platform?: string | null;
    origin_platform?: string | null;
    target_platform?: string | null;
    status?: string | null;
    recommended_route?: string | null;
    qc_status?: string | null;
    pre_gen_score?: number | null;
    generation_payload?: Record<string, unknown>;
    render_state?: Record<string, unknown>;
    scene_bundle_state?: Record<string, unknown>;
    review_snapshot?: Record<string, unknown>;
    rework_parent_task_id?: string | null;
  }
): Promise<{ id: string }> {
  const out = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.content_jobs (
       task_id, project_id, run_id, candidate_id, variation_name, flow_type, platform,
       origin_platform, target_platform, status, recommended_route, qc_status, pre_gen_score,
       generation_payload, render_state, scene_bundle_state, review_snapshot, rework_parent_task_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18)
     ON CONFLICT (project_id, task_id) DO UPDATE SET
       run_id = EXCLUDED.run_id,
       candidate_id = EXCLUDED.candidate_id,
       variation_name = EXCLUDED.variation_name,
       flow_type = EXCLUDED.flow_type,
       platform = EXCLUDED.platform,
       origin_platform = EXCLUDED.origin_platform,
       target_platform = EXCLUDED.target_platform,
       status = EXCLUDED.status,
       recommended_route = EXCLUDED.recommended_route,
       qc_status = EXCLUDED.qc_status,
       pre_gen_score = EXCLUDED.pre_gen_score,
       generation_payload = EXCLUDED.generation_payload,
       render_state = EXCLUDED.render_state,
       scene_bundle_state = EXCLUDED.scene_bundle_state,
       review_snapshot = EXCLUDED.review_snapshot,
       rework_parent_task_id = COALESCE(EXCLUDED.rework_parent_task_id, content_jobs.rework_parent_task_id),
       updated_at = now()
     RETURNING id`,
    [
      row.task_id,
      row.project_id,
      row.run_id,
      row.candidate_id ?? null,
      row.variation_name ?? null,
      row.flow_type ?? null,
      row.platform ?? null,
      row.origin_platform ?? null,
      row.target_platform ?? null,
      row.status ?? "PLANNED",
      row.recommended_route ?? null,
      row.qc_status ?? null,
      row.pre_gen_score ?? null,
      JSON.stringify(row.generation_payload ?? {}),
      JSON.stringify(row.render_state ?? {}),
      JSON.stringify(row.scene_bundle_state ?? {}),
      JSON.stringify(row.review_snapshot ?? {}),
      row.rework_parent_task_id ?? null,
    ]
  );
  if (!out) throw new Error("upsert content_job failed");
  return out;
}

export async function getContentJobByTaskId(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<Record<string, unknown> | null> {
  return qOne(
    db,
    `SELECT * FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
}
