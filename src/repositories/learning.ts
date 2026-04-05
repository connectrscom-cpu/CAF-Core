import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export async function insertLearningRule(
  db: Pool,
  row: {
    rule_id: string;
    project_id: string;
    trigger_type: string;
    scope_flow_type?: string | null;
    scope_platform?: string | null;
    action_type: string;
    action_payload: Record<string, unknown>;
    confidence?: number | null;
    source_entity_ids?: string[];
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.learning_rules (
       rule_id, project_id, trigger_type, scope_flow_type, scope_platform,
       action_type, action_payload, confidence, source_entity_ids, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,'pending')
     ON CONFLICT (project_id, rule_id) DO UPDATE SET
       trigger_type = EXCLUDED.trigger_type,
       scope_flow_type = EXCLUDED.scope_flow_type,
       scope_platform = EXCLUDED.scope_platform,
       action_type = EXCLUDED.action_type,
       action_payload = EXCLUDED.action_payload,
       confidence = EXCLUDED.confidence,
       source_entity_ids = EXCLUDED.source_entity_ids`,
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
