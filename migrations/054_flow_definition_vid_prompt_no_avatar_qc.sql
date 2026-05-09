-- CAF Core — Migration 054: flow_definitions + QC rows for FLOW_VID_PROMPT_NO_AVATAR
--
-- `runQcForJob` loads `flow_definitions` by job.flow_type; `listQcChecks` filters
-- by `qc_checklists.flow_type` (not by checklist name). Without this, no-avatar
-- prompt video jobs skip the `video_prompt` requirement and other per-flow checks.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1) Register canonical no-avatar prompt video beside FLOW_VID_PROMPT (same QC/schema hooks).
INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  'FLOW_VID_PROMPT_NO_AVATAR',
  'HeyGen Video Agent — prompt-led video without on-camera avatar (narration + motion/stock/graphics).',
  category,
  supported_platforms,
  output_asset_types,
  requires_signal_pack,
  requires_learning_context,
  requires_brand_constraints,
  required_inputs,
  optional_inputs,
  default_variation_count,
  output_schema_name,
  output_schema_version,
  qc_checklist_name,
  qc_checklist_version,
  risk_profile_default,
  candidate_row_template,
  'Canonical no-avatar prompt video; shares Flow Engine templates with FLOW_VID_PROMPT (resolveFlowEngineTemplateFlowType).'
FROM caf_core.flow_definitions
WHERE flow_type = 'FLOW_VID_PROMPT'
LIMIT 1
ON CONFLICT (flow_type) DO UPDATE SET
  description = EXCLUDED.description,
  qc_checklist_name = COALESCE(
    NULLIF(btrim(caf_core.flow_definitions.qc_checklist_name), ''),
    EXCLUDED.qc_checklist_name
  ),
  qc_checklist_version = COALESCE(
    NULLIF(btrim(caf_core.flow_definitions.qc_checklist_version), ''),
    EXCLUDED.qc_checklist_version
  ),
  output_schema_name = COALESCE(caf_core.flow_definitions.output_schema_name, EXCLUDED.output_schema_name),
  output_schema_version = COALESCE(caf_core.flow_definitions.output_schema_version, EXCLUDED.output_schema_version),
  updated_at = now();

-- 2) Mirror QC checklist rows (listQcChecks matches flow_type only).
INSERT INTO caf_core.qc_checklists (
  qc_checklist_name,
  qc_checklist_version,
  flow_type,
  check_id,
  check_name,
  check_type,
  field_path,
  operator,
  threshold_value,
  severity,
  blocking,
  failure_message,
  auto_fix_action,
  notes
)
SELECT
  q.qc_checklist_name,
  q.qc_checklist_version,
  'FLOW_VID_PROMPT_NO_AVATAR',
  q.check_id || '__vid_prompt_no_avatar',
  q.check_name,
  q.check_type,
  q.field_path,
  q.operator,
  q.threshold_value,
  q.severity,
  q.blocking,
  q.failure_message,
  q.auto_fix_action,
  q.notes
FROM caf_core.qc_checklists q
WHERE q.flow_type = 'FLOW_VID_PROMPT'
ON CONFLICT (qc_checklist_name, qc_checklist_version, check_id) DO NOTHING;

COMMIT;
