-- Structured ideas from inputs insights (broad + top-performer tiers), alongside planner rows in overall_candidates_json.

ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS ideas_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caf_core.signal_packs.ideas_json IS
  'Curated idea objects (platform, emotions, why_it_worked, …) from Processing; at run start the orchestrator prefers this list when non-empty to build planner candidates, else overall_candidates_json.';
