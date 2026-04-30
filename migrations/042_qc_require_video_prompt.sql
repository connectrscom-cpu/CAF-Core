-- Require explicit `video_prompt` for prompt-led video flows.
-- Prevents "hook/cta-only instructions" from passing QC and reaching render/review.

BEGIN;

-- Ensure the flow definition marks that a QC checklist exists (runtime gates on non-null qc_checklist_name).
UPDATE caf_core.flow_definitions
SET qc_checklist_name = COALESCE(qc_checklist_name, 'Video_Prompt_Generator'),
    qc_checklist_version = COALESCE(qc_checklist_version, '1.0'),
    updated_at = now()
WHERE flow_type IN ('FLOW_VID_PROMPT', 'Video_Prompt_Generator');

-- Blocking check: must have a non-empty explicit prompt field.
INSERT INTO caf_core.qc_checklists (
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
  flow_type,
  qc_checklist_name,
  qc_checklist_version,
  notes
) VALUES (
  'vid_prompt__require_video_prompt',
  'Video prompt must be present',
  'not_empty',
  'video_prompt',
  NULL,
  NULL,
  'HIGH',
  true,
  'Missing video_prompt (prompt-led flow must provide an explicit HeyGen/agent prompt).',
  NULL,
  'FLOW_VID_PROMPT',
  'Video_Prompt_Generator',
  '1.0',
  'Blocking: prevents prompt-led jobs without explicit video_prompt from proceeding.'
)
ON CONFLICT (qc_checklist_name, qc_checklist_version, check_id) DO UPDATE SET
  check_name = EXCLUDED.check_name,
  check_type = EXCLUDED.check_type,
  field_path = EXCLUDED.field_path,
  operator = EXCLUDED.operator,
  threshold_value = EXCLUDED.threshold_value,
  severity = EXCLUDED.severity,
  blocking = EXCLUDED.blocking,
  failure_message = EXCLUDED.failure_message,
  auto_fix_action = EXCLUDED.auto_fix_action,
  flow_type = EXCLUDED.flow_type,
  qc_checklist_name = EXCLUDED.qc_checklist_name,
  qc_checklist_version = EXCLUDED.qc_checklist_version,
  notes = EXCLUDED.notes,
  updated_at = now();

COMMIT;

