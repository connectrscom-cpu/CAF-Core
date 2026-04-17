-- Holistic operator review of a run's outputs (fed into editorial analysis LLM + engineering brief).

CREATE TABLE IF NOT EXISTS caf_core.run_output_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id            text NOT NULL,
  body              text NOT NULL,
  validator         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_run_output_reviews_project_updated
  ON caf_core.run_output_reviews(project_id, updated_at DESC);
