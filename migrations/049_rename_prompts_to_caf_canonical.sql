-- CAF Core — Migration 049: Rename prompt_templates to CAF-canonical names (non-breaking)
--
-- Goal:
-- - Remove project-flavored names like "SNS_*" from prompt_name where those templates are CAF-level.
-- - Make prompt_name communicate where the prompt fits in the pipeline.
--
-- Safety:
-- - DO NOT hard-rename in place (old jobs/payloads may reference old prompt_name).
-- - Instead: copy old → new, then deactivate the old row.
-- - Also copy Prompt Labs overrides keyed by prompt_name so operator edits are preserved.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Define explicit rename map (old → new) for CAF-level prompts
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _prompt_rename_map(
  flow_type text NOT NULL,
  old_prompt_name text NOT NULL,
  new_prompt_name text NOT NULL,
  PRIMARY KEY(flow_type, old_prompt_name)
) ON COMMIT DROP;

INSERT INTO _prompt_rename_map(flow_type, old_prompt_name, new_prompt_name) VALUES
  -- Carousel generation (CAF-level)
  ('FLOW_CAROUSEL', 'CAROUSEL__SNS_Carousel_Insight_Generator', 'CAROUSEL__Carousel_Generator_v1'),

  -- Hooks generation (CAF-level)
  ('FLOW_HOOKS', 'HOOKS__SNS_Hook_Variations_Generator', 'HOOKS__Hooks_Generator_v1'),

  -- Video prompt prep (CAF-level)
  ('FLOW_VID_PROMPT', 'VID_PROMPT__Prompt_Video_Prompt_v1', 'VID_PROMPT__HeyGen_Video_Prompt_Prep_v1'),

  -- Video script prep (CAF-level)
  ('FLOW_VID_SCRIPT', 'VID_SCRIPT__Prompt_Video_Script_v1', 'VID_SCRIPT__HeyGen_Video_Script_Prep_v1'),

  -- Scene prompts (CAF-level; used by scene generator)
  ('FLOW_VID_SCENES', 'VID_SCENES__Create_Scene_Prompts', 'VID_SCENES__Scene_Prompt_Generator_v1');

-- ---------------------------------------------------------------------------
-- 2) Copy prompt_templates old → new (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO caf_core.prompt_templates (
  prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
  output_format_rule, output_schema_name, output_schema_version,
  temperature_default, max_tokens_default, stop_sequences, notes, active
)
SELECT
  m.new_prompt_name,
  p.flow_type,
  p.prompt_role,
  p.system_prompt,
  p.user_prompt_template,
  p.output_format_rule,
  p.output_schema_name,
  p.output_schema_version,
  p.temperature_default,
  p.max_tokens_default,
  p.stop_sequences,
  CASE
    WHEN COALESCE(p.notes, '') = '' THEN 'CAF canonical prompt_name (renamed from ' || m.old_prompt_name || ').'
    ELSE p.notes || E'\n\n' || 'CAF canonical prompt_name (renamed from ' || m.old_prompt_name || ').'
  END,
  p.active
FROM _prompt_rename_map m
JOIN caf_core.prompt_templates p
  ON p.flow_type = m.flow_type
 AND p.prompt_name = m.old_prompt_name
WHERE NOT EXISTS (
  SELECT 1
  FROM caf_core.prompt_templates p2
  WHERE p2.flow_type = m.flow_type
    AND p2.prompt_name = m.new_prompt_name
);

-- ---------------------------------------------------------------------------
-- 3) Copy Prompt Labs overrides keyed by prompt_name (best-effort)
-- ---------------------------------------------------------------------------
INSERT INTO caf_core.prompt_labs_overrides (
  prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
  output_format_rule, notes, updated_at
)
SELECT
  m.new_prompt_name,
  o.flow_type,
  o.prompt_role,
  o.system_prompt,
  o.user_prompt_template,
  o.output_format_rule,
  CASE
    WHEN COALESCE(o.notes, '') = '' THEN 'CAF canonical prompt_name (copied from override for ' || m.old_prompt_name || ').'
    ELSE o.notes || E'\n\n' || 'CAF canonical prompt_name (copied from override for ' || m.old_prompt_name || ').'
  END,
  now()
FROM _prompt_rename_map m
JOIN caf_core.prompt_labs_overrides o
  ON o.prompt_name = m.old_prompt_name
WHERE NOT EXISTS (
  SELECT 1 FROM caf_core.prompt_labs_overrides o2 WHERE o2.prompt_name = m.new_prompt_name
);

-- ---------------------------------------------------------------------------
-- 4) Deactivate old prompt_templates (so Prompt Labs shows the canonical names)
-- ---------------------------------------------------------------------------
UPDATE caf_core.prompt_templates p
   SET active = false,
       notes = CASE
         WHEN COALESCE(p.notes, '') ILIKE '%caf canonical prompt_name%' THEN p.notes
         WHEN COALESCE(p.notes, '') = '' THEN 'Alias (deprecated prompt_name). Use CAF canonical prompt_name instead.'
         ELSE p.notes || E'\n\n' || 'Alias (deprecated prompt_name). Use CAF canonical prompt_name instead.'
       END,
       updated_at = now()
  FROM _prompt_rename_map m
 WHERE p.flow_type = m.flow_type
   AND p.prompt_name = m.old_prompt_name
   AND p.active = true;

COMMIT;

