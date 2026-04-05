import type { Pool } from "pg";

export async function insertJobStateTransition(
  db: Pool,
  row: {
    task_id: string;
    project_id: string;
    from_state: string | null;
    to_state: string;
    triggered_by: "system" | "human" | "rule" | "experiment";
    rule_id?: string | null;
    actor?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.job_state_transitions (
       task_id, project_id, from_state, to_state, triggered_by, rule_id, actor, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      row.task_id,
      row.project_id,
      row.from_state,
      row.to_state,
      row.triggered_by,
      row.rule_id ?? null,
      row.actor ?? null,
      JSON.stringify(row.metadata ?? {}),
    ]
  );
}
