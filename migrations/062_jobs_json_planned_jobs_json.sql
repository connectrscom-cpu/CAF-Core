-- Jobs-centric JSON columns (canonical). Legacy ideas_json / candidates_json kept for dual-read during rollout.

ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS jobs_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caf_core.signal_packs.jobs_json IS
  'Canonical job rows for the signal pack (same shape as ideas_json). Dual-written with ideas_json during migration.';

UPDATE caf_core.signal_packs
SET jobs_json = ideas_json
WHERE jobs_json = '[]'::jsonb
  AND ideas_json IS NOT NULL
  AND ideas_json <> '[]'::jsonb;

ALTER TABLE caf_core.runs
  ADD COLUMN IF NOT EXISTS planned_jobs_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caf_core.runs.planned_jobs_json IS
  'Jobs materialized from signal pack for planning (same shape as candidates_json). Dual-written during migration.';

UPDATE caf_core.runs
SET planned_jobs_json = candidates_json
WHERE planned_jobs_json = '[]'::jsonb
  AND candidates_json IS NOT NULL
  AND candidates_json <> '[]'::jsonb;
