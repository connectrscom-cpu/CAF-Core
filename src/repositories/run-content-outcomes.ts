import type { Pool } from "pg";
import { q } from "../db/queries.js";

export interface RunContentOutcomeInsert {
  project_id: string;
  run_id: string;
  task_id: string;
  flow_type: string;
  flow_kind: string;
  outcome: string;
  job_status: string;
  slide_count: number | null;
  asset_count: number;
  summary: Record<string, unknown>;
  error_message: string | null;
}

export interface RunContentOutcomeRow {
  created_at: string;
  task_id: string;
  flow_kind: string;
  flow_type: string;
  outcome: string;
  slide_count: number | null;
  asset_count: number;
  job_status: string;
  error_message: string | null;
  summary: Record<string, unknown>;
}

export async function insertRunContentOutcome(db: Pool, row: RunContentOutcomeInsert): Promise<void> {
  await q(
    db,
    `INSERT INTO caf_core.run_content_outcomes (
       project_id, run_id, task_id, flow_type, flow_kind, outcome, job_status,
       slide_count, asset_count, summary_json, error_message
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      row.project_id,
      row.run_id,
      row.task_id,
      row.flow_type,
      row.flow_kind,
      row.outcome,
      row.job_status,
      row.slide_count,
      row.asset_count,
      JSON.stringify(row.summary ?? {}),
      row.error_message,
    ]
  );
}

export async function listRunContentOutcomes(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  const rows = await q<{
    created_at: Date;
    task_id: string;
    flow_kind: string;
    flow_type: string;
    outcome: string;
    slide_count: string | null;
    asset_count: string;
    job_status: string;
    error_message: string | null;
    summary_json: unknown;
  }>(
    db,
    `SELECT created_at, task_id, flow_kind, flow_type, outcome, slide_count::text, asset_count::text,
            job_status, error_message, summary_json
     FROM caf_core.run_content_outcomes
     WHERE project_id = $1 AND run_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [projectId, runId, limit]
  );
  return rows.map((r) => ({
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    task_id: r.task_id,
    flow_kind: r.flow_kind,
    flow_type: r.flow_type,
    outcome: r.outcome,
    slide_count: r.slide_count == null ? null : parseInt(r.slide_count, 10),
    asset_count: parseInt(r.asset_count, 10),
    job_status: r.job_status,
    error_message: r.error_message,
    summary:
      r.summary_json && typeof r.summary_json === "object" && !Array.isArray(r.summary_json)
        ? (r.summary_json as Record<string, unknown>)
        : {},
  }));
}
