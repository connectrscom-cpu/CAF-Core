import type { Pool } from "pg";
import { deleteAllJobsForRun } from "./jobs.js";
import { q, qOne } from "../db/queries.js";

export type RunStatus = "CREATED" | "PLANNING" | "PLANNED" | "GENERATING" | "RENDERING" | "REVIEWING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface RunRow {
  id: string;
  run_id: string;
  project_id: string;
  status: RunStatus;
  source_window: string | null;
  signal_pack_id: string | null;
  metadata_json: Record<string, unknown>;
  total_jobs: number;
  jobs_completed: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createRun(
  db: Pool,
  data: {
    run_id: string;
    project_id: string;
    source_window?: string | null;
    signal_pack_id?: string | null;
    metadata_json?: Record<string, unknown>;
  }
): Promise<RunRow> {
  const row = await qOne<RunRow>(db, `
    INSERT INTO caf_core.runs (run_id, project_id, source_window, signal_pack_id, metadata_json)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *`,
    [data.run_id, data.project_id, data.source_window ?? null,
     data.signal_pack_id ?? null, JSON.stringify(data.metadata_json ?? {})]);
  if (!row) throw new Error("Failed to create run");
  return row;
}

export async function getRunById(db: Pool, id: string): Promise<RunRow | null> {
  return qOne<RunRow>(db, `SELECT * FROM caf_core.runs WHERE id = $1`, [id]);
}

export async function getRunByRunId(db: Pool, projectId: string, runId: string): Promise<RunRow | null> {
  return qOne<RunRow>(db, `SELECT * FROM caf_core.runs WHERE project_id = $1 AND run_id = $2`, [projectId, runId]);
}

export async function listRuns(db: Pool, projectId: string, limit = 50, offset = 0): Promise<RunRow[]> {
  return q<RunRow>(db,
    `SELECT * FROM caf_core.runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]);
}

export async function updateRunStatus(
  db: Pool,
  runId: string,
  status: RunStatus,
  extra?: {
    started_at?: string;
    completed_at?: string;
    total_jobs?: number;
    jobs_completed?: number;
  }
): Promise<RunRow | null> {
  return qOne<RunRow>(db, `
    UPDATE caf_core.runs SET
      status = $2,
      started_at = COALESCE($3::timestamptz, started_at),
      completed_at = COALESCE($4::timestamptz, completed_at),
      total_jobs = COALESCE($5, total_jobs),
      jobs_completed = COALESCE($6, jobs_completed),
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [runId, status, extra?.started_at ?? null, extra?.completed_at ?? null,
     extra?.total_jobs ?? null, extra?.jobs_completed ?? null]);
}

export async function patchRun(
  db: Pool,
  runUuid: string,
  patch: {
    signal_pack_id?: string | null;
    source_window?: string | null;
    metadata_json?: Record<string, unknown>;
  }
): Promise<RunRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.signal_pack_id !== undefined) {
    sets.push(`signal_pack_id = $${i++}`);
    vals.push(patch.signal_pack_id);
  }
  if (patch.source_window !== undefined) {
    sets.push(`source_window = $${i++}`);
    vals.push(patch.source_window);
  }
  if (patch.metadata_json !== undefined) {
    sets.push(`metadata_json = metadata_json || $${i++}::jsonb`);
    vals.push(JSON.stringify(patch.metadata_json));
  }
  if (sets.length === 0) {
    return getRunById(db, runUuid);
  }
  vals.push(runUuid);
  return qOne<RunRow>(
    db,
    `UPDATE caf_core.runs SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`,
    vals
  );
}

export async function incrementRunJobsCompleted(db: Pool, runId: string): Promise<RunRow | null> {
  return qOne<RunRow>(db, `
    UPDATE caf_core.runs SET
      jobs_completed = jobs_completed + 1,
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [runId]);
}

/** Clear lifecycle fields so `startRun` can run again after deleting jobs. */
export async function resetRunForReplan(db: Pool, runUuid: string): Promise<RunRow | null> {
  return qOne<RunRow>(
    db,
    `UPDATE caf_core.runs SET
       status = 'CREATED',
       started_at = NULL,
       completed_at = NULL,
       total_jobs = 0,
       jobs_completed = 0,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [runUuid]
  );
}

/** Remove all jobs, the run row, then signal packs (`runs.signal_pack_id` FK must be cleared by deleting run first). */
export async function deleteRunCascade(
  db: Pool,
  projectId: string,
  runIdText: string
): Promise<{ content_jobs_deleted: number; run_deleted: boolean }> {
  const content_jobs_deleted = await deleteAllJobsForRun(db, projectId, runIdText);
  await db.query(`DELETE FROM caf_core.candidates WHERE project_id = $1 AND run_id = $2`, [
    projectId,
    runIdText,
  ]);
  const del = await db.query(`DELETE FROM caf_core.runs WHERE project_id = $1 AND run_id = $2 RETURNING id`, [
    projectId,
    runIdText,
  ]);
  await db.query(`DELETE FROM caf_core.signal_packs WHERE project_id = $1 AND run_id = $2`, [
    projectId,
    runIdText,
  ]);
  return { content_jobs_deleted, run_deleted: (del.rowCount ?? 0) > 0 };
}
