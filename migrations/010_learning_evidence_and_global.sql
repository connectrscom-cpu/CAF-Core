-- Global learning project + evidence tables (hypotheses, observations, CSV batches, generation attribution).

INSERT INTO caf_core.projects (slug, display_name, active)
VALUES ('caf-global', 'CAF Global Learning', true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS caf_core.learning_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'project',
  source_type text NOT NULL,
  flow_type text,
  platform text,
  observation_type text NOT NULL,
  entity_ref text,
  payload_json jsonb NOT NULL DEFAULT '{}',
  confidence numeric(6,4),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, observation_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_observations_project_created
  ON caf_core.learning_observations (project_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS caf_core.learning_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'project',
  title text NOT NULL,
  statement text NOT NULL,
  rationale text,
  status text,
  priority integer,
  owner text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, hypothesis_id)
);

CREATE TABLE IF NOT EXISTS caf_core.learning_hypothesis_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'project',
  hypothesis_id text,
  experiment_type text NOT NULL,
  design_json jsonb NOT NULL DEFAULT '{}',
  start_at timestamptz,
  end_at timestamptz,
  status text,
  success_metric text,
  result_summary text,
  result_payload_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, trial_id)
);

CREATE TABLE IF NOT EXISTS caf_core.learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'project',
  title text NOT NULL,
  body text NOT NULL,
  derived_from_observation_ids jsonb NOT NULL DEFAULT '[]',
  confidence numeric(6,4),
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, insight_id)
);

CREATE TABLE IF NOT EXISTS caf_core.performance_ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  file_hash text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  mapping_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caf_core.learning_generation_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  flow_type text,
  platform text,
  applied_rule_ids jsonb NOT NULL DEFAULT '[]',
  global_context_chars integer NOT NULL DEFAULT 0,
  project_context_chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_gen_attr_project_created
  ON caf_core.learning_generation_attribution (project_id, created_at DESC);
