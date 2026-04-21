/**
 * Deterministic shortlist of evidence row ids before LLM rating (caps per kind).
 */
import type { Pool } from "pg";
import { q } from "../db/queries.js";

export const SELECTION_RULE_VERSION = "v1";

export interface SelectionCaps {
  reddit_post: number;
  tiktok_video: number;
  instagram_post: number;
  scraped_page: number;
  html_summary: number;
  source_registry: number;
  default_kind: number;
}

export const DEFAULT_SELECTION_CAPS: SelectionCaps = {
  reddit_post: 120,
  tiktok_video: 80,
  instagram_post: 80,
  scraped_page: 200,
  html_summary: 200,
  source_registry: 150,
  default_kind: 80,
};

function capFor(kind: string, caps: SelectionCaps): number {
  const k = kind as keyof SelectionCaps;
  if (k in caps) return caps[k]!;
  return caps.default_kind;
}

export interface SelectionSnapshot {
  rule_version: string;
  caps: SelectionCaps;
  selected_row_ids: string[];
  stats: { total_in_import: number; selected: number; by_kind: Record<string, number> };
}

/**
 * Walk rows in DB order (same as rating priority) and take up to per-kind caps.
 */
export async function buildSelectionSnapshotForImport(
  db: Pool,
  projectId: string,
  importId: string,
  caps: SelectionCaps = DEFAULT_SELECTION_CAPS
): Promise<SelectionSnapshot> {
  const rows = await q<{ id: string; evidence_kind: string }>(
    db,
    `SELECT id::text, evidence_kind
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
        row_index ASC`,
    [importId, projectId]
  );

  const perKind: Record<string, number> = {};
  const selected: string[] = [];
  for (const r of rows) {
    const c = capFor(r.evidence_kind, caps);
    const n = perKind[r.evidence_kind] ?? 0;
    if (n >= c) continue;
    perKind[r.evidence_kind] = n + 1;
    selected.push(r.id);
  }

  const by_kind: Record<string, number> = {};
  for (const id of selected) {
    const row = rows.find((x) => x.id === id);
    if (!row) continue;
    by_kind[row.evidence_kind] = (by_kind[row.evidence_kind] ?? 0) + 1;
  }

  return {
    rule_version: SELECTION_RULE_VERSION,
    caps,
    selected_row_ids: selected,
    stats: { total_in_import: rows.length, selected: selected.length, by_kind },
  };
}

export async function persistSelectionSnapshot(
  db: Pool,
  projectId: string,
  importId: string,
  snapshot: SelectionSnapshot
): Promise<void> {
  await db.query(
    `UPDATE caf_core.inputs_evidence_imports
        SET selection_snapshot_json = $3::jsonb
      WHERE id = $1 AND project_id = $2`,
    [importId, projectId, JSON.stringify(snapshot)]
  );
}
