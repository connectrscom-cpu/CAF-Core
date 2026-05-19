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
): Promise<string[]> {
  if (batch.length === 0) return [];
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
  const r = await db.query<{ id: string }>(
    `INSERT INTO caf_core.inputs_evidence_rows
      (import_id, project_id, sheet_name, row_index, evidence_kind, dedupe_key, payload_json)
     VALUES ${ph.join(", ")}
     RETURNING id::text AS id`,
    values
  );
  return r.rows.map((row) => row.id);
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

/** Rating fields for batching performance-review snapshots onto top-performer insights. */
export async function listEvidenceRowRatingFieldsByIds(
  db: Pool,
  projectId: string,
  importId: string,
  rowIds: string[]
): Promise<EvidenceRowWithRating[]> {
  const ids = rowIds.map((x) => String(x).trim()).filter(Boolean).slice(0, 2000);
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

/**
 * Row ids in the top `fraction` of **rated** evidence rows (`rating_score` DESC).
 * Uses `ceil(rated_count * fraction)` with a minimum of 1 when any rated rows exist.
 * Used to scope expensive top-performer vision passes to high performers from the insights valuation pass.
 */
/** All `rating_score` values for an import (for top-percentile selection). */
export async function listEvidenceRowRatingScoreMap(
  db: Pool,
  projectId: string,
  importId: string
): Promise<Map<string, number>> {
  const rows = await q<{ id: string; rating_score: string }>(
    db,
    `SELECT id::text AS id, rating_score::text AS rating_score
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND rating_score IS NOT NULL`,
    [importId, projectId]
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    const n = parseFloat(r.rating_score);
    if (Number.isFinite(n)) map.set(r.id, n);
  }
  return map;
}

export async function countRatedEvidenceRows(
  db: Pool,
  projectId: string,
  importId: string
): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND rating_score IS NOT NULL`,
    [importId, projectId]
  );
  return parseInt(row?.n ?? "0", 10) || 0;
}

export async function listTopFractionRatedEvidenceRowIds(
  db: Pool,
  projectId: string,
  importId: string,
  fraction: number
): Promise<{ ids: Set<string>; rated_count: number; limit_k: number }> {
  const f = Math.min(Math.max(fraction, 0.0001), 0.5);
  const cntRow = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND rating_score IS NOT NULL`,
    [importId, projectId]
  );
  const n = parseInt(cntRow?.n ?? "0", 10);
  if (n <= 0) {
    return { ids: new Set(), rated_count: 0, limit_k: 0 };
  }
  const k = Math.max(1, Math.ceil(n * f));
  const rows = await q<{ id: string }>(
    db,
    `SELECT id::text AS id
       FROM caf_core.inputs_evidence_rows
      WHERE import_id = $1 AND project_id = $2 AND rating_score IS NOT NULL
      ORDER BY rating_score DESC NULLS LAST, id ASC
      LIMIT $3`,
    [importId, projectId, k]
  );
  return { ids: new Set(rows.map((r) => r.id)), rated_count: n, limit_k: k };
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

export interface EvidenceRowForReadModel {
  id: string;
  import_id: string;
  evidence_kind: string;
  payload_json: Record<string, unknown>;
  created_at: string;
  rating_score: string | null;
}

function readModelOrderClause(sort: string): string {
  switch (sort) {
    case "rating_asc":
      return "r.rating_score ASC NULLS LAST, r.id ASC";
    case "created_asc":
      return "r.created_at ASC, r.id ASC";
    case "created_desc":
      return "r.created_at DESC, r.id DESC";
    case "rating_desc":
    default:
      return "r.rating_score DESC NULLS LAST, r.id DESC";
  }
}

/**
 * Paginated evidence rows for operator read-model APIs (search + optional rating floor + kind filter).
 */
export async function listEvidenceRowsForReadModel(
  db: Pool,
  projectId: string,
  importId: string,
  opts: {
    evidence_kind: string | null;
    search: string | null;
    min_rating: number | null;
    sort: string;
    limit: number;
    offset: number;
  }
): Promise<EvidenceRowForReadModel[]> {
  const lim = Math.min(Math.max(opts.limit, 1), 200);
  const off = Math.max(opts.offset, 0);
  const orderSql = readModelOrderClause(opts.sort);
  const kind = opts.evidence_kind?.trim() || null;
  const search = opts.search?.trim() || null;
  const minR = opts.min_rating;

  const params: unknown[] = [importId, projectId];
  const where: string[] = ["r.import_id = $1", "r.project_id = $2"];
  let p = 3;
  if (kind) {
    where.push(`r.evidence_kind = $${p++}`);
    params.push(kind);
  }
  if (minR != null && Number.isFinite(minR)) {
    where.push(`r.rating_score IS NOT NULL AND r.rating_score >= $${p++}`);
    params.push(minR);
  }
  if (search) {
    const pat = `%${search.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const sp = p++;
    where.push(`(r.payload_json::text ILIKE $${sp} OR COALESCE(r.dedupe_key,'') ILIKE $${sp})`);
    params.push(pat);
  }
  params.push(lim, off);
  const limPh = `$${p++}`;
  const offPh = `$${p++}`;
  return q(
    db,
    `SELECT r.id::text, r.import_id::text, r.evidence_kind, r.payload_json, r.created_at::text, r.rating_score::text
       FROM caf_core.inputs_evidence_rows r
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderSql}
      LIMIT ${limPh} OFFSET ${offPh}`,
    params
  );
}

export async function countEvidenceRowsForReadModel(
  db: Pool,
  projectId: string,
  importId: string,
  opts: { evidence_kind: string | null; search: string | null; min_rating: number | null }
): Promise<number> {
  const kind = opts.evidence_kind?.trim() || null;
  const search = opts.search?.trim() || null;
  const minR = opts.min_rating;
  const params: unknown[] = [importId, projectId];
  const where: string[] = ["r.import_id = $1", "r.project_id = $2"];
  let p = 3;
  if (kind) {
    where.push(`r.evidence_kind = $${p++}`);
    params.push(kind);
  }
  if (minR != null && Number.isFinite(minR)) {
    where.push(`r.rating_score IS NOT NULL AND r.rating_score >= $${p++}`);
    params.push(minR);
  }
  if (search) {
    const pat = `%${search.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const sp = p++;
    where.push(`(r.payload_json::text ILIKE $${sp} OR COALESCE(r.dedupe_key,'') ILIKE $${sp})`);
    params.push(pat);
  }
  const row = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n
       FROM caf_core.inputs_evidence_rows r
      WHERE ${where.join(" AND ")}`,
    params
  );
  return parseInt(row?.n ?? "0", 10) || 0;
}

export async function getEvidenceRowByIdForProject(
  db: Pool,
  projectId: string,
  rowId: string
): Promise<EvidenceRowForReadModel | null> {
  const rid = String(rowId ?? "").trim();
  if (!/^\d+$/.test(rid)) return null;
  return qOne(
    db,
    `SELECT r.id::text, r.import_id::text, r.evidence_kind, r.payload_json, r.created_at::text, r.rating_score::text
       FROM caf_core.inputs_evidence_rows r
      WHERE r.project_id = $1 AND r.id = $2::bigint`,
    [projectId, rid]
  );
}

/** Operator-saved cutoff + funnel counts (merged into `selection_snapshot_json.operator_cutoff_ui`). */
export async function mergeOperatorCutoffUiIntoImportSnapshot(
  db: Pool,
  projectId: string,
  importId: string,
  evidenceKind: string,
  snapshot: {
    min_score_cutoff: number;
    profile_min_score: number;
    totals: Record<string, number>;
    active_weights?: Record<string, number> | null;
  }
): Promise<void> {
  const row = await getInputsEvidenceImport(db, projectId, importId);
  if (!row) throw new Error("import not found");
  const cur =
    row.selection_snapshot_json != null && typeof row.selection_snapshot_json === "object" && !Array.isArray(row.selection_snapshot_json)
      ? ({ ...row.selection_snapshot_json } as Record<string, unknown>)
      : {};
  const prevUi =
    cur.operator_cutoff_ui != null && typeof cur.operator_cutoff_ui === "object" && !Array.isArray(cur.operator_cutoff_ui)
      ? ({ ...cur.operator_cutoff_ui } as Record<string, unknown>)
      : {};
  const perKindRaw =
    prevUi.per_kind != null && typeof prevUi.per_kind === "object" && !Array.isArray(prevUi.per_kind)
      ? ({ ...prevUi.per_kind } as Record<string, unknown>)
      : {};
  const kind = String(evidenceKind ?? "").trim();
  if (!kind) throw new Error("evidence_kind required");
  perKindRaw[kind] = {
    saved_at: new Date().toISOString(),
    min_score_cutoff: snapshot.min_score_cutoff,
    profile_min_score: snapshot.profile_min_score,
    totals: snapshot.totals,
    active_weights: snapshot.active_weights ?? null,
  };
  prevUi.per_kind = perKindRaw;
  cur.operator_cutoff_ui = prevUi;
  await db.query(
    `UPDATE caf_core.inputs_evidence_imports
        SET selection_snapshot_json = $3::jsonb
      WHERE id = $1::uuid AND project_id = $2`,
    [importId, projectId, JSON.stringify(cur)]
  );
}
