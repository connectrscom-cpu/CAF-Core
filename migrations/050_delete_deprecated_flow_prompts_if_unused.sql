-- CAF Core — Migration 050: Delete deprecated flow prompt templates if unused
--
-- Requested cleanup:
-- Remove prompt_templates (and prompt_labs_overrides) for flows that CAF deprecated as noise:
--   FLOW_ANGLE, FLOW_STRUCTURE, FLOW_CTA, FLOW_HOOKS
--
-- Safety:
-- Only hard-delete if there is no historical usage in caf_core.content_jobs for that flow_type.
-- If historical jobs exist, keep the rows (they should already be inactive) to avoid breaking
-- replay/debug tools that expect prompt templates to still be present.

DO $$
DECLARE
  ft text;
  used_count bigint;
BEGIN
  FOREACH ft IN ARRAY ARRAY['FLOW_ANGLE','FLOW_STRUCTURE','FLOW_CTA','FLOW_HOOKS']
  LOOP
    SELECT COUNT(*) INTO used_count
      FROM caf_core.content_jobs
     WHERE flow_type = ft;

    IF used_count = 0 THEN
      -- Delete Prompt Labs overrides first (keyed by prompt_name only)
      DELETE FROM caf_core.prompt_labs_overrides o
      USING caf_core.prompt_templates p
      WHERE p.flow_type = ft
        AND o.prompt_name = p.prompt_name;

      -- Delete templates
      DELETE FROM caf_core.prompt_templates
      WHERE flow_type = ft;

      -- (Optional) keep flow_definitions row; deleting it can break historical inspection.
    END IF;
  END LOOP;
END $$;

