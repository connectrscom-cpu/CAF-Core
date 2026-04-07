-- CAF Core — Migration 003: Flow Engine (CAF-level shared tables)
-- These tables are shared across all projects. They store the reusable catalog of
-- flow definitions, prompt templates, output schemas, carousel templates, QC checklists,
-- and risk policies. This is the CAF-level infrastructure that project-level config
-- references by flow_type / prompt_name / schema_name / template_key / checklist_name.

-- ---------------------------------------------------------------------------
-- 1. Flow Definitions — registry of supported flow types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.flow_definitions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_type                 text NOT NULL UNIQUE,
  description               text,
  category                  text,
  supported_platforms       text,
  output_asset_types        text,
  requires_signal_pack      boolean DEFAULT true,
  requires_learning_context boolean DEFAULT true,
  requires_brand_constraints boolean DEFAULT true,
  required_inputs           text,
  optional_inputs           text,
  default_variation_count   integer DEFAULT 1,
  output_schema_name        text,
  output_schema_version     text,
  qc_checklist_name         text,
  qc_checklist_version      text,
  risk_profile_default      text,
  candidate_row_template    text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Prompt Templates — actual prompt text for each flow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.prompt_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_name               text NOT NULL,
  flow_type                 text NOT NULL,
  prompt_role               text DEFAULT 'generator',
  system_prompt             text,
  user_prompt_template      text,
  output_format_rule        text,
  output_schema_name        text,
  output_schema_version     text,
  temperature_default       numeric(5,2),
  max_tokens_default        integer,
  stop_sequences            text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_name, flow_type)
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_flow ON caf_core.prompt_templates(flow_type);

-- ---------------------------------------------------------------------------
-- 3. Output Schemas — expected output structure per flow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.output_schemas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_schema_name        text NOT NULL,
  output_schema_version     text NOT NULL,
  flow_type                 text NOT NULL,
  schema_json               jsonb NOT NULL DEFAULT '{}',
  required_keys             text,
  field_types               text,
  example_output_json       jsonb,
  parsing_notes             text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (output_schema_name, output_schema_version)
);

CREATE INDEX IF NOT EXISTS idx_output_schemas_flow ON caf_core.output_schemas(flow_type);

-- ---------------------------------------------------------------------------
-- 4. Carousel Templates — template_key → html_template_name mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.carousel_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key              text NOT NULL UNIQUE,
  platform                  text,
  default_slide_count       integer,
  engine                    text DEFAULT 'handlebars',
  html_template_name        text,
  adapter_key               text,
  config_json               jsonb NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. QC Checklists — per-flow quality checks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.qc_checklists (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_checklist_name         text NOT NULL,
  qc_checklist_version      text NOT NULL,
  flow_type                 text NOT NULL,
  check_id                  text NOT NULL,
  check_name                text,
  check_type                text,
  field_path                text,
  operator                  text,
  threshold_value           text,
  severity                  text DEFAULT 'MEDIUM',
  blocking                  boolean DEFAULT false,
  failure_message           text,
  auto_fix_action           text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qc_checklist_name, qc_checklist_version, check_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_checklists_flow ON caf_core.qc_checklists(flow_type);

-- ---------------------------------------------------------------------------
-- 6. Risk Policies — CAF-level risk detection rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.risk_policies (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_policy_name          text NOT NULL,
  risk_policy_version       text NOT NULL,
  risk_category             text,
  detection_method          text,
  detection_terms           text,
  severity_level            text DEFAULT 'MEDIUM',
  default_action            text DEFAULT 'route_to_manual',
  requires_manual_review    boolean DEFAULT true,
  requires_senior_review    boolean DEFAULT false,
  block_publish             boolean DEFAULT false,
  disclaimer_template_name  text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (risk_policy_name, risk_policy_version)
);

CREATE INDEX IF NOT EXISTS idx_risk_policies_category ON caf_core.risk_policies(risk_category);

-- ---------------------------------------------------------------------------
-- 7. Add prompt-text columns to prompt_versions for full prompt resolution
-- ---------------------------------------------------------------------------
ALTER TABLE caf_core.prompt_versions
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS user_prompt_template text,
  ADD COLUMN IF NOT EXISTS output_format_rule text,
  ADD COLUMN IF NOT EXISTS prompt_template_id uuid REFERENCES caf_core.prompt_templates(id);
