import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface QcFlowProfileRow {
  project_id: string;
  flow_type: string;
  profile_json: Record<string, unknown>;
  updated_at: string;
}

export async function getQcFlowProfile(
  db: Pool,
  projectId: string,
  flowType: string
): Promise<QcFlowProfileRow | null> {
  return qOne<QcFlowProfileRow>(
    db,
    `SELECT project_id::text, flow_type, profile_json, updated_at::text
       FROM caf_core.qc_flow_profiles
      WHERE project_id = $1 AND flow_type = $2`,
    [projectId, flowType]
  );
}

export async function listQcFlowProfiles(db: Pool, projectId: string): Promise<QcFlowProfileRow[]> {
  return q(
    db,
    `SELECT project_id::text, flow_type, profile_json, updated_at::text
       FROM caf_core.qc_flow_profiles
      WHERE project_id = $1
      ORDER BY flow_type`,
    [projectId]
  );
}

export async function upsertQcFlowProfile(
  db: Pool,
  projectId: string,
  flowType: string,
  profileJson: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.qc_flow_profiles (project_id, flow_type, profile_json)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (project_id, flow_type) DO UPDATE SET
       profile_json = EXCLUDED.profile_json,
       updated_at = now()`,
    [projectId, flowType, JSON.stringify(profileJson)]
  );
}

export async function deleteQcFlowProfile(db: Pool, projectId: string, flowType: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.qc_flow_profiles WHERE project_id = $1 AND flow_type = $2`, [
    projectId,
    flowType,
  ]);
}
