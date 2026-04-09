-- Ensure run_content_outcomes has summary_json (older DBs may have had the table
-- created before migration 007, so CREATE TABLE IF NOT EXISTS skipped and the column never appeared).

ALTER TABLE caf_core.run_content_outcomes
  ADD COLUMN IF NOT EXISTS summary_json jsonb NOT NULL DEFAULT '{}'::jsonb;
