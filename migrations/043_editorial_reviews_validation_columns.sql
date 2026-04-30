-- Structured validation output per editorial submission (insertEditorialReview / executeEditorialReviewDecision).
-- Older databases created from early dumps missed these columns.
ALTER TABLE caf_core.editorial_reviews
  ADD COLUMN IF NOT EXISTS validation_schema_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS validation_output_json jsonb NOT NULL DEFAULT '{}'::jsonb;
