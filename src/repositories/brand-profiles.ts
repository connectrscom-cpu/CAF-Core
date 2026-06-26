import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface BrandProfileRow {
  id: string;
  project_id: string;
  version: number;
  is_active: boolean;
  label: string | null;
  profile_json: unknown;
  created_at: string;
}

const SELECT_COLS = `id::text, project_id::text, version, is_active, label, profile_json, created_at::text`;

/** Active brand profile for a project (highest version), or null when none configured. */
export async function getActiveBrandProfile(db: Pool, projectId: string): Promise<BrandProfileRow | null> {
  return qOne<BrandProfileRow>(
    db,
    `SELECT ${SELECT_COLS}
       FROM caf_core.brand_profiles
      WHERE project_id = $1 AND is_active = true
      ORDER BY version DESC
      LIMIT 1`,
    [projectId]
  );
}

export async function listBrandProfileVersions(db: Pool, projectId: string): Promise<BrandProfileRow[]> {
  return q<BrandProfileRow>(
    db,
    `SELECT ${SELECT_COLS}
       FROM caf_core.brand_profiles
      WHERE project_id = $1
      ORDER BY version DESC`,
    [projectId]
  );
}

/** Insert a new active version (auto-incremented) and deactivate prior versions. */
export async function insertBrandProfileVersion(
  db: Pool,
  projectId: string,
  profileJson: Record<string, unknown>,
  label: string | null
): Promise<BrandProfileRow> {
  const inserted = await qOne<BrandProfileRow>(
    db,
    `INSERT INTO caf_core.brand_profiles (project_id, version, is_active, label, profile_json)
     VALUES (
       $1,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM caf_core.brand_profiles WHERE project_id = $1),
       true,
       $2,
       $3::jsonb
     )
     RETURNING ${SELECT_COLS}`,
    [projectId, label, JSON.stringify(profileJson)]
  );
  if (!inserted) throw new Error("insertBrandProfileVersion failed");
  await db.query(
    `UPDATE caf_core.brand_profiles SET is_active = false WHERE project_id = $1 AND id <> $2`,
    [projectId, inserted.id]
  );
  return inserted;
}
