-- Append-only log of carousel/video pipeline outcomes per job (admin Runs → content log).

CREATE TABLE IF NOT EXISTS caf_core.run_content_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  task_id text NOT NULL,
  flow_type text NOT NULL,
  flow_kind text NOT NULL,
  outcome text NOT NULL,
  job_status text NOT NULL,
  slide_count integer,
  asset_count integer NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_content_outcomes_project_run_created
  ON caf_core.run_content_outcomes (project_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_content_outcomes_project_task
  ON caf_core.run_content_outcomes (project_id, task_id, created_at DESC);
