-- CAF Core — Migration 052: Canonical FLOW_VID_PROMPT_NO_AVATAR (HeyGen Video Agent, no avatar)
--
-- Fixes: Video_Prompt_HeyGen_NoAvatar previously aliased to FLOW_VID_PROMPT (same as avatar prompt),
-- which dropped HEYGEN_NO_AVATAR routing. Code maps no-avatar flows to FLOW_VID_PROMPT_NO_AVATAR.
-- This migration seeds allowed_flow_types for existing projects so the flow appears in admin.

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
  'FLOW_VID_PROMPT_NO_AVATAR',
  true,
  1,
  true,
  false,
  NULL,
  NULL,
  NULL,
  NULL,
  6,
  'Single video — prompt JSON → HeyGen Video Agent (no on-camera avatar; narration + motion/stock/graphics).',
  NULL
FROM caf_core.projects p
WHERE NOT EXISTS (
  SELECT 1
  FROM caf_core.allowed_flow_types a
  WHERE a.project_id = p.id
    AND a.flow_type = 'FLOW_VID_PROMPT_NO_AVATAR'
);

COMMIT;
