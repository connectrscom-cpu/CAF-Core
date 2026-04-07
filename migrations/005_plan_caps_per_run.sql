-- Caps on how many jobs the decision engine may select per run plan (Start run).
-- NULL = no cap for that dimension.

ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS max_carousel_jobs_per_run integer,
  ADD COLUMN IF NOT EXISTS max_video_jobs_per_run integer,
  ADD COLUMN IF NOT EXISTS max_jobs_per_flow_type jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN caf_core.project_system_constraints.max_carousel_jobs_per_run IS 'Max planned jobs (incl. variations) with carousel-like flow_type per run';
COMMENT ON COLUMN caf_core.project_system_constraints.max_video_jobs_per_run IS 'Max planned jobs (incl. variations) with video/reel-like flow_type per run';
COMMENT ON COLUMN caf_core.project_system_constraints.max_jobs_per_flow_type IS 'Per flow_type caps, e.g. {"FLOW_CAROUSEL":10,"Reel_Script":3}';
