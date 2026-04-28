import type { Pool } from "pg";
import { q } from "../db/queries.js";

export async function replaceSignalPackIdeas(
  db: Pool,
  params: {
    project_id: string;
    signal_pack_id: string;
    idea_row_ids_ordered: string[];
  }
): Promise<void> {
  const ids = (params.idea_row_ids_ordered ?? []).map((x) => String(x).trim()).filter(Boolean);
  await db.query(`DELETE FROM caf_core.signal_pack_ideas WHERE signal_pack_id = $1::uuid`, [
    params.signal_pack_id,
  ]);
  if (ids.length === 0) return;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (let i = 0; i < ids.length; i++) {
    ph.push(`($${p++}::uuid,$${p++}::uuid,$${p++}::uuid,$${p++})`);
    values.push(params.project_id, params.signal_pack_id, ids[i]!, i);
  }
  await db.query(
    `INSERT INTO caf_core.signal_pack_ideas (project_id, signal_pack_id, idea_row_id, position)
     VALUES ${ph.join(", ")}
     ON CONFLICT (signal_pack_id, idea_row_id) DO UPDATE SET position = EXCLUDED.position`,
    values
  );
}

export async function replaceSignalPackSelectedIdeas(
  db: Pool,
  params: {
    project_id: string;
    signal_pack_id: string;
    selected_idea_row_ids_ordered: string[];
  }
): Promise<void> {
  const ids = (params.selected_idea_row_ids_ordered ?? []).map((x) => String(x).trim()).filter(Boolean);
  await db.query(`DELETE FROM caf_core.signal_pack_selected_ideas WHERE signal_pack_id = $1::uuid`, [
    params.signal_pack_id,
  ]);
  if (ids.length === 0) return;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (let i = 0; i < ids.length; i++) {
    ph.push(`($${p++}::uuid,$${p++}::uuid,$${p++}::uuid,$${p++})`);
    values.push(params.project_id, params.signal_pack_id, ids[i]!, i);
  }
  await db.query(
    `INSERT INTO caf_core.signal_pack_selected_ideas (project_id, signal_pack_id, idea_row_id, position)
     VALUES ${ph.join(", ")}
     ON CONFLICT (signal_pack_id, idea_row_id) DO UPDATE SET position = EXCLUDED.position`,
    values
  );
}

export async function listSignalPackSelectedIdeaIds(
  db: Pool,
  params: { project_id: string; signal_pack_id: string }
): Promise<string[]> {
  const rows = await q<{ idea_id: string }>(
    db,
    `SELECT i.idea_id
       FROM caf_core.signal_pack_selected_ideas s
       JOIN caf_core.ideas i ON i.id = s.idea_row_id
      WHERE s.project_id = $1 AND s.signal_pack_id = $2
      ORDER BY s.position ASC`,
    [params.project_id, params.signal_pack_id]
  );
  return rows.map((r) => r.idea_id);
}

