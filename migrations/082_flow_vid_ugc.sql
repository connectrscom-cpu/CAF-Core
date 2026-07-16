-- CAF Core — Migration 082: FLOW_VID_UGC (UGC creator talking-head video)
--
-- Peer-voice spoken_script + UGC host pool → HeyGen script-led avatar (/v3/videos).

BEGIN;

INSERT INTO caf_core.allowed_flow_types (
  project_id,
  flow_type,
  enabled,
  default_variation_count,
  requires_signal_pack,
  requires_learning_context,
  allowed_platforms,
  output_schema_version,
  qc_checklist_version,
  prompt_template_id,
  priority_weight,
  notes,
  heygen_mode
)
SELECT
  p.id,
  'FLOW_VID_UGC',
  false,
  1,
  true,
  false,
  NULL,
  NULL,
  NULL,
  NULL,
  6,
  'UGC creator video — peer-voice spoken_script + UGC host pool (brand/product bible) → HeyGen script-led.',
  NULL
FROM caf_core.projects p
WHERE NOT EXISTS (
  SELECT 1
  FROM caf_core.allowed_flow_types a
  WHERE a.project_id = p.id
    AND a.flow_type = 'FLOW_VID_UGC'
);

INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  'FLOW_VID_UGC',
  'UGC creator video — peer-voice spoken script + creator-style host, HeyGen script-led avatar.',
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
  'Shares Flow Engine script templates (resolveFlowEngineTemplateFlowType → FLOW_VID_SCRIPT); UGC fields via CAF addendum.'
FROM (
  SELECT *
  FROM caf_core.flow_definitions
  WHERE flow_type IN ('FLOW_VID_SCRIPT', 'Video_Script_Generator')
  ORDER BY CASE flow_type WHEN 'FLOW_VID_SCRIPT' THEN 0 ELSE 1 END
  LIMIT 1
) AS base
WHERE NOT EXISTS (
  SELECT 1 FROM caf_core.flow_definitions fd WHERE fd.flow_type = 'FLOW_VID_UGC'
);

UPDATE caf_core.flow_definitions fd
SET
  qc_checklist_name = COALESCE(
    NULLIF(btrim(fd.qc_checklist_name), ''),
    (SELECT qc_checklist_name FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_SCRIPT' LIMIT 1)
  ),
  qc_checklist_version = COALESCE(
    NULLIF(btrim(fd.qc_checklist_version), ''),
    (SELECT qc_checklist_version FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_SCRIPT' LIMIT 1)
  ),
  output_schema_name = COALESCE(
    fd.output_schema_name,
    (SELECT output_schema_name FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_SCRIPT' LIMIT 1)
  ),
  output_schema_version = COALESCE(
    fd.output_schema_version,
    (SELECT output_schema_version FROM caf_core.flow_definitions WHERE flow_type = 'FLOW_VID_SCRIPT' LIMIT 1)
  ),
  updated_at = now()
WHERE fd.flow_type = 'FLOW_VID_UGC';

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
  'FLOW_VID_UGC',
  q.check_id || '__vid_ugc',
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
WHERE q.flow_type = 'FLOW_VID_SCRIPT'
  AND NOT EXISTS (
    SELECT 1
    FROM caf_core.qc_checklists x
    WHERE x.flow_type = 'FLOW_VID_UGC'
      AND x.check_id = q.check_id || '__vid_ugc'
  );

COMMIT;
