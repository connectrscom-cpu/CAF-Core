import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface AssetInsert {
  asset_id?: string | null;
  task_id: string;
  project_id: string;
  asset_type?: string | null;
  asset_version?: string | null;
  bucket?: string | null;
  object_path?: string | null;
  public_url?: string | null;
  provider?: string | null;
  position?: number;
  metadata_json?: Record<string, unknown>;
}

export async function insertAsset(db: Pool, row: AssetInsert): Promise<{ id: string }> {
  const out = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.assets (
       asset_id, task_id, project_id, asset_type, asset_version, bucket, object_path,
       public_url, provider, position, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING id`,
    [
      row.asset_id ?? null,
      row.task_id,
      row.project_id,
      row.asset_type ?? null,
      row.asset_version ?? null,
      row.bucket ?? null,
      row.object_path ?? null,
      row.public_url ?? null,
      row.provider ?? null,
      row.position ?? 0,
      JSON.stringify(row.metadata_json ?? {}),
    ]
  );
  if (!out) throw new Error("insert asset failed");
  return out;
}

export async function listAssetsByTask(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<Array<{
  id: string;
  asset_type: string | null;
  public_url: string | null;
  bucket: string | null;
  object_path: string | null;
  position: number;
}>> {
  return q(
    db,
    `SELECT id, asset_type, public_url, bucket, object_path, position
     FROM caf_core.assets WHERE project_id = $1 AND task_id = $2 ORDER BY position ASC, created_at ASC`,
    [projectId, taskId]
  );
}

export async function deleteAssetsForTask(db: Pool, projectId: string, taskId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.assets WHERE project_id = $1 AND task_id = $2`, [projectId, taskId]);
}

/** Re-render carousel finals without dropping Qwen background plates (`MIMIC_BACKGROUND`). */
export async function deleteCarouselSlideAssetsForTask(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<void> {
  await db.query(
    `DELETE FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND UPPER(COALESCE(asset_type, '')) = 'CAROUSEL_SLIDE'`,
    [projectId, taskId]
  );
}

/** Drop only carousel slide PNGs at the given 1-based slide indices (partial rework). */
export async function deleteCarouselSlideAssetsAtPositions(
  db: Pool,
  projectId: string,
  taskId: string,
  slideIndices1Based: number[]
): Promise<void> {
  const positions = slideIndices1Based
    .map((i) => Math.floor(i) - 1)
    .filter((p) => Number.isFinite(p) && p >= 0);
  if (positions.length === 0) return;
  await db.query(
    `DELETE FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND UPPER(COALESCE(asset_type, '')) = 'CAROUSEL_SLIDE'
       AND position = ANY($3::int[])`,
    [projectId, taskId, positions]
  );
}

/** Drop stored art-only plates so Flux/Qwen regen cannot reuse a text-baked plate. */
export async function deleteMimicVisualPlateAssetsAtPositions(
  db: Pool,
  projectId: string,
  taskId: string,
  slideIndices1Based: number[]
): Promise<void> {
  const positions = slideIndices1Based
    .map((i) => Math.floor(i) - 1)
    .filter((p) => Number.isFinite(p) && p >= 0);
  if (positions.length === 0) return;
  await db.query(
    `DELETE FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND UPPER(COALESCE(asset_type, '')) = 'MIMIC_VISUAL_PLATE'
       AND position = ANY($3::int[])`,
    [projectId, taskId, positions]
  );
}

/** Drop background extract plates at asset positions (cover=0, shared body=1, cta=last, or per-slide). */
export async function deleteMimicBackgroundAssetsAtPositions(
  db: Pool,
  projectId: string,
  taskId: string,
  assetPositions: number[]
): Promise<void> {
  const positions = [...new Set(assetPositions.map((p) => Math.floor(p)).filter((p) => Number.isFinite(p) && p >= 0))];
  if (positions.length === 0) return;
  await db.query(
    `DELETE FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND UPPER(COALESCE(asset_type, '')) = 'MIMIC_BACKGROUND'
       AND position = ANY($3::int[])`,
    [projectId, taskId, positions]
  );
}
