import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface JobStatsRow {
  total: number;
  today: number;
  by_status: Record<string, number>;
}

export async function getJobStats(db: Pool, projectId: string): Promise<JobStatsRow> {
  const totalRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs WHERE project_id = $1`,
    [projectId]
  );
  const todayRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs
     WHERE project_id = $1 AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`,
    [projectId]
  );
  const statusRows = await q<{ status: string; c: string }>(
    db,
    `SELECT COALESCE(status, '(null)') AS status, COUNT(*)::text AS c
     FROM caf_core.content_jobs WHERE project_id = $1 GROUP BY status ORDER BY status`,
    [projectId]
  );
  const by_status: Record<string, number> = {};
  for (const r of statusRows) by_status[r.status] = parseInt(r.c, 10);
  return {
    total: totalRow ? parseInt(totalRow.c, 10) : 0,
    today: todayRow ? parseInt(todayRow.c, 10) : 0,
    by_status,
  };
}

export interface JobListRow {
  id: string;
  task_id: string;
  run_id: string | null;
  platform: string | null;
  flow_type: string | null;
  status: string | null;
  recommended_route: string | null;
  pre_gen_score: string | null;
  qc_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobListFilters {
  status?: string;
  platform?: string;
  flow_type?: string;
  run_id?: string;
  search?: string;
}

export async function listJobs(
  db: Pool,
  projectId: string,
  filters: JobListFilters = {},
  limit = 50,
  offset = 0
): Promise<{ rows: JobListRow[]; total: number }> {
  const clauses: string[] = ["project_id = $1"];
  const params: unknown[] = [projectId];
  let idx = 2;

  if (filters.status) {
    clauses.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.platform) {
    clauses.push(`platform = $${idx++}`);
    params.push(filters.platform);
  }
  if (filters.flow_type) {
    clauses.push(`flow_type = $${idx++}`);
    params.push(filters.flow_type);
  }
  if (filters.run_id) {
    clauses.push(`run_id = $${idx++}`);
    params.push(filters.run_id);
  }
  if (filters.search) {
    clauses.push(`(task_id ILIKE $${idx} OR run_id ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = clauses.join(" AND ");
  const countRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs WHERE ${where}`,
    params
  );
  const total = countRow ? parseInt(countRow.c, 10) : 0;

  params.push(limit, offset);
  const rows = await q<JobListRow>(
    db,
    `SELECT id, task_id, run_id, platform, flow_type, status, recommended_route,
            pre_gen_score::text, qc_status, created_at::text, updated_at::text
     FROM caf_core.content_jobs WHERE ${where}
     ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
  return { rows, total };
}

export interface DecisionTraceRow {
  trace_id: string;
  run_id: string | null;
  engine_version: string;
  input_snapshot: unknown;
  output_snapshot: unknown;
  created_at: string;
}

export async function listDecisionTraces(
  db: Pool,
  projectId: string,
  limit = 50
): Promise<DecisionTraceRow[]> {
  return q<DecisionTraceRow>(
    db,
    `SELECT trace_id, run_id, engine_version, input_snapshot, output_snapshot, created_at::text
     FROM caf_core.decision_traces WHERE project_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [projectId, limit]
  );
}

export async function listAllPromptVersions(
  db: Pool,
  projectId: string
): Promise<Array<Record<string, unknown>>> {
  return q(
    db,
    `SELECT id, prompt_id, version, status, flow_type, created_at::text
     FROM caf_core.prompt_versions WHERE project_id = $1
     ORDER BY flow_type, CASE status WHEN 'active' THEN 0 WHEN 'test' THEN 1 ELSE 2 END, version DESC`,
    [projectId]
  );
}

export async function listAllSuppressionRules(
  db: Pool,
  projectId: string
): Promise<Array<Record<string, unknown>>> {
  return q(
    db,
    `SELECT id, rule_type, scope_flow_type, scope_platform, threshold_numeric::text,
            window_days, action, active, created_at::text
     FROM caf_core.suppression_rules WHERE project_id = $1
     ORDER BY active DESC, created_at DESC`,
    [projectId]
  );
}

export async function getRunCount(db: Pool, projectId: string): Promise<number> {
  const row = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.runs WHERE project_id = $1`,
    [projectId]
  );
  return row ? parseInt(row.c, 10) : 0;
}

export async function getJobFacets(
  db: Pool,
  projectId: string
): Promise<{ statuses: string[]; platforms: string[]; flow_types: string[]; run_ids: string[] }> {
  const [statuses, platforms, flow_types, run_ids] = await Promise.all([
    q<{ v: string }>(db, `SELECT DISTINCT COALESCE(status,'(null)') AS v FROM caf_core.content_jobs WHERE project_id=$1 ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT platform AS v FROM caf_core.content_jobs WHERE project_id=$1 AND platform IS NOT NULL ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT flow_type AS v FROM caf_core.content_jobs WHERE project_id=$1 AND flow_type IS NOT NULL ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT run_id AS v FROM caf_core.content_jobs WHERE project_id=$1 AND run_id IS NOT NULL ORDER BY v`, [projectId]),
  ]);
  return {
    statuses: statuses.map((r) => r.v),
    platforms: platforms.map((r) => r.v),
    flow_types: flow_types.map((r) => r.v),
    run_ids: run_ids.map((r) => r.v),
  };
}
