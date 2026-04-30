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
-- NOTE: production may have a legacy qc_checklists table without the UNIQUE constraint
-- (qc_checklist_name, qc_checklist_version, check_id) and without updated_at. Keep this
-- migration idempotent without relying on ON CONFLICT.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM caf_core.qc_checklists
     WHERE qc_checklist_name = 'Video_Prompt_Generator'
       AND qc_checklist_version = '1.0'
       AND check_id = 'vid_prompt__require_video_prompt'
  ) THEN
    UPDATE caf_core.qc_checklists
       SET check_name = 'Video prompt must be present',
           check_type = 'not_empty',
           field_path = 'video_prompt',
           operator = NULL,
           threshold_value = NULL,
           severity = 'HIGH',
           blocking = true,
           failure_message = 'Missing video_prompt (prompt-led flow must provide an explicit HeyGen/agent prompt).',
           auto_fix_action = NULL,
           flow_type = 'FLOW_VID_PROMPT',
           notes = 'Blocking: prevents prompt-led jobs without explicit video_prompt from proceeding.'
     WHERE qc_checklist_name = 'Video_Prompt_Generator'
       AND qc_checklist_version = '1.0'
       AND check_id = 'vid_prompt__require_video_prompt';
  ELSE
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
    );
  END IF;
END $$;

COMMIT;

