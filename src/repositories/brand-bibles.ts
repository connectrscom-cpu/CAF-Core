import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface BrandBibleRow {
  id: string;
  project_id: string;
  version: number;
  is_active: boolean;
  label: string | null;
  bible_json: unknown;
  created_at: string;
}

const SELECT_COLS = `id::text, project_id::text, version, is_active, label, bible_json, created_at::text`;

export async function getActiveBrandBible(db: Pool, projectId: string): Promise<BrandBibleRow | null> {
  return qOne<BrandBibleRow>(
    db,
    `SELECT ${SELECT_COLS}
       FROM caf_core.brand_bibles
      WHERE project_id = $1 AND is_active = true
      ORDER BY version DESC
      LIMIT 1`,
    [projectId]
  );
}

export async function listBrandBibleVersions(db: Pool, projectId: string): Promise<BrandBibleRow[]> {
  return q<BrandBibleRow>(
    db,
    `SELECT ${SELECT_COLS}
       FROM caf_core.brand_bibles
      WHERE project_id = $1
      ORDER BY version DESC`,
    [projectId]
  );
}

export async function insertBrandBibleVersion(
  db: Pool,
  projectId: string,
  bibleJson: Record<string, unknown>,
  label: string | null
): Promise<BrandBibleRow> {
  const inserted = await qOne<BrandBibleRow>(
    db,
    `INSERT INTO caf_core.brand_bibles (project_id, version, is_active, label, bible_json)
     VALUES (
       $1,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM caf_core.brand_bibles WHERE project_id = $1),
       true,
       $2,
       $3::jsonb
     )
     RETURNING ${SELECT_COLS}`,
    [projectId, label, JSON.stringify(bibleJson)]
  );
  if (!inserted) throw new Error("insertBrandBibleVersion failed");
  await db.query(
    `UPDATE caf_core.brand_bibles SET is_active = false WHERE project_id = $1 AND id <> $2`,
    [projectId, inserted.id]
  );
  return inserted;
}
