-- Project-level external integrations (publish + metrics) keyed by project.
-- Stores per-platform account ids + credentials blob (token material) for connectors.
--
-- NOTE: credentials_json is stored as jsonb for now. For production, encrypt at rest
-- (app-layer or DB crypto) and restrict access tightly (admin-only routes).

CREATE TABLE IF NOT EXISTS caf_core.project_integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  platform         text NOT NULL,
  display_name     text,
  is_enabled       boolean NOT NULL DEFAULT true,
  account_ids_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tested_at   timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_project_integrations_project
  ON caf_core.project_integrations (project_id, platform);

COMMENT ON TABLE caf_core.project_integrations IS
  'Per-project platform account/credentials for publish + metrics connectors. Join by project_id; publishing outcomes remain keyed by (project_id, task_id).';

