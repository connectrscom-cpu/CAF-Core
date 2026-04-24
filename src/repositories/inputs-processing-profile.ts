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
  /** Max insight rows sent into the ideas-from-insights LLM (context). Present after migration 034. */
  max_insights_for_ideas_llm?: number;
  /** Prefer at least this many context rows that have top-performer enrichment. Present after migration 034. */
  min_top_performer_insights_for_ideas_llm?: number;
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
  /**
   * Pre-LLM gate (deterministic). Set pre_llm.enabled=true to rank/filter rows from payload stats
   * before OpenAI rating. Tune per evidence_kind via pre_llm.kinds.<kind>.weights and .min_score.
   */
  pre_llm: {
    enabled: false,
    min_primary_text_chars: 12,
  },
  /** Labels for custom_label_1..3 in broad LLM prompts (Phase 2; optional). */
  insight_column_labels: {
    custom_label_1: "",
    custom_label_2: "",
    custom_label_3: "",
  },
  /** Top-performer deep tier: stricter pre-LLM cutoff + row cap (Phase 2; optional). */
  top_performer: {
    pre_llm_min_score: 0.35,
    max_rows: 24,
    max_carousel_rows: 10,
  },
  inputs_insights: {
    broad_model: "gpt-4o-mini",
    broad_batch_size: 6,
    deep_image_model: "gpt-4o-mini",
    deep_image_max: 24,
    deep_carousel_model: "gpt-4o-mini",
    deep_carousel_max: 10,
  },
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
    max_insights_for_ideas_llm: number;
    min_top_performer_insights_for_ideas_llm: number;
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
    max_insights_for_ideas_llm:
      patch.max_insights_for_ideas_llm ?? existing?.max_insights_for_ideas_llm ?? 200,
    min_top_performer_insights_for_ideas_llm:
      patch.min_top_performer_insights_for_ideas_llm ??
      existing?.min_top_performer_insights_for_ideas_llm ??
      20,
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
         max_insights_for_ideas_llm, min_top_performer_insights_for_ideas_llm,
         min_llm_score_for_pack, extra_instructions
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        projectId,
        JSON.stringify(merged.criteria_json),
        merged.rating_model,
        merged.synth_model,
        merged.max_rows_for_rating,
        merged.max_rows_per_llm_batch,
        merged.max_ideas_in_signal_pack,
        merged.max_insights_for_ideas_llm,
        merged.min_top_performer_insights_for_ideas_llm,
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
       max_insights_for_ideas_llm = $8,
       min_top_performer_insights_for_ideas_llm = $9,
       min_llm_score_for_pack = $10,
       extra_instructions = $11,
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
      merged.max_insights_for_ideas_llm,
      merged.min_top_performer_insights_for_ideas_llm,
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
