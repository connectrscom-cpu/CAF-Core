-- Project-scoped input sources (Google Sheets tabs) and Apify scraper runs.
-- Scraped rows land in inputs_evidence_imports (same contract as XLSX upload).

CREATE TABLE caf_core.inputs_source_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  source_tab   text NOT NULL,
  row_index    integer NOT NULL DEFAULT 0,
  enabled      boolean NOT NULL DEFAULT true,
  payload_json jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_tab, row_index)
);

CREATE INDEX idx_inputs_source_rows_project_tab
  ON caf_core.inputs_source_rows(project_id, source_tab, row_index);

CREATE TABLE caf_core.inputs_scraper_config (
  project_id   uuid PRIMARY KEY REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  config_json  jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caf_core.inputs_scraper_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  scraper_key         text NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  started_at          timestamptz,
  finished_at         timestamptz,
  config_snapshot_json jsonb NOT NULL DEFAULT '{}',
  stats_json          jsonb NOT NULL DEFAULT '{}',
  error_message       text,
  evidence_import_id  uuid REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inputs_scraper_runs_project_created
  ON caf_core.inputs_scraper_runs(project_id, created_at DESC);
