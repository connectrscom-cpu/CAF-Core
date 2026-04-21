-- Raw SNS / scraper workbook rows (INPUTS-style XLSX) for provenance and inspection in Core + Review.

CREATE TABLE caf_core.inputs_evidence_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  upload_filename   text,
  workbook_sha256   text,
  sheet_stats_json  jsonb NOT NULL DEFAULT '{}',
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inputs_evidence_imports_project_created
  ON caf_core.inputs_evidence_imports(project_id, created_at DESC);

CREATE TABLE caf_core.inputs_evidence_rows (
  id               bigserial PRIMARY KEY,
  import_id        uuid NOT NULL REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  sheet_name       text NOT NULL,
  row_index        integer NOT NULL,
  evidence_kind    text NOT NULL,
  dedupe_key       text,
  payload_json     jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, sheet_name, row_index)
);

CREATE INDEX idx_inputs_evidence_rows_import_sheet
  ON caf_core.inputs_evidence_rows(import_id, sheet_name, row_index);

CREATE INDEX idx_inputs_evidence_rows_project
  ON caf_core.inputs_evidence_rows(project_id, created_at DESC);

CREATE INDEX idx_inputs_evidence_rows_dedupe
  ON caf_core.inputs_evidence_rows(project_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
