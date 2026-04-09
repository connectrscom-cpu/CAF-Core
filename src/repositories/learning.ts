import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type LearningRuleInsert = {
  rule_id: string;
  project_id: string;
  trigger_type: string;
  scope_flow_type?: string | null;
  scope_platform?: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  confidence?: number | null;
  source_entity_ids?: string[];
  scope_type?: "project" | "global";
  rule_family?: string;
  evidence_refs?: unknown[];
  hypothesis_id?: string | null;
  expires_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  provenance?: string | null;
  created_by?: string | null;
};

export async function insertLearningRule(db: Pool, row: LearningRuleInsert): Promise<void> {
  const scopeType = row.scope_type ?? "project";
  const ruleFamily = row.rule_family ?? "ranking";
  const evidenceRefs = row.evidence_refs ?? row.source_entity_ids ?? [];
  await db.query(
    `INSERT INTO caf_core.learning_rules (
       rule_id, project_id, trigger_type, scope_flow_type, scope_platform,
       action_type, action_payload, confidence, source_entity_ids, status,
       scope_type, rule_family, evidence_refs, hypothesis_id, expires_at,
       valid_from, valid_to, provenance, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,'pending',
       $10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (project_id, rule_id) DO UPDATE SET
       trigger_type = EXCLUDED.trigger_type,
       scope_flow_type = EXCLUDED.scope_flow_type,
       scope_platform = EXCLUDED.scope_platform,
       action_type = EXCLUDED.action_type,
       action_payload = EXCLUDED.action_payload,
       confidence = EXCLUDED.confidence,
       source_entity_ids = EXCLUDED.source_entity_ids,
       scope_type = EXCLUDED.scope_type,
       rule_family = EXCLUDED.rule_family,
       evidence_refs = EXCLUDED.evidence_refs,
       hypothesis_id = EXCLUDED.hypothesis_id,
       expires_at = EXCLUDED.expires_at,
       valid_from = EXCLUDED.valid_from,
       valid_to = EXCLUDED.valid_to,
       provenance = EXCLUDED.provenance,
       created_by = EXCLUDED.created_by`,
    [
      row.rule_id,
      row.project_id,
      row.trigger_type,
      row.scope_flow_type ?? null,
      row.scope_platform ?? null,
      row.action_type,
      JSON.stringify(row.action_payload),
      row.confidence ?? null,
      JSON.stringify(row.source_entity_ids ?? []),
      scopeType,
      ruleFamily,
      JSON.stringify(evidenceRefs),
      row.hypothesis_id ?? null,
      row.expires_at ?? null,
      row.valid_from ?? null,
      row.valid_to ?? null,
      row.provenance ?? null,
      row.created_by ?? null,
    ]
  );
}

export async function applyLearningRule(db: Pool, projectId: string, ruleId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE caf_core.learning_rules SET status = 'active', applied_at = now()
     WHERE project_id = $1 AND rule_id = $2 AND applied_at IS NULL
     RETURNING id`,
    [projectId, ruleId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listLearningRules(db: Pool, projectId: string): Promise<Record<string, unknown>[]> {
  return q(db, `SELECT * FROM caf_core.learning_rules WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
}

/** Project rules plus global rules (stored under `caf-global`), for UI and operators. */
export async function listLearningRulesMerged(
  db: Pool,
  projectId: string,
  globalProjectId: string | null
): Promise<Record<string, unknown>[]> {
  if (!globalProjectId || globalProjectId === projectId) {
    return q(
      db,
      `SELECT r.*, ps.slug AS storage_project_slug
       FROM caf_core.learning_rules r
       JOIN caf_core.projects ps ON ps.id = r.project_id
       WHERE r.project_id = $1
       ORDER BY r.created_at DESC`,
      [projectId]
    );
  }
  return q(
    db,
    `SELECT r.*, ps.slug AS storage_project_slug
     FROM caf_core.learning_rules r
     JOIN caf_core.projects ps ON ps.id = r.project_id
     WHERE r.project_id = $1 OR (r.project_id = $2 AND r.scope_type = 'global')
     ORDER BY CASE WHEN r.project_id = $1 THEN 0 ELSE 1 END, r.created_at DESC`,
    [projectId, globalProjectId]
  );
}

export async function retireLearningRule(db: Pool, projectId: string, ruleId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE caf_core.learning_rules SET status = 'expired', expires_at = COALESCE(expires_at, now())
     WHERE project_id = $1 AND rule_id = $2 AND status = 'active'
     RETURNING id`,
    [projectId, ruleId]
  );
  return (res.rowCount ?? 0) > 0;
}
