/**
 * Computes aggregate + row-level health for an inputs evidence import (no LLM).
 */
import type { Pool } from "pg";
import { getImportEvidenceStats } from "../repositories/inputs-evidence.js";
import { qOne } from "../db/queries.js";

export type InputHealthStatus = "ok" | "warn" | "block";

export interface InputHealthResult {
  status: InputHealthStatus;
  codes: string[];
  details: Record<string, unknown>;
}

function sheetStatsFromImport(sheetStatsJson: Record<string, unknown>): Array<{
  sheet_name?: string;
  row_count?: number;
  truncated?: boolean;
}> {
  const sheets = sheetStatsJson.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets as Array<{ sheet_name?: string; row_count?: number; truncated?: boolean }>;
}

export async function computeInputHealth(
  db: Pool,
  projectId: string,
  importId: string,
  sheetStatsJson: Record<string, unknown>
): Promise<InputHealthResult> {
  const stats = await getImportEvidenceStats(db, projectId, importId);
  const codes: string[] = [];
  const details: Record<string, unknown> = { stats, sheets: sheetStatsFromImport(sheetStatsJson) };

  if (stats.total_rows === 0) {
    codes.push("NO_ROWS");
    return { status: "block", codes, details };
  }

  if (stats.total_rows < 5) {
    codes.push("VERY_FEW_ROWS");
  }

  const sheets = sheetStatsFromImport(sheetStatsJson);
  const emptySheets = sheets.filter((s) => (s.row_count ?? 0) === 0).map((s) => s.sheet_name);
  if (emptySheets.length > 0) {
    codes.push("EMPTY_SHEETS");
    (details as Record<string, unknown>).empty_sheets = emptySheets;
  }

  const truncated = sheets.filter((s) => s.truncated).map((s) => s.sheet_name);
  if (truncated.length > 0) {
    codes.push("SHEET_TRUNCATED");
    (details as Record<string, unknown>).truncated_sheets = truncated;
  }

  const social =
    (stats.by_kind.reddit_post ?? 0) +
    (stats.by_kind.tiktok_video ?? 0) +
    (stats.by_kind.instagram_post ?? 0);
  if (social === 0 && (stats.by_kind.scraped_page ?? 0) === 0) {
    codes.push("NO_SOCIAL_OR_SCRAPED");
  }

  const dupRow = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n FROM (
       SELECT dedupe_key FROM caf_core.inputs_evidence_rows
        WHERE import_id = $1 AND project_id = $2 AND dedupe_key IS NOT NULL
        GROUP BY dedupe_key HAVING COUNT(*) > 1
     ) t`,
    [importId, projectId]
  );
  const dupGroups = parseInt(dupRow?.n ?? "0", 10) || 0;
  if (dupGroups > 0) {
    codes.push("DUPLICATE_DEDUPE_KEYS");
    (details as Record<string, unknown>).duplicate_dedupe_key_groups = dupGroups;
  }

  let status: InputHealthStatus = "ok";
  if (codes.includes("NO_ROWS")) status = "block";
  else if (codes.length > 0) status = "warn";

  return { status, codes, details };
}

export async function persistImportHealth(
  db: Pool,
  projectId: string,
  importId: string,
  result: InputHealthResult
): Promise<void> {
  await db.query(
    `UPDATE caf_core.inputs_evidence_imports
        SET input_health_status = $3,
            input_health_json = $4::jsonb,
            health_computed_at = now()
      WHERE id = $1 AND project_id = $2`,
    [importId, projectId, result.status, JSON.stringify({ codes: result.codes, details: result.details })]
  );
}

/** Mark rows with empty primary text (scraped / reddit) for forensics. */
export async function flagSparseEvidenceRows(db: Pool, projectId: string, importId: string): Promise<number> {
  const r = await db.query(
    `UPDATE caf_core.inputs_evidence_rows
        SET health_code = 'EMPTY_PRIMARY_TEXT',
            health_json = jsonb_build_object('reason', 'No title/body/caption text in payload')
      WHERE import_id = $1 AND project_id = $2
        AND evidence_kind IN ('scraped_page', 'reddit_post', 'tiktok_video', 'instagram_post')
        AND length(trim(
             coalesce(payload_json->>'title','') ||
             coalesce(payload_json->>'body_text','') ||
             coalesce(payload_json->>'main_text','') ||
             coalesce(payload_json->>'caption','')
           )) < 3`,
    [importId, projectId]
  );
  return r.rowCount ?? 0;
}
