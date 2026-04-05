import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface ProjectRow {
  id: string;
  slug: string;
  display_name: string | null;
  active: boolean;
}

export interface ConstraintRow {
  max_daily_jobs: number | null;
  min_score_to_generate: string | null;
  max_active_prompt_versions: number | null;
  default_variation_cap: number;
  auto_validation_pass_threshold: string | null;
}

export interface SuppressionRuleRow {
  id: string;
  rule_type: string;
  scope_flow_type: string | null;
  scope_platform: string | null;
  threshold_numeric: string | null;
  window_days: number | null;
  action: string;
}

export interface LearningRuleRow {
  rule_id: string;
  trigger_type: string;
  scope_flow_type: string | null;
  scope_platform: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
}

export interface PromptVersionRow {
  id: string;
  prompt_id: string;
  version: string;
  status: string;
  flow_type: string;
}

export async function getProjectBySlug(db: Pool, slug: string): Promise<ProjectRow | null> {
  return qOne<ProjectRow>(
    db,
    `SELECT id, slug, display_name, active FROM caf_core.projects WHERE slug = $1`,
    [slug]
  );
}

export async function ensureProject(db: Pool, slug: string, displayName?: string): Promise<ProjectRow> {
  const existing = await getProjectBySlug(db, slug);
  if (existing) return existing;
  const row = await qOne<ProjectRow>(
    db,
    `INSERT INTO caf_core.projects (slug, display_name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, caf_core.projects.display_name)
     RETURNING id, slug, display_name, active`,
    [slug, displayName ?? slug]
  );
  if (!row) throw new Error("Failed to upsert project");
  return row;
}

export async function getConstraints(db: Pool, projectId: string): Promise<ConstraintRow | null> {
  return qOne<ConstraintRow>(
    db,
    `SELECT max_daily_jobs, min_score_to_generate, max_active_prompt_versions, default_variation_cap,
            auto_validation_pass_threshold
     FROM caf_core.project_system_constraints WHERE project_id = $1`,
    [projectId]
  );
}

export async function upsertConstraints(
  db: Pool,
  projectId: string,
  row: {
    max_daily_jobs: number | null;
    min_score_to_generate: number | null;
    max_active_prompt_versions: number | null;
    default_variation_cap: number;
    auto_validation_pass_threshold: number | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.project_system_constraints
      (project_id, max_daily_jobs, min_score_to_generate, max_active_prompt_versions, default_variation_cap, auto_validation_pass_threshold)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id) DO UPDATE SET
       max_daily_jobs = EXCLUDED.max_daily_jobs,
       min_score_to_generate = EXCLUDED.min_score_to_generate,
       max_active_prompt_versions = EXCLUDED.max_active_prompt_versions,
       default_variation_cap = EXCLUDED.default_variation_cap,
       auto_validation_pass_threshold = EXCLUDED.auto_validation_pass_threshold,
       updated_at = now()`,
    [
      projectId,
      row.max_daily_jobs,
      row.min_score_to_generate,
      row.max_active_prompt_versions,
      row.default_variation_cap,
      row.auto_validation_pass_threshold,
    ]
  );
}

export async function listActiveSuppressionRules(db: Pool, projectId: string): Promise<SuppressionRuleRow[]> {
  return q<SuppressionRuleRow>(
    db,
    `SELECT id, rule_type, scope_flow_type, scope_platform, threshold_numeric::text, window_days, action
     FROM caf_core.suppression_rules WHERE project_id = $1 AND active = true`,
    [projectId]
  );
}

export async function listActiveAppliedLearningRules(db: Pool, projectId: string): Promise<LearningRuleRow[]> {
  return q<LearningRuleRow>(
    db,
    `SELECT rule_id, trigger_type, scope_flow_type, scope_platform, action_type, action_payload
     FROM caf_core.learning_rules
     WHERE project_id = $1 AND status = 'active' AND applied_at IS NOT NULL`,
    [projectId]
  );
}

export async function listPromptVersionsForFlow(
  db: Pool,
  projectId: string,
  flowType: string,
  statuses: string[] = ["active", "test"]
): Promise<PromptVersionRow[]> {
  return q<PromptVersionRow>(
    db,
    `SELECT id, prompt_id, version, status, flow_type
     FROM caf_core.prompt_versions
     WHERE project_id = $1 AND flow_type = $2 AND status = ANY($3::text[])
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'test' THEN 1 ELSE 2 END, version DESC`,
    [projectId, flowType, statuses]
  );
}

export async function countJobsCreatedToday(db: Pool, projectId: string): Promise<number> {
  const row = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs
     WHERE project_id = $1 AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`,
    [projectId]
  );
  return row ? parseInt(row.c, 10) : 0;
}

export async function insertDecisionTrace(
  db: Pool,
  params: {
    traceId: string;
    projectId: string;
    runId: string | null;
    engineVersion: string;
    inputSnapshot: unknown;
    outputSnapshot: unknown;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.decision_traces (trace_id, project_id, run_id, engine_version, input_snapshot, output_snapshot)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      params.traceId,
      params.projectId,
      params.runId,
      params.engineVersion,
      JSON.stringify(params.inputSnapshot),
      JSON.stringify(params.outputSnapshot),
    ]
  );
}

/** Rejection rate in window (0–1). Flow-specific joins content_jobs when flowType set. */
export async function getRejectionRateForScope(
  db: Pool,
  projectId: string,
  flowType: string | null,
  windowDays: number
): Promise<number> {
  if (flowType) {
    const row = await qOne<{ rate: string }>(
      db,
      `SELECT CASE WHEN COUNT(*) = 0 THEN 0::float8
              ELSE (COUNT(*) FILTER (WHERE r.decision = 'REJECTED'))::float8 / COUNT(*)::float8 END AS rate
       FROM caf_core.editorial_reviews r
       INNER JOIN caf_core.content_jobs j ON j.task_id = r.task_id AND j.project_id = r.project_id
       WHERE r.project_id = $1 AND j.flow_type = $2
         AND r.submitted_at > now() - make_interval(days => $3)`,
      [projectId, flowType, windowDays]
    );
    return row ? parseFloat(row.rate) : 0;
  }
  const row = await qOne<{ rate: string }>(
    db,
    `SELECT CASE WHEN COUNT(*) = 0 THEN 0::float8
            ELSE (COUNT(*) FILTER (WHERE decision = 'REJECTED'))::float8 / COUNT(*)::float8 END AS rate
     FROM caf_core.editorial_reviews
     WHERE project_id = $1
       AND submitted_at > now() - make_interval(days => $2)`,
    [projectId, windowDays]
  );
  return row ? parseFloat(row.rate) : 0;
}
