import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type IntegrationPlatform =
  | "META_IG"
  | "META_FB"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN"
  | "X"
  | "OTHER";

export interface ProjectIntegrationRow {
  id: string;
  project_id: string;
  platform: string;
  display_name: string | null;
  is_enabled: boolean;
  account_ids_json: Record<string, unknown>;
  credentials_json: Record<string, unknown>;
  config_json: Record<string, unknown>;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function listProjectIntegrations(
  db: Pool,
  projectId: string
): Promise<ProjectIntegrationRow[]> {
  return q<ProjectIntegrationRow>(
    db,
    `SELECT id, project_id, platform, display_name, is_enabled,
            account_ids_json, credentials_json, config_json,
            last_tested_at, last_error, created_at, updated_at
     FROM caf_core.project_integrations
     WHERE project_id = $1::uuid
     ORDER BY platform ASC`,
    [projectId]
  );
}

export async function getProjectIntegration(
  db: Pool,
  projectId: string,
  platform: string
): Promise<ProjectIntegrationRow | null> {
  return qOne<ProjectIntegrationRow>(
    db,
    `SELECT id, project_id, platform, display_name, is_enabled,
            account_ids_json, credentials_json, config_json,
            last_tested_at, last_error, created_at, updated_at
     FROM caf_core.project_integrations
     WHERE project_id = $1::uuid AND platform = $2
     LIMIT 1`,
    [projectId, platform.trim()]
  );
}

export interface UpsertProjectIntegrationInput {
  project_id: string;
  platform: string;
  display_name?: string | null;
  is_enabled?: boolean;
  account_ids_json?: Record<string, unknown>;
  credentials_json?: Record<string, unknown>;
  config_json?: Record<string, unknown>;
}

export async function upsertProjectIntegration(
  db: Pool,
  row: UpsertProjectIntegrationInput
): Promise<ProjectIntegrationRow | null> {
  const platform = row.platform.trim();
  return qOne<ProjectIntegrationRow>(
    db,
    `INSERT INTO caf_core.project_integrations (
       project_id, platform, display_name, is_enabled,
       account_ids_json, credentials_json, config_json
     ) VALUES ($1::uuid,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
     ON CONFLICT (project_id, platform) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       is_enabled = EXCLUDED.is_enabled,
       account_ids_json = EXCLUDED.account_ids_json,
       credentials_json = EXCLUDED.credentials_json,
       config_json = EXCLUDED.config_json,
       updated_at = now()
     RETURNING id, project_id, platform, display_name, is_enabled,
               account_ids_json, credentials_json, config_json,
               last_tested_at, last_error, created_at, updated_at`,
    [
      row.project_id,
      platform,
      row.display_name ?? null,
      row.is_enabled ?? true,
      JSON.stringify(row.account_ids_json ?? {}),
      JSON.stringify(row.credentials_json ?? {}),
      JSON.stringify(row.config_json ?? {}),
    ]
  );
}

export async function deleteProjectIntegration(
  db: Pool,
  projectId: string,
  platform: string
): Promise<{ deleted: number }> {
  const res = await db.query(
    `DELETE FROM caf_core.project_integrations WHERE project_id = $1::uuid AND platform = $2`,
    [projectId, platform.trim()]
  );
  return { deleted: res.rowCount ?? 0 };
}

export async function markIntegrationTestResult(
  db: Pool,
  projectId: string,
  platform: string,
  result: { ok: boolean; error?: string | null }
): Promise<ProjectIntegrationRow | null> {
  const err = result.ok ? null : (result.error ?? "test_failed");
  return qOne<ProjectIntegrationRow>(
    db,
    `UPDATE caf_core.project_integrations
     SET last_tested_at = now(),
         last_error = $3,
         updated_at = now()
     WHERE project_id = $1::uuid AND platform = $2
     RETURNING id, project_id, platform, display_name, is_enabled,
               account_ids_json, credentials_json, config_json,
               last_tested_at, last_error, created_at, updated_at`,
    [projectId, platform.trim(), err]
  );
}

