import type { Pool } from "pg";
import { qOne } from "../db/queries.js";

export interface InputsProcessingProfileRow {
  id: string;
  project_id: string;
  criteria_json: Record<string, unknown>;
  rating_model: string;
  synth_model: string;
  max_rows_for_rating: number;
  max_rows_per_llm_batch: number;
  max_ideas_in_signal_pack: number;
  min_llm_score_for_pack: string;
  extra_instructions: string | null;
  updated_at: string;
}

const DEFAULT_CRITERIA: Record<string, unknown> = {
  weights: {
    engagement_potential: 0.25,
    topic_clarity: 0.25,
    brand_voice_fit: 0.25,
    originality: 0.25,
  },
  notes:
    "LLM scores each row 0–1 on the components; overall_score is the weighted sum. Rows at or above min_llm_score_for_pack are eligible for the signal-pack synthesis pass.",
};

export async function getInputsProcessingProfile(db: Pool, projectId: string): Promise<InputsProcessingProfileRow | null> {
  return qOne<InputsProcessingProfileRow>(
    db,
    `SELECT * FROM caf_core.inputs_processing_profiles WHERE project_id = $1`,
    [projectId]
  );
}

export async function upsertInputsProcessingProfile(
  db: Pool,
  projectId: string,
  patch: Partial<{
    criteria_json: Record<string, unknown>;
    rating_model: string;
    synth_model: string;
    max_rows_for_rating: number;
    max_rows_per_llm_batch: number;
    max_ideas_in_signal_pack: number;
    min_llm_score_for_pack: number;
    extra_instructions: string | null;
  }>
): Promise<InputsProcessingProfileRow> {
  const existing = await getInputsProcessingProfile(db, projectId);
  const merged = {
    criteria_json: (patch.criteria_json ?? existing?.criteria_json ?? DEFAULT_CRITERIA) as Record<string, unknown>,
    rating_model: patch.rating_model ?? existing?.rating_model ?? "gpt-4o-mini",
    synth_model: patch.synth_model ?? existing?.synth_model ?? "gpt-4o-mini",
    max_rows_for_rating: patch.max_rows_for_rating ?? existing?.max_rows_for_rating ?? 250,
    max_rows_per_llm_batch: patch.max_rows_per_llm_batch ?? existing?.max_rows_per_llm_batch ?? 20,
    max_ideas_in_signal_pack: patch.max_ideas_in_signal_pack ?? existing?.max_ideas_in_signal_pack ?? 35,
    min_llm_score_for_pack: patch.min_llm_score_for_pack ?? Number(existing?.min_llm_score_for_pack ?? 0.35),
    extra_instructions:
      patch.extra_instructions !== undefined ? patch.extra_instructions : (existing?.extra_instructions ?? null),
  };

  if (!existing) {
    const row = await qOne<InputsProcessingProfileRow>(
      db,
      `INSERT INTO caf_core.inputs_processing_profiles (
         project_id, criteria_json, rating_model, synth_model,
         max_rows_for_rating, max_rows_per_llm_batch, max_ideas_in_signal_pack,
         min_llm_score_for_pack, extra_instructions
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        projectId,
        JSON.stringify(merged.criteria_json),
        merged.rating_model,
        merged.synth_model,
        merged.max_rows_for_rating,
        merged.max_rows_per_llm_batch,
        merged.max_ideas_in_signal_pack,
        merged.min_llm_score_for_pack,
        merged.extra_instructions,
      ]
    );
    if (!row) throw new Error("insert profile failed");
    return row;
  }

  const row = await qOne<InputsProcessingProfileRow>(
    db,
    `UPDATE caf_core.inputs_processing_profiles SET
       criteria_json = $2::jsonb,
       rating_model = $3,
       synth_model = $4,
       max_rows_for_rating = $5,
       max_rows_per_llm_batch = $6,
       max_ideas_in_signal_pack = $7,
       min_llm_score_for_pack = $8,
       extra_instructions = $9,
       updated_at = now()
     WHERE project_id = $1
     RETURNING *`,
    [
      projectId,
      JSON.stringify(merged.criteria_json),
      merged.rating_model,
      merged.synth_model,
      merged.max_rows_for_rating,
      merged.max_rows_per_llm_batch,
      merged.max_ideas_in_signal_pack,
      merged.min_llm_score_for_pack,
      merged.extra_instructions,
    ]
  );
  if (!row) throw new Error("update profile failed");
  return row;
}

export function defaultCriteriaJson(): Record<string, unknown> {
  return { ...DEFAULT_CRITERIA };
}
