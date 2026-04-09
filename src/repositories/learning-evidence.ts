import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export async function insertObservation(
  db: Pool,
  row: {
    observation_id: string;
    scope_type: string;
    project_id: string;
    source_type: string;
    flow_type: string | null;
    platform: string | null;
    observation_type: string;
    entity_ref: string | null;
    payload_json: Record<string, unknown>;
    confidence: number | null;
    observed_at: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_observations (
       observation_id, project_id, scope_type, source_type, flow_type, platform,
       observation_type, entity_ref, payload_json, confidence, observed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
     ON CONFLICT (project_id, observation_id) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       flow_type = EXCLUDED.flow_type,
       platform = EXCLUDED.platform,
       observation_type = EXCLUDED.observation_type,
       entity_ref = EXCLUDED.entity_ref,
       payload_json = EXCLUDED.payload_json,
       confidence = EXCLUDED.confidence,
       observed_at = EXCLUDED.observed_at`,
    [
      row.observation_id,
      row.project_id,
      row.scope_type,
      row.source_type,
      row.flow_type,
      row.platform,
      row.observation_type,
      row.entity_ref,
      JSON.stringify(row.payload_json),
      row.confidence,
      row.observed_at ?? new Date().toISOString(),
    ]
  );
}

export async function listObservations(
  db: Pool,
  projectId: string,
  opts: { limit: number; source_type?: string }
): Promise<Record<string, unknown>[]> {
  const lim = Math.min(500, Math.max(1, opts.limit));
  if (opts.source_type) {
    return q(
      db,
      `SELECT * FROM caf_core.learning_observations
       WHERE project_id = $1 AND source_type = $2
       ORDER BY observed_at DESC LIMIT $3`,
      [projectId, opts.source_type, lim]
    );
  }
  return q(
    db,
    `SELECT * FROM caf_core.learning_observations
     WHERE project_id = $1 ORDER BY observed_at DESC LIMIT $2`,
    [projectId, lim]
  );
}

export async function insertHypothesis(
  db: Pool,
  row: {
    hypothesis_id: string;
    scope_type: string;
    project_id: string;
    title: string;
    statement: string;
    rationale: string | null;
    status: string | undefined;
    priority: number | undefined;
    owner: string | null;
    expires_at: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_hypotheses (
       hypothesis_id, project_id, scope_type, title, statement, rationale,
       status, priority, owner, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id, hypothesis_id) DO UPDATE SET
       title = EXCLUDED.title,
       statement = EXCLUDED.statement,
       rationale = EXCLUDED.rationale,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       owner = EXCLUDED.owner,
       expires_at = EXCLUDED.expires_at`,
    [
      row.hypothesis_id,
      row.project_id,
      row.scope_type,
      row.title,
      row.statement,
      row.rationale,
      row.status ?? "open",
      row.priority ?? 0,
      row.owner,
      row.expires_at,
    ]
  );
}

export async function listHypotheses(db: Pool, projectId: string): Promise<Record<string, unknown>[]> {
  return q(
    db,
    `SELECT * FROM caf_core.learning_hypotheses WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function insertHypothesisTrial(
  db: Pool,
  row: {
    trial_id: string;
    hypothesis_id: string | null;
    scope_type: string;
    project_id: string;
    experiment_type: string;
    design_json: Record<string, unknown> | undefined;
    start_at: string | null;
    end_at: string | null;
    status: string | undefined;
    success_metric: string | null;
    result_summary: string | null;
    result_payload_json: Record<string, unknown> | undefined;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_hypothesis_trials (
       trial_id, hypothesis_id, project_id, scope_type, experiment_type, design_json,
       start_at, end_at, status, success_metric, result_summary, result_payload_json
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (project_id, trial_id) DO UPDATE SET
       hypothesis_id = EXCLUDED.hypothesis_id,
       experiment_type = EXCLUDED.experiment_type,
       design_json = EXCLUDED.design_json,
       start_at = EXCLUDED.start_at,
       end_at = EXCLUDED.end_at,
       status = EXCLUDED.status,
       success_metric = EXCLUDED.success_metric,
       result_summary = EXCLUDED.result_summary,
       result_payload_json = EXCLUDED.result_payload_json`,
    [
      row.trial_id,
      row.hypothesis_id,
      row.project_id,
      row.scope_type,
      row.experiment_type,
      JSON.stringify(row.design_json ?? {}),
      row.start_at,
      row.end_at,
      row.status ?? "planned",
      row.success_metric,
      row.result_summary,
      JSON.stringify(row.result_payload_json ?? {}),
    ]
  );
}

export async function listHypothesisTrials(db: Pool, projectId: string): Promise<Record<string, unknown>[]> {
  return q(
    db,
    `SELECT * FROM caf_core.learning_hypothesis_trials WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function insertInsight(
  db: Pool,
  row: {
    insight_id: string;
    scope_type: string;
    project_id: string;
    title: string;
    body: string;
    derived_from_observation_ids: string[] | undefined;
    confidence: number | null;
    status: string | undefined;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_insights (
       insight_id, project_id, scope_type, title, body,
       derived_from_observation_ids, confidence, status
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (project_id, insight_id) DO UPDATE SET
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       derived_from_observation_ids = EXCLUDED.derived_from_observation_ids,
       confidence = EXCLUDED.confidence,
       status = EXCLUDED.status`,
    [
      row.insight_id,
      row.project_id,
      row.scope_type,
      row.title,
      row.body,
      JSON.stringify(row.derived_from_observation_ids ?? []),
      row.confidence,
      row.status ?? "draft",
    ]
  );
}

export async function listInsights(db: Pool, projectId: string): Promise<Record<string, unknown>[]> {
  return q(
    db,
    `SELECT * FROM caf_core.learning_insights WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function insertPerformanceIngestionBatch(
  db: Pool,
  row: {
    project_id: string;
    source_filename: string;
    file_hash: string;
    row_count: number;
    mapping_json: Record<string, unknown>;
  }
): Promise<string> {
  const r = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.performance_ingestion_batches (
       project_id, source_filename, file_hash, row_count, mapping_json
     ) VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING id::text AS id`,
    [row.project_id, row.source_filename, row.file_hash, row.row_count, JSON.stringify(row.mapping_json)]
  );
  return r?.id ?? "";
}

export async function insertGenerationAttribution(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    flow_type: string | null;
    platform: string | null;
    applied_rule_ids: string[];
    global_context_chars: number;
    project_context_chars: number;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_generation_attribution (
       task_id, project_id, flow_type, platform,
       applied_rule_ids, global_context_chars, project_context_chars
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      row.task_id,
      row.project_id,
      row.flow_type,
      row.platform,
      JSON.stringify(row.applied_rule_ids),
      row.global_context_chars,
      row.project_context_chars,
    ]
  );
}