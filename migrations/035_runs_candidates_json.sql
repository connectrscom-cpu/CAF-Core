-- Planner source rows for a run, materialized from signal_pack.ideas_json (manual pick or LLM) before Start.

ALTER TABLE caf_core.runs
  ADD COLUMN IF NOT EXISTS candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caf_core.runs.candidates_json IS
  'Planner-facing rows (same shape as expanded signal-pack rows × flows input). Populated from pack ideas via POST .../candidates; startRun reads this instead of deriving from the pack.';
