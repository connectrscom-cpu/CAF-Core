import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

/** Canonical source tabs mirroring INPUTS workbook sheet names. */
export const INPUTS_SOURCE_TABS = [
  "all_sources",
  "websites_blogs",
  "igaccounts",
  "tiktokaccounts",
  "subreddits",
  "facebook",
  "linkedinaccounts",
  "linkedinsearches",
  "hashtags",
] as const;

export type InputsSourceTab = (typeof INPUTS_SOURCE_TABS)[number];

export interface InputsSourceRow {
  id: string;
  project_id: string;
  source_tab: string;
  row_index: number;
  enabled: boolean;
  payload_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScraperConfigRow {
  project_id: string;
  config_json: Record<string, unknown>;
  updated_at: string;
}

export interface ScraperRunRow {
  id: string;
  project_id: string;
  scraper_key: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  config_snapshot_json: Record<string, unknown>;
  stats_json: Record<string, unknown>;
  error_message: string | null;
  evidence_import_id: string | null;
  created_at: string;
}

export async function listSourceRows(
  db: Pool,
  projectId: string,
  sourceTab: string | null
): Promise<InputsSourceRow[]> {
  if (sourceTab?.trim()) {
    return q(
      db,
      `SELECT id::text, project_id::text, source_tab, row_index, enabled, payload_json,
              created_at::text, updated_at::text
         FROM caf_core.inputs_source_rows
        WHERE project_id = $1 AND source_tab = $2
        ORDER BY row_index ASC`,
      [projectId, sourceTab.trim()]
    );
  }
  return q(
    db,
    `SELECT id::text, project_id::text, source_tab, row_index, enabled, payload_json,
            created_at::text, updated_at::text
       FROM caf_core.inputs_source_rows
      WHERE project_id = $1
      ORDER BY source_tab ASC, row_index ASC`,
    [projectId]
  );
}

export async function replaceSourceTabRows(
  db: Pool,
  projectId: string,
  sourceTab: string,
  rows: Array<{ row_index: number; enabled: boolean; payload_json: Record<string, unknown> }>
): Promise<number> {
  await db.query(`DELETE FROM caf_core.inputs_source_rows WHERE project_id = $1 AND source_tab = $2`, [
    projectId,
    sourceTab,
  ]);
  if (rows.length === 0) return 0;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (const r of rows) {
    ph.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb)`);
    values.push(projectId, sourceTab, r.row_index, r.enabled, JSON.stringify(r.payload_json));
  }
  await db.query(
    `INSERT INTO caf_core.inputs_source_rows (project_id, source_tab, row_index, enabled, payload_json)
     VALUES ${ph.join(", ")}`,
    values
  );
  return rows.length;
}

export async function upsertSourceRow(
  db: Pool,
  projectId: string,
  sourceTab: string,
  rowIndex: number,
  data: { enabled: boolean; payload_json: Record<string, unknown> }
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.inputs_source_rows (project_id, source_tab, row_index, enabled, payload_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (project_id, source_tab, row_index)
     DO UPDATE SET enabled = EXCLUDED.enabled,
                   payload_json = EXCLUDED.payload_json,
                   updated_at = now()`,
    [projectId, sourceTab, rowIndex, data.enabled, JSON.stringify(data.payload_json)]
  );
}

export async function deleteSourceRow(db: Pool, projectId: string, rowId: string): Promise<number> {
  const r = await db.query(
    `DELETE FROM caf_core.inputs_source_rows WHERE id = $1::uuid AND project_id = $2`,
    [rowId, projectId]
  );
  return r.rowCount ?? 0;
}

export async function getScraperConfig(db: Pool, projectId: string): Promise<ScraperConfigRow | null> {
  return qOne(
    db,
    `SELECT project_id::text, config_json, updated_at::text
       FROM caf_core.inputs_scraper_config
      WHERE project_id = $1`,
    [projectId]
  );
}

export async function upsertScraperConfig(
  db: Pool,
  projectId: string,
  configJson: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.inputs_scraper_config (project_id, config_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (project_id)
     DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = now()`,
    [projectId, JSON.stringify(configJson)]
  );
}

export async function insertScraperRun(
  db: Pool,
  data: {
    project_id: string;
    scraper_key: string;
    config_snapshot_json: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.inputs_scraper_runs
      (project_id, scraper_key, status, config_snapshot_json)
     VALUES ($1, $2, 'pending', $3::jsonb)
     RETURNING id::text AS id`,
    [data.project_id, data.scraper_key, JSON.stringify(data.config_snapshot_json)]
  );
  if (!row) throw new Error("insertScraperRun failed");
  return row;
}

export async function updateScraperRun(
  db: Pool,
  runId: string,
  projectId: string,
  patch: {
    status?: string;
    started_at?: boolean;
    finished_at?: boolean;
    stats_json?: Record<string, unknown>;
    error_message?: string | null;
    evidence_import_id?: string | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [runId, projectId];
  let p = 3;
  if (patch.status != null) {
    sets.push(`status = $${p++}`);
    vals.push(patch.status);
  }
  if (patch.started_at) {
    sets.push(`started_at = now()`);
  }
  if (patch.finished_at) {
    sets.push(`finished_at = now()`);
  }
  if (patch.stats_json != null) {
    sets.push(`stats_json = $${p++}::jsonb`);
    vals.push(JSON.stringify(patch.stats_json));
  }
  if (patch.error_message !== undefined) {
    sets.push(`error_message = $${p++}`);
    vals.push(patch.error_message);
  }
  if (patch.evidence_import_id !== undefined) {
    sets.push(`evidence_import_id = $${p++}::uuid`);
    vals.push(patch.evidence_import_id);
  }
  if (sets.length === 0) return;
  await db.query(
    `UPDATE caf_core.inputs_scraper_runs SET ${sets.join(", ")} WHERE id = $1::uuid AND project_id = $2`,
    vals
  );
}

export async function listScraperRuns(
  db: Pool,
  projectId: string,
  limit: number
): Promise<ScraperRunRow[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  return q(
    db,
    `SELECT id::text, project_id::text, scraper_key, status,
            started_at::text, finished_at::text,
            config_snapshot_json, stats_json, error_message,
            evidence_import_id::text, created_at::text
       FROM caf_core.inputs_scraper_runs
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [projectId, lim]
  );
}

export async function listCompletedScraperRunsForPlatform(
  db: Pool,
  projectId: string,
  scraperKey: string,
  limit: number
): Promise<ScraperRunRow[]> {
  const lim = Math.min(Math.max(limit, 1), 50);
  return q(
    db,
    `SELECT id::text, project_id::text, scraper_key, status,
            started_at::text, finished_at::text,
            config_snapshot_json, stats_json, error_message,
            evidence_import_id::text, created_at::text
       FROM caf_core.inputs_scraper_runs
      WHERE project_id = $1
        AND scraper_key = $2
        AND status = 'completed'
        AND evidence_import_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $3`,
    [projectId, scraperKey, lim]
  );
}

export async function getScraperRun(
  db: Pool,
  projectId: string,
  runId: string
): Promise<ScraperRunRow | null> {
  return qOne(
    db,
    `SELECT id::text, project_id::text, scraper_key, status,
            started_at::text, finished_at::text,
            config_snapshot_json, stats_json, error_message,
            evidence_import_id::text, created_at::text
       FROM caf_core.inputs_scraper_runs
      WHERE id = $1::uuid AND project_id = $2`,
    [runId, projectId]
  );
}

/** Latest scraper run that produced this evidence import (for marketer research metadata). */
export async function getScraperRunForEvidenceImport(
  db: Pool,
  projectId: string,
  evidenceImportId: string
): Promise<ScraperRunRow | null> {
  return qOne(
    db,
    `SELECT id::text, project_id::text, scraper_key, status,
            started_at::text, finished_at::text,
            config_snapshot_json, stats_json, error_message,
            evidence_import_id::text, created_at::text
       FROM caf_core.inputs_scraper_runs
      WHERE project_id = $1 AND evidence_import_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [projectId, evidenceImportId]
  );
}
