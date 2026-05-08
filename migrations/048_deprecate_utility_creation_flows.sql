-- CAF Core — Migration 048: Deprecate utility "creation" flows (noise reduction)
--
-- These flows were introduced as optional prep utilities (angle/structure/cta/hooks)
-- but are not part of CAF's default generation path and often create operator noise.
--
-- We avoid hard-deleting rows to preserve historical compatibility for any jobs/runs
-- that reference these flow_type ids. Instead, we:
-- - disable them for all projects in allowed_flow_types
-- - deactivate their prompt_templates (Flow Engine catalog)
-- - annotate flow_definitions.notes as deprecated (best-effort)

BEGIN;

-- 1) Disable in allowed_flow_types (project-scoped)
UPDATE caf_core.allowed_flow_types
   SET enabled = false,
       updated_at = now()
 WHERE flow_type IN ('FLOW_ANGLE', 'FLOW_STRUCTURE', 'FLOW_CTA', 'FLOW_HOOKS');

-- 2) Deactivate prompt templates (CAF-level catalog)
UPDATE caf_core.prompt_templates
   SET active = false,
       notes = CASE
         WHEN COALESCE(notes, '') ILIKE '%deprecated%' THEN notes
         WHEN COALESCE(notes, '') = '' THEN 'DEPRECATED: utility prep flow (noise reduction). Not part of canonical CAF generation path.'
         ELSE notes || E'\n\n' || 'DEPRECATED: utility prep flow (noise reduction). Not part of canonical CAF generation path.'
       END,
       updated_at = now()
 WHERE flow_type IN ('FLOW_ANGLE', 'FLOW_STRUCTURE', 'FLOW_CTA', 'FLOW_HOOKS');

-- 3) Mark flow definitions (best-effort, no schema change)
UPDATE caf_core.flow_definitions
   SET notes = CASE
         WHEN COALESCE(notes, '') ILIKE '%deprecated%' THEN notes
         WHEN COALESCE(notes, '') = '' THEN 'DEPRECATED: utility prep flow (noise reduction).'
         ELSE notes || E'\n\n' || 'DEPRECATED: utility prep flow (noise reduction).'
       END,
       updated_at = now()
 WHERE flow_type IN ('FLOW_ANGLE', 'FLOW_STRUCTURE', 'FLOW_CTA', 'FLOW_HOOKS');

COMMIT;

