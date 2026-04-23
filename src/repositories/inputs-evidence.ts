import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface InputsEvidenceImportRow {
  id: string;
  project_id: string;
  upload_filename: string | null;
  workbook_sha256: string | null;
  sheet_stats_json: Record<string, unknown>;
  notes: string | null;
  input_health_status?: string | null;
  input_health_json?: Record<string, unknown>;
  selection_snapshot_json?: Record<string, unknown> | null;
  health_computed_at?: string | null;
  created_at: string;
}

export interface EvidenceRowListItem {
  id: string;
  sheet_name: string;
  row_index: number;
  evidence_kind: string;
  dedupe_key: string | null;
  payload_json: Record<string, unknown>;
}

export async function insertInputsEvidenceImport(
  db: Pool,
  data: {
    project_id: string;
    upload_filename: string | null;
    workbook_sha256: string | null;
    sheet_stats_json: Record<string, unknown>;
    notes: string | null;
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.inputs_evidence_imports
      (project_id, upload_filename, workbook_sha256, sheet_stats_json, notes)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [
      data.project_id,
      data.upload_filename,
      data.workbook_sha256,
      JSON.stringify(data.sheet_stats_json),
      data.notes,
    ]
  );
  if (!row) throw new Error("insertInputsEvidenceImport failed");
  return row;
}

export async function insertInputsEvidenceRowsBatch(
  db: Pool,
  projectId: string,
  importId: string,
  batch: Array<{
    sheet_name: string;
    row_index: number;
    evidence_kind: string;
    dedupe_key: string | null;
    payload_json: Record<string, unknown>;
  }>
): Promise<void> {
  if (batch.length === 0) return;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (const r of batch) {
    ph.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb)`);
    values.push(
      importId,
      projectId,
      r.sheet_name,
      r.row_index,
      r.evidence_kind,
      r.dedupe_key,
      JSON.stringify(r.payload_json)
    );
  }
  await db.query(
    `INSERT INTO caf_core.inputs_evidence_rows
      (import_id, project_id, sheet_name, row_index, evidence_kind, dedupe_key, payload_json)
     VALUES ${ph.join(", ")}`,
    values
  );
}

export async function listInputsEvidenceImports(
  db: Pool,
  projectId: string,
  limit: number,
  offset: number
): Promise<Array<InputsEvidenceImportRow & { stored_row_count: string }>> {
  return q(
    db,
    `SELECT i.*,
            (SELECT COUNT(*)::text FROM caf_core.inputs_evidence_rows r WHERE r.import_id = i.id) AS stored_row_count
       FROM caf_core.inputs_evidence_imports i
      WHERE i.project_id = $1
      ORDER BY i.created_at DESC
      LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );
}

export async function getInputsEvidenceImport(
  db: Pool,
  projectId: string,
  importId: string
): Promise<(InputsEvidenceImportRow & { stored_row_count: string }) | null> {
  return qOne(
    db,
    `SELECT i.*,
            (SELECT COUNT(*)::text FROM caf_core.inputs_evidence_rows r WHERE r.import_id = i.id) AS stored_row_count
       FROM caf_core.inputs_evidence_imports i
      WHERE i.id = $1 AND i.project_id = $2`,
    [importId, projectId]
  );
}

export async function sheetRowCountsForImport(db: Pool, importId: string): Promise<Array<{ sheet_name: string; cnt: string }>> {
  return q(
    db,
    `SELECT sheet_name, COUNT(*)::text AS cnt
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1
      GROUP BY sheet_name
      ORDER BY sheet_name`,
    [importId]
  );
}

export interface EvidenceRowWithRating extends EvidenceRowListItem {
  rating_score: string | null;
  rating_components_json: Record<string, unknown> | null;
  rating_rationale: string | null;
  rated_at: string | null;
}

/** Rows prioritized for LLM rating (social + scraped first), capped. */
/** Fetch rows in the order of `ids` (for selection snapshot). */
export async function listEvidenceRowsByIds(
  db: Pool,
  projectId: string,
  importId: string,
  ids: string[]
): Promise<EvidenceRowWithRating[]> {
  if (ids.length === 0) return [];
  return q(
    db,
    `SELECT r.id::text, r.sheet_name, r.row_index, r.evidence_kind, r.dedupe_key, r.payload_json,
            r.rating_score::text, r.rating_components_json, r.rating_rationale, r.rated_at::text
       FROM caf_core.inputs_evidence_rows r
       INNER JOIN unnest($3::text[]) WITH ORDINALITY AS u(id, ord) ON r.id::text = u.id
      WHERE r.import_id = $1 AND r.project_id = $2
      ORDER BY u.ord`,
    [importId, projectId, ids]
  );
}

export async function listEvidenceRowsForRating(
  db: Pool,
  projectId: string,
  importId: string,
  limit: number
): Promise<EvidenceRowWithRating[]> {
  const lim = Math.min(Math.max(limit, 1), 5000);
  return q(
    db,
    `SELECT id::text, sheet_name, row_index, evidence_kind, dedupe_key, payload_json,
            rating_score::text, rating_components_json, rating_rationale, rated_at::text
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2
      ORDER BY
        CASE evidence_kind
          WHEN 'reddit_post' THEN 1
          WHEN 'tiktok_video' THEN 2
          WHEN 'instagram_post' THEN 3
          WHEN 'scraped_page' THEN 4
          WHEN 'html_summary' THEN 5
          ELSE 6
        END,
        row_index ASC
      LIMIT $3`,
    [importId, projectId, lim]
  );
}

export async function updateEvidenceRowRatingById(
  db: Pool,
  rowId: string,
  projectId: string,
  data: {
    rating_score: number;
    rating_components_json: Record<string, unknown>;
    rating_rationale: string | null;
  }
): Promise<number> {
  const r = await db.query(
    `UPDATE caf_core.inputs_evidence_rows
        SET rating_score = $3,
            rating_components_json = $4::jsonb,
            rating_rationale = $5,
            rated_at = now()
      WHERE id = $1::bigint AND project_id = $2`,
    [rowId, projectId, data.rating_score, JSON.stringify(data.rating_components_json), data.rating_rationale]
  );
  return r.rowCount ?? 0;
}

export async function listTopRatedRowsForSynth(
  db: Pool,
  projectId: string,
  importId: string,
  minScore: number,
  limit: number
): Promise<EvidenceRowWithRating[]> {
  return q(
    db,
    `SELECT id::text, sheet_name, row_index, evidence_kind, dedupe_key, payload_json,
            rating_score::text, rating_components_json, rating_rationale, rated_at::text
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2
        AND rating_score IS NOT NULL
        AND rating_score >= $3
      ORDER BY rating_score DESC, row_index ASC
      LIMIT $4`,
    [importId, projectId, minScore, limit]
  );
}

export async function listInputsEvidenceRows(
  db: Pool,
  projectId: string,
  importId: string,
  opts: { sheet_name?: string | null; limit: number; offset: number }
): Promise<EvidenceRowListItem[]> {
  const lim = Math.min(Math.max(opts.limit, 1), 500);
  const off = Math.max(opts.offset, 0);
  if (opts.sheet_name?.trim()) {
    return q(
      db,
      `SELECT id::text, sheet_name, row_index, evidence_kind, dedupe_key, payload_json
         FROM caf_core.inputs_evidence_rows
        WHERE import_id = $1 AND project_id = $2 AND sheet_name = $3
        ORDER BY row_index ASC
        LIMIT $4 OFFSET $5`,
      [importId, projectId, opts.sheet_name.trim(), lim, off]
    );
  }
  return q(
    db,
    `SELECT id::text, sheet_name, row_index, evidence_kind, dedupe_key, payload_json
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2
      ORDER BY sheet_name ASC, row_index ASC
      LIMIT $3 OFFSET $4`,
    [importId, projectId, lim, off]
  );
}

export interface ImportEvidenceStats {
  total_rows: number;
  by_kind: Record<string, number>;
  rated_rows: number;
  distinct_subreddits: number;
  distinct_tiktok_authors: number;
  distinct_ig_handles: number;
  distinct_scraped_sources: number;
  distinct_registry_links: number;
}

export async function getImportEvidenceStats(
  db: Pool,
  projectId: string,
  importId: string
): Promise<ImportEvidenceStats> {
  const total = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n FROM caf_core.inputs_evidence_rows WHERE import_id = $1 AND project_id = $2`,
    [importId, projectId]
  );
  const kinds = await q<{ evidence_kind: string; cnt: string }>(
    db,
    `SELECT evidence_kind, COUNT(*)::text AS cnt
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2
      GROUP BY evidence_kind`,
    [importId, projectId]
  );
  const rated = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND rating_score IS NOT NULL`,
    [importId, projectId]
  );
  const sub = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(DISTINCT NULLIF(trim(payload_json->>'subreddit'),''))::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND evidence_kind = 'reddit_post'`,
    [importId, projectId]
  );
  const tt = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(DISTINCT NULLIF(trim(payload_json->>'authorHandle'),''))::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND evidence_kind = 'tiktok_video'`,
    [importId, projectId]
  );
  const ig = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(DISTINCT NULLIF(trim(payload_json->>'account_handle'),''))::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND evidence_kind = 'instagram_post'`,
    [importId, projectId]
  );
  const sc = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(DISTINCT NULLIF(trim(payload_json->>'sourceName'),''))::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND evidence_kind = 'scraped_page'`,
    [importId, projectId]
  );
  const reg = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n FROM (
       SELECT DISTINCT COALESCE(
         NULLIF(trim(payload_json->>'Link'), ''),
         NULLIF(trim(payload_json->>'Facebook URL'), '')
       ) AS u
         FROM caf_core.inputs_evidence_rows
        WHERE import_id = $1 AND project_id = $2 AND evidence_kind = 'source_registry'
     ) x WHERE x.u IS NOT NULL`,
    [importId, projectId]
  );
  const by_kind: Record<string, number> = {};
  for (const k of kinds) {
    by_kind[k.evidence_kind] = parseInt(k.cnt, 10) || 0;
  }
  return {
    total_rows: parseInt(total?.n ?? "0", 10) || 0,
    by_kind,
    rated_rows: parseInt(rated?.n ?? "0", 10) || 0,
    distinct_subreddits: parseInt(sub?.n ?? "0", 10) || 0,
    distinct_tiktok_authors: parseInt(tt?.n ?? "0", 10) || 0,
    distinct_ig_handles: parseInt(ig?.n ?? "0", 10) || 0,
    distinct_scraped_sources: parseInt(sc?.n ?? "0", 10) || 0,
    distinct_registry_links: parseInt(reg?.n ?? "0", 10) || 0,
  };
}

/** Load rows for deterministic pre-LLM scoring (bounded for very large imports). */
export async function listEvidenceRowsForPreLlmScoring(
  db: Pool,
  projectId: string,
  importId: string,
  limit: number
): Promise<Array<{ id: string; evidence_kind: string; payload_json: Record<string, unknown> }>> {
  const lim = Math.min(Math.max(limit, 1), 20_000);
  return q(
    db,
    `SELECT id::text, evidence_kind, payload_json
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2
      ORDER BY evidence_kind ASC, sheet_name ASC, row_index ASC, id ASC
      LIMIT $3`,
    [importId, projectId, lim]
  );
}

/** All rows of one evidence_kind for an import (pre-LLM preview; bounded). */
export async function listEvidenceRowsByImportAndKind(
  db: Pool,
  projectId: string,
  importId: string,
  evidenceKind: string,
  maxRows: number
): Promise<Array<{ id: string; evidence_kind: string; payload_json: Record<string, unknown> }>> {
  const lim = Math.min(Math.max(maxRows, 1), 15_000);
  return q(
    db,
    `SELECT id::text, evidence_kind, payload_json
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND evidence_kind = $3
      ORDER BY id ASC
      LIMIT $4`,
    [importId, projectId, evidenceKind, lim]
  );
}
