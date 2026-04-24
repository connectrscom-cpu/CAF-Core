-- Context window for "ideas from insights" LLM when building a signal pack from Processing.

ALTER TABLE caf_core.inputs_processing_profiles
  ADD COLUMN IF NOT EXISTS max_insights_for_ideas_llm integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS min_top_performer_insights_for_ideas_llm integer NOT NULL DEFAULT 20;

ALTER TABLE caf_core.inputs_processing_profiles
  DROP CONSTRAINT IF EXISTS chk_inputs_proc_ideas_ctx;

ALTER TABLE caf_core.inputs_processing_profiles
  ADD CONSTRAINT chk_inputs_proc_ideas_ctx CHECK (
    max_insights_for_ideas_llm >= 20
    AND max_insights_for_ideas_llm <= 2000
    AND min_top_performer_insights_for_ideas_llm >= 0
    AND min_top_performer_insights_for_ideas_llm <= 500
    AND min_top_performer_insights_for_ideas_llm <= max_insights_for_ideas_llm
  );

COMMENT ON COLUMN caf_core.inputs_processing_profiles.max_insights_for_ideas_llm IS
  'Max broad/top-performer insight rows passed into the ideas-from-insights LLM (context cap).';

COMMENT ON COLUMN caf_core.inputs_processing_profiles.min_top_performer_insights_for_ideas_llm IS
  'Target minimum rows in that context that have top-performer tier enrichment (filled from available).';
