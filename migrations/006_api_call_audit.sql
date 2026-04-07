-- Persist prompts and outbound API payloads for transparency (Sheets-style audit trail).

CREATE TABLE IF NOT EXISTS caf_core.api_call_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id text,
  task_id text,
  signal_pack_id uuid,
  step text NOT NULL,
  provider text NOT NULL,
  model text,
  ok boolean NOT NULL DEFAULT true,
  error_message text,
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_usage int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_call_audit_project_task
  ON caf_core.api_call_audit (project_id, task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_call_audit_project_run
  ON caf_core.api_call_audit (project_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_call_audit_signal_pack
  ON caf_core.api_call_audit (project_id, signal_pack_id, created_at DESC)
  WHERE signal_pack_id IS NOT NULL;
