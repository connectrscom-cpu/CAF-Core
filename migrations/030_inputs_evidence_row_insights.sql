-- Per-evidence-row LLM outputs: broad (text-only) vs top-performer (multimodal / deep).
-- Populated by Phase 2 jobs; empty until those pipelines run.

CREATE TABLE caf_core.inputs_evidence_row_insights (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  inputs_import_id          uuid NOT NULL REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE CASCADE,
  source_evidence_row_id    bigint NOT NULL REFERENCES caf_core.inputs_evidence_rows(id) ON DELETE CASCADE,
  insights_id               text NOT NULL,
  analysis_tier             text NOT NULL,
  pre_llm_score             numeric(8,4),
  llm_model                 text,
  why_it_worked             text,
  primary_emotion           text,
  secondary_emotion         text,
  hook_type                 text,
  custom_label_1            text,
  custom_label_2            text,
  custom_label_3            text,
  cta_type                  text,
  hashtags                  text,
  caption_style             text,
  hook_text                 text,
  risk_flags_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  aesthetic_analysis_json   jsonb,
  raw_llm_json              jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_inputs_evidence_insights_tier CHECK (
    analysis_tier IN ('broad_llm', 'top_performer_deep')
  )
);

CREATE UNIQUE INDEX uq_inputs_evidence_row_insights_project_insights_id
  ON caf_core.inputs_evidence_row_insights(project_id, insights_id);

CREATE UNIQUE INDEX uq_inputs_evidence_row_insights_row_tier
  ON caf_core.inputs_evidence_row_insights(inputs_import_id, source_evidence_row_id, analysis_tier);

CREATE INDEX idx_inputs_evidence_row_insights_import_tier
  ON caf_core.inputs_evidence_row_insights(inputs_import_id, analysis_tier);

COMMENT ON TABLE caf_core.inputs_evidence_row_insights IS
  'Phase 2: analyzed evidence. broad_llm = text-only row analysis; top_performer_deep = multimodal (image/video) aesthetic + style.';

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.insights_id IS
  'Stable public id for this insight row (e.g. ins_<importPrefix>_<rowId>_broad).';

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.aesthetic_analysis_json IS
  'Deep tier: colours, fonts, layout, on-screen text, etc. (structure is project-defined JSON).';
