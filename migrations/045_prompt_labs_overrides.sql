-- Prompt Labs: allow operators to persist overrides for code-defined prompts.
-- These overrides are used by the Prompt Labs admin UI as a live editable layer.

CREATE TABLE IF NOT EXISTS caf_core.prompt_labs_overrides (
  prompt_name text PRIMARY KEY,
  flow_type text NULL,
  prompt_role text NULL,
  system_prompt text NULL,
  user_prompt_template text NULL,
  output_format_rule text NULL,
  notes text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_labs_overrides_flow_type_idx
  ON caf_core.prompt_labs_overrides (flow_type);

