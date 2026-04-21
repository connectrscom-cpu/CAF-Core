-- Input health, selection snapshots, insights packs, signal-pack provenance,
-- run plan summary, and per-flow QC profile overrides.

ALTER TABLE caf_core.inputs_evidence_imports
  ADD COLUMN IF NOT EXISTS input_health_status text,
  ADD COLUMN IF NOT EXISTS input_health_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS selection_snapshot_json jsonb,
  ADD COLUMN IF NOT EXISTS health_computed_at timestamptz;

COMMENT ON COLUMN caf_core.inputs_evidence_imports.input_health_status IS
  'Aggregate gate: ok | warn | block (computed from row coverage + sheet stats).';

ALTER TABLE caf_core.inputs_evidence_rows
  ADD COLUMN IF NOT EXISTS health_code text,
  ADD COLUMN IF NOT EXISTS health_json jsonb NOT NULL DEFAULT '{}';

ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS source_inputs_import_id uuid REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signal_packs_source_import
  ON caf_core.signal_packs(source_inputs_import_id)
  WHERE source_inputs_import_id IS NOT NULL;

ALTER TABLE caf_core.runs
  ADD COLUMN IF NOT EXISTS plan_summary_json jsonb;

COMMENT ON COLUMN caf_core.runs.plan_summary_json IS
  'Compact planner outcome at start: trace_id, counts, candidate ids, suppression (see run-orchestrator).';

CREATE TABLE caf_core.insights_packs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  inputs_import_id      uuid REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE SET NULL,
  signal_pack_id        uuid REFERENCES caf_core.signal_packs(id) ON DELETE SET NULL,
  version               integer NOT NULL DEFAULT 1,
  title                 text,
  body_json             jsonb NOT NULL DEFAULT '{}',
  evidence_refs_json    jsonb NOT NULL DEFAULT '[]',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_insights_packs_project ON caf_core.insights_packs(project_id, created_at DESC);
CREATE INDEX idx_insights_packs_import ON caf_core.insights_packs(inputs_import_id);

CREATE TABLE caf_core.qc_flow_profiles (
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  flow_type             text NOT NULL,
  profile_json          jsonb NOT NULL DEFAULT '{}',
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, flow_type)
);

COMMENT ON TABLE caf_core.qc_flow_profiles IS
  'Optional per-flow QC tuning (thresholds, fix hints). Consumed by qc-runtime when present.';
