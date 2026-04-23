-- Allow video (frame-bundle) deep insights tier alongside image deep tier.

ALTER TABLE caf_core.inputs_evidence_row_insights
  DROP CONSTRAINT IF EXISTS chk_inputs_evidence_insights_tier;

ALTER TABLE caf_core.inputs_evidence_row_insights
  ADD CONSTRAINT chk_inputs_evidence_insights_tier CHECK (
    analysis_tier IN ('broad_llm', 'top_performer_deep', 'top_performer_video')
  );

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.analysis_tier IS
  'broad_llm = text-only; top_performer_deep = static image vision; top_performer_video = sampled frames + transcript (no raw full-video upload in Core).';
