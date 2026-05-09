-- CAF Core — Migration 054: flow_definitions + QC rows for FLOW_VID_PROMPT_NO_AVATAR
--
-- `runQcForJob` loads `flow_definitions` by job.flow_type; `listQcChecks` filters
-- by `qc_checklists.flow_type` (not by checklist name). Without this, no-avatar
-- prompt video jobs skip the `video_prompt` requirement and other per-flow checks.
--
-- Uses NOT EXISTS (no ON CONFLICT): production DBs may predate UNIQUE(flow_type) on
-- flow_definitions and the qc_checklists composite unique from 003.
--
-- Idempotent: safe to re-run.

BEGIN;

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
  base.category,
  base.supported_platforms,
  base.output_asset_types,
  base.requires_signal_pack,
  base.requires_learning_context,
  base.requires_brand_constraints,
  base.required_inputs,
  base.optional_inputs,
  base.default_variation_count,
  base.output_schema_name,
  base.output_schema_version,
  base.qc_checklist_name,
  base.qc_checklist_version,
  base.risk_profile_default,
  base.candidate_row_template,
  'Canonical no-avatar prompt video; shares Flow Engine templates with FLOW_VID_PROMPT (resolveFlowEngineTemplateFlowType).'
FROM (
  SELECT *
  FROM caf_core.flow_definitions
  WHERE flow_type IN ('FLOW_VID_PROMPT', 'Video_Prompt_Generator')
  ORDER BY CASE flow_type WHEN 'FLOW_VID_PROMPT' THEN 0 ELSE 1 END
  LIMIT 1
) AS base
WHERE NOT EXISTS (
  SELECT 1 FROM caf_core.flow_definitions fd WHERE fd.flow_type = 'FLOW_VID_PROMPT_NO_AVATAR'
);

UPDATE caf_core.flow_definitions fd
SET
  qc_checklist_name = COALESCE(
    NULLIF(btrim(fd.qc_checklist_name), ''),
    (SELECT qc_checklist_name FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_PROMPT' LIMIT 1),
    (SELECT qc_checklist_name FROM caf_core.flow_definitions WHERE flow_type = 'Video_Prompt_Generator' LIMIT 1)
  ),
  qc_checklist_version = COALESCE(
    NULLIF(btrim(fd.qc_checklist_version), ''),
    (SELECT qc_checklist_version FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_PROMPT' LIMIT 1),
    (SELECT qc_checklist_version FROM caf_core.flow_definitions WHERE flow_type = 'Video_Prompt_Generator' LIMIT 1)
  ),
  output_schema_name = COALESCE(
    fd.output_schema_name,
    (SELECT output_schema_name FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_PROMPT' LIMIT 1),
    (SELECT output_schema_name FROM caf_core.flow_definitions WHERE flow_type = 'Video_Prompt_Generator' LIMIT 1)
  ),
  output_schema_version = COALESCE(
    fd.output_schema_version,
    (SELECT output_schema_version FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_PROMPT' LIMIT 1),
    (SELECT output_schema_version FROM caf_core.flow_definitions WHERE flow_type = 'Video_Prompt_Generator' LIMIT 1)
  ),
  updated_at = now()
WHERE fd.flow_type = 'FLOW_VID_PROMPT_NO_AVATAR';

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
  AND NOT EXISTS (
    SELECT 1
    FROM caf_core.qc_checklists x
    WHERE x.flow_type = 'FLOW_VID_PROMPT_NO_AVATAR'
      AND x.check_id = q.check_id || '__vid_prompt_no_avatar'
  );

COMMIT;
