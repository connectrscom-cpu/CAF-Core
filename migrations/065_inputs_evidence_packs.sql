-- Evidence packs: one completed scraper run per platform → merged inputs_evidence_import for Processing.

CREATE TABLE caf_core.inputs_evidence_packs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  label               text,
  slots_json          jsonb NOT NULL DEFAULT '{}',
  evidence_import_id  uuid REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE SET NULL,
  stats_json          jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inputs_evidence_packs_project_created
  ON caf_core.inputs_evidence_packs(project_id, created_at DESC);
