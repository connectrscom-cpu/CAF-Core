import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface InputsIdeaListRow {
  id: string;
  project_id: string;
  inputs_import_id: string;
  title: string | null;
  params_json: unknown;
  derived_globals_json: unknown;
  created_at: string;
}

export interface InputsIdeaRow {
  id: string;
  project_id: string;
  idea_list_id: string;
  idea_id: string;
  platform: string | null;
  confidence_score: string | null;
  idea_json: unknown;
  created_at: string;
}

export async function insertInputsIdeaList(
  db: Pool,
  data: {
    project_id: string;
    inputs_import_id: string;
    title?: string | null;
    params_json?: Record<string, unknown>;
    derived_globals_json?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.inputs_idea_lists (
       project_id, inputs_import_id, title, params_json, derived_globals_json
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
     RETURNING id::text`,
    [
      data.project_id,
      data.inputs_import_id,
      data.title ?? null,
      JSON.stringify(data.params_json ?? {}),
      JSON.stringify(data.derived_globals_json ?? {}),
    ]
  );
  if (!row) throw new Error("insertInputsIdeaList failed");
  return row;
}

export async function bulkInsertInputsIdeas(
  db: Pool,
  data: {
    project_id: string;
    idea_list_id: string;
    ideas: Array<{
      idea_id: string;
      platform?: string | null;
      confidence_score?: number | null;
      idea_json: Record<string, unknown>;
    }>;
  }
): Promise<number> {
  if (data.ideas.length === 0) return 0;
  const values: unknown[] = [];
  const chunks: string[] = [];
  let idx = 1;
  for (const i of data.ideas) {
    chunks.push(
      `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++}::jsonb)`
    );
    values.push(
      data.project_id,
      data.idea_list_id,
      i.idea_id,
      i.platform ?? null,
      i.confidence_score ?? null,
      JSON.stringify(i.idea_json ?? {})
    );
  }
  const row = await qOne<{ n: string }>(
    db,
    `INSERT INTO caf_core.inputs_ideas (
       project_id, idea_list_id, idea_id, platform, confidence_score, idea_json
     ) VALUES ${chunks.join(",")}
     ON CONFLICT (idea_list_id, idea_id) DO UPDATE SET
       platform = EXCLUDED.platform,
       confidence_score = EXCLUDED.confidence_score,
       idea_json = EXCLUDED.idea_json
     RETURNING COUNT(*)::text AS n`,
    values
  );
  return parseInt(row?.n ?? "0", 10) || 0;
}

export async function getInputsIdeaListById(db: Pool, id: string): Promise<InputsIdeaListRow | null> {
  return qOne<InputsIdeaListRow>(db, `SELECT id::text, project_id::text, inputs_import_id::text, title,
    params_json, derived_globals_json, created_at::text
    FROM caf_core.inputs_idea_lists WHERE id = $1`, [id]);
}

export async function listInputsIdeaListsForImport(
  db: Pool,
  projectId: string,
  importId: string,
  limit = 50,
  offset = 0
): Promise<InputsIdeaListRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const off = Math.max(offset, 0);
  return q<InputsIdeaListRow>(
    db,
    `SELECT id::text, project_id::text, inputs_import_id::text, title,
            params_json, derived_globals_json, created_at::text
       FROM caf_core.inputs_idea_lists
      WHERE project_id = $1 AND inputs_import_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [projectId, importId, lim, off]
  );
}

export async function listInputsIdeasForList(
  db: Pool,
  projectId: string,
  ideaListId: string,
  limit = 200,
  offset = 0
): Promise<InputsIdeaRow[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const off = Math.max(offset, 0);
  return q<InputsIdeaRow>(
    db,
    `SELECT id::text, project_id::text, idea_list_id::text, idea_id, platform,
            confidence_score::text, idea_json, created_at::text
       FROM caf_core.inputs_ideas
      WHERE project_id = $1 AND idea_list_id = $2
      ORDER BY confidence_score DESC NULLS LAST, created_at DESC
      LIMIT $3 OFFSET $4`,
    [projectId, ideaListId, lim, off]
  );
}

