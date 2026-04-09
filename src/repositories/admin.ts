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
  candidate_id: string | null;
  variation_name: string | null;
  render_provider: string | null;
  render_status: string | null;
  /** From render_state JSON (e.g. carousel / video step). */
  render_phase: string | null;
  /** Human-readable pipeline position (where a stuck job is waiting). */
  pipeline_phase: string | null;
  /** Best-effort pipeline/render failure text. */
  last_error: string | null;
}

export interface JobListFilters {
  status?: string;
  platform?: string;
  flow_type?: string;
  run_id?: string;
  search?: string;
}

/** Same predicates as the Jobs admin list (search, run_id prefix match, etc.). */
export function buildJobListWhereClause(
  projectId: string,
  filters: JobListFilters
): { where: string; params: unknown[]; nextIndex: number } {
  const clauses: string[] = ["c.project_id = $1"];
  const params: unknown[] = [projectId];
  let idx = 2;

  if (filters.status) {
    clauses.push(`c.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.platform) {
    clauses.push(`c.platform = $${idx++}`);
    params.push(filters.platform);
  }
  if (filters.flow_type) {
    clauses.push(`c.flow_type = $${idx++}`);
    params.push(filters.flow_type);
  }
  if (filters.run_id) {
    const r = `$${idx}`;
    clauses.push(
      `(c.run_id = ${r} OR (
        char_length(c.task_id) > char_length(${r}::text)
        AND left(c.task_id, char_length(${r}::text)) = ${r}::text
        AND substr(c.task_id, char_length(${r}::text) + 1, 1) = '_'
      ))`
    );
    params.push(filters.run_id);
    idx++;
  }
  if (filters.search) {
    clauses.push(`(c.task_id ILIKE $${idx} OR c.run_id ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  return { where: clauses.join(" AND "), params, nextIndex: idx };
}

const MATCHING_TASK_IDS_CAP = 5000;

/** Task ids matching the same filters as the Jobs table (for bulk erase). */
export async function listTaskIdsMatchingJobFilters(
  db: Pool,
  projectId: string,
  filters: JobListFilters
): Promise<{ task_ids: string[]; cap_hit: boolean }> {
  const { where, params, nextIndex } = buildJobListWhereClause(projectId, filters);
  const rows = await q<{ task_id: string }>(
    db,
    `SELECT c.task_id FROM caf_core.content_jobs c WHERE ${where} ORDER BY c.created_at DESC LIMIT $${nextIndex}`,
    [...params, MATCHING_TASK_IDS_CAP + 1]
  );
  const cap_hit = rows.length > MATCHING_TASK_IDS_CAP;
  const task_ids = rows.slice(0, MATCHING_TASK_IDS_CAP).map((r) => r.task_id);
  return { task_ids, cap_hit };
}

export async function listJobs(
  db: Pool,
  projectId: string,
  filters: JobListFilters = {},
  limit = 50,
  offset = 0
): Promise<{ rows: JobListRow[]; total: number }> {
  const { where, params, nextIndex: idx } = buildJobListWhereClause(projectId, filters);
  const countRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs c WHERE ${where}`,
    params
  );
  const total = countRow ? parseInt(countRow.c, 10) : 0;

  const listParams = [...params, limit, offset];
  const rows = await q<JobListRow>(
    db,
    `SELECT c.id, c.task_id, c.run_id, c.platform, c.flow_type, c.status, c.recommended_route,
            c.pre_gen_score::text, c.qc_status, c.created_at::text, c.updated_at::text,
            c.candidate_id, c.variation_name, c.render_provider, c.render_status,
            COALESCE(NULLIF(trim(c.render_state->>'status'), ''), NULLIF(trim(c.render_state->>'provider'), '')) AS render_phase,
            (
              CASE c.status
                WHEN 'PLANNED' THEN
                  CASE
                    WHEN (c.generation_payload ? 'generated_output')
                         AND jsonb_typeof(c.generation_payload->'generated_output') IS NOT NULL
                         AND jsonb_typeof(c.generation_payload->'generated_output') <> 'null'
                    THEN 'PLANNED · has LLM output — run Process or retry this job'
                    ELSE 'PLANNED · waiting for pipeline pickup (not processed yet)'
                  END
                WHEN 'GENERATING' THEN 'GENERATING · LLM (OpenAI)'
                WHEN 'GENERATED' THEN
                  CASE
                    WHEN c.qc_status IS NOT NULL AND btrim(c.qc_status) <> '' THEN
                      'GENERATED · LLM done · QC ' || trim(c.qc_status) ||
                      ' · media/render not started (status stays here until RENDERING)'
                    ELSE
                      'GENERATED · LLM done · QC/diagnostics next — run Process to continue'
                  END
                WHEN 'RENDERING' THEN
                  CASE COALESCE(NULLIF(trim(c.render_state->>'status'), ''), '')
                    WHEN 'pending' THEN
                      CASE lower(trim(COALESCE(c.render_state->>'provider', '')))
                        WHEN 'carousel-renderer' THEN
                          'RENDERING · carousel — ' ||
                          CASE
                            WHEN (c.render_state ? 'slide_index') AND (c.render_state ? 'slide_total')
                                 AND trim(c.render_state->>'slide_index') <> ''
                                 AND trim(c.render_state->>'slide_total') <> ''
                            THEN 'slide ' || trim(c.render_state->>'slide_index') || '/' || trim(c.render_state->>'slide_total') || ' · '
                            ELSE ''
                          END ||
                          'PNG from renderer'
                        WHEN 'video' THEN 'RENDERING · video — HeyGen single clip, or scene URLs → assembly (see render_state)'
                        WHEN 'heygen' THEN 'RENDERING · HeyGen — API submit → poll → download'
                        WHEN 'video-assembly' THEN 'RENDERING · video-assembly service'
                        WHEN 'scene-pipeline' THEN 'RENDERING · scene pipeline — merge / mux / assets'
                        ELSE 'RENDERING · pending (' || COALESCE(trim(c.render_state->>'provider'), '?') || ')'
                      END
                    WHEN 'in_progress' THEN
                      CASE trim(COALESCE(c.render_state->>'phase', ''))
                        WHEN 'sora_scene_clips' THEN
                          'RENDERING · OpenAI Sora scene clips ' ||
                          COALESCE(NULLIF(trim(c.render_state->>'scene_clip_done'), ''), '0') || '/' ||
                          COALESCE(NULLIF(trim(c.render_state->>'scene_clip_total'), ''), '?') ||
                          ' (then import + concat)'
                        WHEN 'heygen_scene_clips' THEN
                          'RENDERING · HeyGen scene clips ' ||
                          COALESCE(NULLIF(trim(c.render_state->>'scene_clip_done'), ''), '0') || '/' ||
                          COALESCE(NULLIF(trim(c.render_state->>'scene_clip_total'), ''), '?') ||
                          ' (then import + concat)'
                        WHEN 'scene_import_concat' THEN
                          'RENDERING · importing scene clips + concat (' ||
                          COALESCE(NULLIF(trim(c.render_state->>'scene_total'), ''), '?') || ' scenes)'
                        ELSE
                          'RENDERING · in progress — ' || COALESCE(trim(c.render_state->>'phase'), 'see render_state')
                      END
                    WHEN 'failed' THEN 'RENDERING · failed — ' || left(COALESCE(trim(c.render_state->>'error'), 'unknown'), 120)
                    WHEN 'skipped' THEN 'RENDERING · skipped — ' || COALESCE(trim(c.render_state->>'reason'), '?')
                    WHEN 'completed' THEN 'RENDERING · render finished — updating job status'
                    ELSE 'RENDERING · ' || COALESCE(NULLIF(trim(c.render_state->>'status'), ''), NULLIF(trim(c.render_state->>'provider'), ''), 'in progress')
                  END
                WHEN 'IN_REVIEW' THEN 'IN_REVIEW · human review queue'
                WHEN 'NEEDS_EDIT' THEN 'NEEDS_EDIT · awaiting edits / rework'
                WHEN 'APPROVED' THEN 'APPROVED · done'
                WHEN 'BLOCKED' THEN
                  'BLOCKED · ' || COALESCE(
                    NULLIF(left(btrim(COALESCE(c.generation_payload->'qc_result'->>'reason_short', '')), 200), ''),
                    'QC or policy'
                  )
                WHEN 'REJECTED' THEN 'REJECTED'
                WHEN 'FAILED' THEN 'FAILED · see error column or state transitions'
                ELSE COALESCE(c.status, '—')
              END
            ) ||
            CASE
              WHEN c.status = 'RENDERING'
                   AND c.qc_status IS NOT NULL
                   AND upper(trim(c.qc_status)) NOT IN ('PASS', 'OK', '')
              THEN ' · QC=' || trim(c.qc_status)
              ELSE ''
            END AS pipeline_phase,
            COALESCE(
              NULLIF(trim(c.render_state->>'error'), ''),
              (SELECT NULLIF(trim(jt.metadata_json->>'error'), '')
               FROM caf_core.job_state_transitions jt
               WHERE jt.project_id = c.project_id AND jt.task_id = c.task_id AND jt.to_state = 'FAILED'
               ORDER BY jt.created_at DESC LIMIT 1)
            ) AS last_error
     FROM caf_core.content_jobs c WHERE ${where}
     ORDER BY c.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    listParams
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

export async function listDecisionTracesForRun(
  db: Pool,
  projectId: string,
  runIdText: string,
  limit = 20
): Promise<DecisionTraceRow[]> {
  return q<DecisionTraceRow>(
    db,
    `SELECT trace_id, run_id, engine_version, input_snapshot, output_snapshot, created_at::text
     FROM caf_core.decision_traces
     WHERE project_id = $1 AND run_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [projectId, runIdText, limit]
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

export interface JobAdminTransitionRow {
  id: string;
  from_state: string | null;
  to_state: string;
  triggered_by: string;
  actor: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

/** Full job row + recent state transitions for admin drill-down. */
export async function getJobAdminDetail(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<{ job: Record<string, unknown>; transitions: JobAdminTransitionRow[] } | null> {
  const job = await qOne<Record<string, unknown>>(
    db,
    `SELECT id::text, task_id, run_id, candidate_id, variation_name, flow_type, platform, origin_platform, target_platform,
            status, recommended_route, qc_status, render_provider, render_status, asset_id,
            pre_gen_score::text, generation_payload, render_state, scene_bundle_state, review_snapshot,
            created_at::text, updated_at::text
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) return null;
  const transitions = await q<JobAdminTransitionRow>(
    db,
    `SELECT id::text, from_state, to_state, triggered_by, actor, metadata_json, created_at::text
     FROM caf_core.job_state_transitions WHERE project_id = $1 AND task_id = $2 ORDER BY created_at DESC LIMIT 40`,
    [projectId, taskId]
  );
  return { job, transitions };
}
