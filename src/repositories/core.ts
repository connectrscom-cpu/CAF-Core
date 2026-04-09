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
  /** Max planned jobs (incl. variations) classified as carousel per generation plan. */
  max_carousel_jobs_per_run: number | null;
  /** Max planned jobs (incl. variations) classified as video/reel per generation plan. */
  max_video_jobs_per_run: number | null;
  /** Per flow_type caps (override engine defaults; see default-plan-caps for built-in video caps). */
  max_jobs_per_flow_type: Record<string, unknown>;
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
  scope_type?: string;
  rule_family?: string;
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
            auto_validation_pass_threshold,
            max_carousel_jobs_per_run, max_video_jobs_per_run, max_jobs_per_flow_type
     FROM caf_core.project_system_constraints WHERE project_id = $1`,
    [projectId]
  );
}

/** Normalize JSON/unknown into non-negative integer caps per flow_type key. */
export function normalizePerFlowCaps(raw: unknown): Record<string, number> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return {};
    try {
      return normalizePerFlowCaps(JSON.parse(s));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.min(Math.floor(n), 1_000_000);
  }
  return out;
}

export type ConstraintsPatch = {
  max_daily_jobs?: number | null;
  min_score_to_generate?: number | null;
  max_active_prompt_versions?: number | null;
  default_variation_cap?: number | null;
  auto_validation_pass_threshold?: number | null;
  max_carousel_jobs_per_run?: number | null;
  max_video_jobs_per_run?: number | null;
  max_jobs_per_flow_type?: unknown;
};

export function mergeConstraintUpdate(
  existing: ConstraintRow | null,
  patch: ConstraintsPatch
): {
  max_daily_jobs: number | null;
  min_score_to_generate: number | null;
  max_active_prompt_versions: number | null;
  default_variation_cap: number;
  auto_validation_pass_threshold: number | null;
  max_carousel_jobs_per_run: number | null;
  max_video_jobs_per_run: number | null;
  max_jobs_per_flow_type: Record<string, number>;
} {
  return {
    max_daily_jobs:
      patch.max_daily_jobs !== undefined ? patch.max_daily_jobs : existing?.max_daily_jobs ?? null,
    min_score_to_generate:
      patch.min_score_to_generate !== undefined
        ? patch.min_score_to_generate
        : existing?.min_score_to_generate != null
          ? Number(existing.min_score_to_generate)
          : null,
    max_active_prompt_versions:
      patch.max_active_prompt_versions !== undefined
        ? patch.max_active_prompt_versions
        : existing?.max_active_prompt_versions ?? null,
    default_variation_cap:
      patch.default_variation_cap !== undefined
        ? Math.max(1, Math.floor(Number(patch.default_variation_cap)) || 1)
        : existing?.default_variation_cap ?? 1,
    auto_validation_pass_threshold:
      patch.auto_validation_pass_threshold !== undefined
        ? patch.auto_validation_pass_threshold
        : existing?.auto_validation_pass_threshold != null
          ? Number(existing.auto_validation_pass_threshold)
          : null,
    max_carousel_jobs_per_run:
      patch.max_carousel_jobs_per_run !== undefined
        ? patch.max_carousel_jobs_per_run
        : existing?.max_carousel_jobs_per_run ?? null,
    max_video_jobs_per_run:
      patch.max_video_jobs_per_run !== undefined
        ? patch.max_video_jobs_per_run
        : existing?.max_video_jobs_per_run ?? null,
    max_jobs_per_flow_type:
      patch.max_jobs_per_flow_type !== undefined
        ? normalizePerFlowCaps(patch.max_jobs_per_flow_type)
        : normalizePerFlowCaps(existing?.max_jobs_per_flow_type),
  };
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
    max_carousel_jobs_per_run: number | null;
    max_video_jobs_per_run: number | null;
    max_jobs_per_flow_type: Record<string, number>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.project_system_constraints
      (project_id, max_daily_jobs, min_score_to_generate, max_active_prompt_versions, default_variation_cap, auto_validation_pass_threshold,
       max_carousel_jobs_per_run, max_video_jobs_per_run, max_jobs_per_flow_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (project_id) DO UPDATE SET
       max_daily_jobs = EXCLUDED.max_daily_jobs,
       min_score_to_generate = EXCLUDED.min_score_to_generate,
       max_active_prompt_versions = EXCLUDED.max_active_prompt_versions,
       default_variation_cap = EXCLUDED.default_variation_cap,
       auto_validation_pass_threshold = EXCLUDED.auto_validation_pass_threshold,
       max_carousel_jobs_per_run = EXCLUDED.max_carousel_jobs_per_run,
       max_video_jobs_per_run = EXCLUDED.max_video_jobs_per_run,
       max_jobs_per_flow_type = EXCLUDED.max_jobs_per_flow_type,
       updated_at = now()`,
    [
      projectId,
      row.max_daily_jobs,
      row.min_score_to_generate,
      row.max_active_prompt_versions,
      row.default_variation_cap,
      row.auto_validation_pass_threshold,
      row.max_carousel_jobs_per_run,
      row.max_video_jobs_per_run,
      JSON.stringify(row.max_jobs_per_flow_type),
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
    `SELECT r.rule_id, r.trigger_type, r.scope_flow_type, r.scope_platform, r.action_type, r.action_payload,
            r.scope_type, r.rule_family
     FROM caf_core.learning_rules r
     WHERE r.status = 'active' AND r.applied_at IS NOT NULL
       AND (r.expires_at IS NULL OR r.expires_at > now())
       AND (r.valid_to IS NULL OR r.valid_to > now())
       AND r.valid_from <= now()
       AND (r.rule_family IS NULL OR r.rule_family IN ('ranking', 'suppression'))
       AND r.action_type IN ('BOOST_RANK', 'SCORE_BOOST', 'SCORE_PENALTY')
       AND (
         r.project_id = $1
         OR (r.scope_type = 'global' AND r.project_id = (SELECT id FROM caf_core.projects WHERE slug = 'caf-global' LIMIT 1))
       )`,
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
