import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

export async function insertDiagnosticAudit(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    audit_type?: string | null;
    failure_types?: unknown[];
    strengths?: unknown[];
    risk_findings?: unknown[];
    improvement_suggestions?: unknown[];
    audit_score?: number | null;
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  const auditId = `audit_${randomUUID()}`;
  await db.query(
    `INSERT INTO caf_core.diagnostic_audits (
       audit_id, task_id, project_id, audit_type, failure_types, strengths, risk_findings,
       improvement_suggestions, audit_score, metadata_json
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb)`,
    [
      auditId,
      row.task_id,
      row.project_id,
      row.audit_type ?? null,
      JSON.stringify(row.failure_types ?? []),
      JSON.stringify(row.strengths ?? []),
      JSON.stringify(row.risk_findings ?? []),
      JSON.stringify(row.improvement_suggestions ?? []),
      row.audit_score ?? null,
      JSON.stringify(row.metadata ?? {}),
    ]
  );
  return auditId;
}

export async function insertEditorialReview(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    candidate_id?: string | null;
    run_id?: string | null;
    review_status?: string | null;
    decision?: "APPROVED" | "NEEDS_EDIT" | "REJECTED" | null;
    rejection_tags?: unknown[];
    notes?: string | null;
    overrides_json?: Record<string, unknown>;
    validator?: string | null;
    submit?: boolean;
  }
): Promise<void> {
  const submittedAt = row.submit ? new Date().toISOString() : null;
  const reviewStatus = row.review_status ?? (row.submit ? "SUBMITTED" : row.decision ?? null);
  await db.query(
    `INSERT INTO caf_core.editorial_reviews (
       task_id, project_id, candidate_id, run_id, review_status, decision, rejection_tags,
       notes, overrides_json, validator, submit, submitted_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12)`,
    [
      row.task_id,
      row.project_id,
      row.candidate_id ?? null,
      row.run_id ?? null,
      reviewStatus,
      row.decision ?? null,
      JSON.stringify(row.rejection_tags ?? []),
      row.notes ?? null,
      JSON.stringify(row.overrides_json ?? {}),
      row.validator ?? null,
      row.submit ?? false,
      submittedAt,
    ]
  );
}

export async function insertPerformanceMetric(
  db: Pool,
  row: {
    project_id: string;
    candidate_id?: string | null;
    task_id?: string | null;
    platform?: string | null;
    metric_window: "early" | "stabilized";
    window_label?: string | null;
    metric_date?: string | null;
    posted_at?: string | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    watch_time_sec?: number | null;
    engagement_rate?: number | null;
    raw_json?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.performance_metrics (
       project_id, candidate_id, task_id, platform, metric_window, window_label, metric_date,
       posted_at, likes, comments, shares, saves, watch_time_sec, engagement_rate, raw_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      row.project_id,
      row.candidate_id ?? null,
      row.task_id ?? null,
      row.platform ?? null,
      row.metric_window,
      row.window_label ?? null,
      row.metric_date ?? null,
      row.posted_at ?? null,
      row.likes ?? null,
      row.comments ?? null,
      row.shares ?? null,
      row.saves ?? null,
      row.watch_time_sec ?? null,
      row.engagement_rate ?? null,
      JSON.stringify(row.raw_json ?? {}),
    ]
  );
}

export async function insertAutoValidation(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    format_ok?: boolean | null;
    hook_score?: number | null;
    clarity_score?: number | null;
    banned_hits?: unknown[];
    overall_score?: number | null;
    pass_auto?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.auto_validation_results (
       task_id, project_id, format_ok, hook_score, clarity_score, banned_hits, overall_score, pass_auto, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
    [
      row.task_id,
      row.project_id,
      row.format_ok ?? null,
      row.hook_score ?? null,
      row.clarity_score ?? null,
      JSON.stringify(row.banned_hits ?? []),
      row.overall_score ?? null,
      row.pass_auto ?? false,
      JSON.stringify(row.metadata ?? {}),
    ]
  );
}

export async function insertPromptVersion(
  db: Pool,
  row: {
    project_id: string;
    flow_type: string;
    prompt_id: string;
    version: string;
    status?: "active" | "test" | "deprecated";
    system_prompt_version?: string | null;
    user_prompt_version?: string | null;
    output_schema_version?: string | null;
    temperature?: number | null;
    max_tokens?: number | null;
    experiment_tag?: string | null;
    metadata_json?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.prompt_versions (
       project_id, flow_type, prompt_id, version, status, system_prompt_version, user_prompt_version,
       output_schema_version, temperature, max_tokens, experiment_tag, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (project_id, flow_type, prompt_id, version) DO UPDATE SET
       status = EXCLUDED.status,
       system_prompt_version = EXCLUDED.system_prompt_version,
       user_prompt_version = EXCLUDED.user_prompt_version,
       output_schema_version = EXCLUDED.output_schema_version,
       temperature = EXCLUDED.temperature,
       max_tokens = EXCLUDED.max_tokens,
       experiment_tag = EXCLUDED.experiment_tag,
       metadata_json = EXCLUDED.metadata_json`,
    [
      row.project_id,
      row.flow_type,
      row.prompt_id,
      row.version,
      row.status ?? "active",
      row.system_prompt_version ?? null,
      row.user_prompt_version ?? null,
      row.output_schema_version ?? null,
      row.temperature ?? null,
      row.max_tokens ?? null,
      row.experiment_tag ?? null,
      JSON.stringify(row.metadata_json ?? {}),
    ]
  );
}

export async function insertSuppressionRule(
  db: Pool,
  row: {
    project_id: string;
    name: string;
    rule_type: string;
    scope_flow_type?: string | null;
    scope_platform?: string | null;
    threshold_numeric?: number | null;
    window_days?: number | null;
    action?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.suppression_rules (
       project_id, name, rule_type, scope_flow_type, scope_platform, threshold_numeric, window_days, action, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      row.project_id,
      row.name,
      row.rule_type,
      row.scope_flow_type ?? null,
      row.scope_platform ?? null,
      row.threshold_numeric ?? null,
      row.window_days ?? 7,
      row.action ?? "BLOCK_FLOW",
      JSON.stringify(row.metadata ?? {}),
    ]
  );
}
