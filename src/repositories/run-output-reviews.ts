import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface RunOutputReviewRow {
  id: string;
  project_id: string;
  run_id: string;
  body: string;
  validator: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_BODY = 32_000;

export async function getRunOutputReview(
  db: Pool,
  projectId: string,
  runIdText: string
): Promise<RunOutputReviewRow | null> {
  return qOne<RunOutputReviewRow>(
    db,
    `SELECT * FROM caf_core.run_output_reviews WHERE project_id = $1 AND run_id = $2`,
    [projectId, runIdText]
  );
}

/** Persists review text, or clears the row when `body` is empty after trim. */
export async function upsertRunOutputReview(
  db: Pool,
  row: { project_id: string; run_id: string; body: string; validator?: string | null }
): Promise<RunOutputReviewRow | null> {
  const body = row.body.trim().slice(0, MAX_BODY);
  if (!body) {
    await db.query(`DELETE FROM caf_core.run_output_reviews WHERE project_id = $1 AND run_id = $2`, [
      row.project_id,
      row.run_id,
    ]);
    return null;
  }
  const out = await qOne<RunOutputReviewRow>(
    db,
    `INSERT INTO caf_core.run_output_reviews (project_id, run_id, body, validator, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (project_id, run_id) DO UPDATE SET
       body = EXCLUDED.body,
       validator = EXCLUDED.validator,
       updated_at = now()
     RETURNING *`,
    [row.project_id, row.run_id, body, row.validator?.trim() || null]
  );
  if (!out) throw new Error("upsert_failed");
  return out;
}

/** Reviews touched in the editorial analysis window (by updated_at). */
export async function listRunOutputReviewsForEditorialWindow(
  db: Pool,
  projectId: string,
  sinceIso: string
): Promise<RunOutputReviewRow[]> {
  return q<RunOutputReviewRow>(
    db,
    `SELECT * FROM caf_core.run_output_reviews
     WHERE project_id = $1 AND updated_at >= $2::timestamptz
     ORDER BY updated_at DESC`,
    [projectId, sinceIso]
  );
}
