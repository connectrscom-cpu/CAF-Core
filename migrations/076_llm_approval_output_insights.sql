-- Nemotron generated-output analysis (TP-parity fields) on post-approval reviews.

ALTER TABLE caf_core.llm_approval_reviews
  ADD COLUMN IF NOT EXISTS output_insights_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_insights_llm_json jsonb;

COMMENT ON COLUMN caf_core.llm_approval_reviews.output_insights_json IS
  'Normalized aesthetic analysis of CAF-generated rendered output (carousel/video TP-parity shape).';

COMMENT ON COLUMN caf_core.llm_approval_reviews.raw_insights_llm_json IS
  'Raw merged Nemotron JSON before aesthetic slice extraction.';
