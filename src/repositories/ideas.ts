import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface IdeaRow {
  id: string;
  project_id: string;
  idea_id: string;
  inputs_import_id: string | null;
  created_at: string;
  run_id: string | null;
  title: string | null;
  three_liner: string | null;
  thesis: string | null;
  who_for: string | null;
  format: string | null;
  platform: string | null;
  why_now: string | null;
  key_points_json: unknown;
  novelty_angle: string | null;
  cta: string | null;
  expected_outcome: string | null;
  risk_flags_json: unknown;
  status: string | null;
  idea_json: Record<string, unknown>;
}

export type UpsertIdeaInput = {
  project_id: string;
  idea_id: string;
  inputs_import_id?: string | null;
  run_id?: string | null;
  title?: string | null;
  three_liner?: string | null;
  thesis?: string | null;
  who_for?: string | null;
  format?: string | null;
  platform?: string | null;
  why_now?: string | null;
  key_points?: string[];
  novelty_angle?: string | null;
  cta?: string | null;
  expected_outcome?: string | null;
  risk_flags?: string[];
  status?: string | null;
  idea_json: Record<string, unknown>;
};

export async function upsertIdea(db: Pool, input: UpsertIdeaInput): Promise<IdeaRow> {
  const row = await qOne<IdeaRow>(
    db,
    `INSERT INTO caf_core.ideas (
       project_id, idea_id, inputs_import_id, run_id,
       title, three_liner, thesis, who_for, format, platform, why_now,
       key_points_json, novelty_angle, cta, expected_outcome, risk_flags_json, status,
       idea_json
     ) VALUES (
       $1,$2,$3,$4,
       $5,$6,$7,$8,$9,$10,$11,
       $12::jsonb,$13,$14,$15,$16::jsonb,$17,
       $18::jsonb
     )
     ON CONFLICT (project_id, idea_id)
     DO UPDATE SET
       inputs_import_id = EXCLUDED.inputs_import_id,
       run_id = EXCLUDED.run_id,
       title = EXCLUDED.title,
       three_liner = EXCLUDED.three_liner,
       thesis = EXCLUDED.thesis,
       who_for = EXCLUDED.who_for,
       format = EXCLUDED.format,
       platform = EXCLUDED.platform,
       why_now = EXCLUDED.why_now,
       key_points_json = EXCLUDED.key_points_json,
       novelty_angle = EXCLUDED.novelty_angle,
       cta = EXCLUDED.cta,
       expected_outcome = EXCLUDED.expected_outcome,
       risk_flags_json = EXCLUDED.risk_flags_json,
       status = EXCLUDED.status,
       idea_json = EXCLUDED.idea_json
     RETURNING *`,
    [
      input.project_id,
      input.idea_id,
      input.inputs_import_id ?? null,
      input.run_id ?? null,
      input.title ?? null,
      input.three_liner ?? null,
      input.thesis ?? null,
      input.who_for ?? null,
      input.format ?? null,
      input.platform ?? null,
      input.why_now ?? null,
      JSON.stringify(input.key_points ?? []),
      input.novelty_angle ?? null,
      input.cta ?? null,
      input.expected_outcome ?? null,
      JSON.stringify(input.risk_flags ?? []),
      input.status ?? null,
      JSON.stringify(input.idea_json ?? {}),
    ]
  );
  if (!row) throw new Error("upsertIdea failed");
  return row;
}

export async function replaceIdeaGroundingInsights(
  db: Pool,
  params: {
    project_id: string;
    idea_row_id: string;
    insight_row_ids: string[];
  }
): Promise<void> {
  const ids = (params.insight_row_ids ?? []).map((x) => String(x).trim()).filter(Boolean);
  await db.query(`DELETE FROM caf_core.idea_grounding_insights WHERE idea_id = $1::uuid`, [
    params.idea_row_id,
  ]);
  if (ids.length === 0) return;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (const iid of ids) {
    ph.push(`($${p++}::uuid,$${p++}::uuid,$${p++}::uuid)`);
    values.push(params.project_id, params.idea_row_id, iid);
  }
  await db.query(
    `INSERT INTO caf_core.idea_grounding_insights (project_id, idea_id, insight_row_id)
     VALUES ${ph.join(", ")}
     ON CONFLICT (idea_id, insight_row_id) DO NOTHING`,
    values
  );
}

export async function listIdeasByIds(
  db: Pool,
  projectId: string,
  ideaIds: string[]
): Promise<IdeaRow[]> {
  const ids = (ideaIds ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) return [];
  return q<IdeaRow>(
    db,
    `SELECT * FROM caf_core.ideas
     WHERE project_id = $1 AND idea_id = ANY($2::text[])
     ORDER BY created_at DESC`,
    [projectId, ids]
  );
}

