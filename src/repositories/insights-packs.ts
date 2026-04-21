import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface InsightsPackRow {
  id: string;
  project_id: string;
  inputs_import_id: string | null;
  signal_pack_id: string | null;
  version: number;
  title: string | null;
  body_json: Record<string, unknown>;
  evidence_refs_json: unknown[];
  created_at: string;
}

export async function insertInsightsPack(
  db: Pool,
  data: {
    project_id: string;
    inputs_import_id: string | null;
    signal_pack_id: string | null;
    title?: string | null;
    body_json: Record<string, unknown>;
    evidence_refs_json: unknown[];
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.insights_packs (
       project_id, inputs_import_id, signal_pack_id, title, body_json, evidence_refs_json
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id`,
    [
      data.project_id,
      data.inputs_import_id,
      data.signal_pack_id,
      data.title ?? null,
      JSON.stringify(data.body_json),
      JSON.stringify(data.evidence_refs_json),
    ]
  );
  if (!row) throw new Error("insertInsightsPack failed");
  return row;
}

export async function listInsightsPacks(
  db: Pool,
  projectId: string,
  limit = 40,
  offset = 0
): Promise<InsightsPackRow[]> {
  return q<InsightsPackRow>(
    db,
    `SELECT * FROM caf_core.insights_packs
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );
}
