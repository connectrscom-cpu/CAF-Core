-- Per-project criteria for rating scraped evidence and building signal packs + row-level ratings.

ALTER TABLE caf_core.inputs_evidence_rows
  ADD COLUMN IF NOT EXISTS rating_score numeric(8,4),
  ADD COLUMN IF NOT EXISTS rating_components_json jsonb,
  ADD COLUMN IF NOT EXISTS rating_rationale text,
  ADD COLUMN IF NOT EXISTS rated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_inputs_evidence_rows_import_rating
  ON caf_core.inputs_evidence_rows(import_id, rating_score DESC NULLS LAST)
  WHERE rating_score IS NOT NULL;

CREATE TABLE caf_core.inputs_processing_profiles (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                    uuid NOT NULL UNIQUE REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  criteria_json                 jsonb NOT NULL DEFAULT '{}',
  rating_model                  text NOT NULL DEFAULT 'gpt-4o-mini',
  synth_model                   text NOT NULL DEFAULT 'gpt-4o-mini',
  max_rows_for_rating           integer NOT NULL DEFAULT 250,
  max_rows_per_llm_batch        integer NOT NULL DEFAULT 20,
  max_ideas_in_signal_pack      integer NOT NULL DEFAULT 35,
  min_llm_score_for_pack        numeric(6,4) NOT NULL DEFAULT 0.35,
  extra_instructions            text,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_inputs_proc_rating_cap CHECK (max_rows_for_rating > 0 AND max_rows_for_rating <= 5000),
  CONSTRAINT chk_inputs_proc_batch CHECK (max_rows_per_llm_batch > 0 AND max_rows_per_llm_batch <= 80),
  CONSTRAINT chk_inputs_proc_ideas CHECK (max_ideas_in_signal_pack > 0 AND max_ideas_in_signal_pack <= 200)
);

CREATE INDEX idx_inputs_processing_profiles_project ON caf_core.inputs_processing_profiles(project_id);
