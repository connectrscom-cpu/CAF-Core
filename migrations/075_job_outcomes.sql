-- Publish → market feedback anchor per content job (manual performance tracking; no schedulers).

CREATE TABLE IF NOT EXISTS caf_core.job_outcomes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  task_id               text NOT NULL,
  placement_id          uuid,
  platform              text,
  platform_post_id      text,
  posted_url            text,
  published_at          timestamptz,
  tracking_status       text NOT NULL DEFAULT 'published'
    CHECK (tracking_status IN ('published', 'metrics_present', 'analyzed')),
  outcome_summary_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_job_outcomes_project_status
  ON caf_core.job_outcomes (project_id, tracking_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_outcomes_project_published
  ON caf_core.job_outcomes (project_id, published_at DESC NULLS LAST);

COMMENT ON TABLE caf_core.job_outcomes IS
  'Post-publish outcome anchor for learning dossier and manual performance analysis. Join via (project_id, task_id).';
