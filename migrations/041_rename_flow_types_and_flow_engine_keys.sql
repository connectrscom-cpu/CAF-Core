-- CAF Core — Migration 041: Rename flow_type identifiers + Flow Engine keys (compat)
--
-- Goal:
-- - Introduce short canonical UPPER_SNAKE_CASE flow identifiers (FLOW_*).
-- - Keep backward compatibility: legacy flow_type values remain usable through
--   code-level aliasing, and (optionally) by duplicating Flow Engine rows.
--
-- NOTE:
-- - `task_id` embeds flow_type, but this migration does NOT mutate task_id.
-- - Existing jobs keep their task_id; we may update `content_jobs.flow_type` for consistency.
--
-- Canonical flow ids (new):
--   Flow_Carousel_Copy          -> FLOW_CAROUSEL
--   Carousel_Angle_Extractor    -> FLOW_ANGLE
--   Carousel_Slide_Architecture -> FLOW_STRUCTURE
--   CTA_Generator               -> FLOW_CTA
--   Hook_Variations             -> FLOW_HOOKS
--   Text_Post_Generator         -> FLOW_TEXT
--   Video_Prompt_Generator      -> FLOW_VID_PROMPT
--   Video_Script_Generator      -> FLOW_VID_SCRIPT
--   Video_Scene_Generator       -> FLOW_VID_SCENES
--
-- Output schemas (rename by intent; keep old rows as aliases):
--   Carousel_Insight_Output         -> OS_CAROUSEL
--   Carousel_Angle_Output           -> OS_ANGLE
--   Carousel_Structure_Output       -> OS_STRUCTURE
--   CTA_Output                      -> OS_CTA
--   Hook_Variations_Output          -> OS_HOOKS
--   Text_Post_Output                -> OS_TEXT
--   Video_Prompt_Output             -> OS_VID_PROMPT
--   Video_Script_Output             -> OS_VID_SCRIPT
--   Video_Scene_Generator_Output    -> OS_VID_SCENES
--   Viral_Format_Output             -> OS_VIRAL

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Rename flow_type values across CAF tables that store them
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  CREATE TEMP TABLE _flow_type_rename(old_ft text PRIMARY KEY, new_ft text NOT NULL) ON COMMIT DROP;
  INSERT INTO _flow_type_rename(old_ft, new_ft) VALUES
    ('Flow_Carousel_Copy', 'FLOW_CAROUSEL'),
    ('Carousel_Angle_Extractor', 'FLOW_ANGLE'),
    ('Carousel_Slide_Architecture', 'FLOW_STRUCTURE'),
    ('CTA_Generator', 'FLOW_CTA'),
    ('Hook_Variations', 'FLOW_HOOKS'),
    ('Text_Post_Generator', 'FLOW_TEXT'),
    ('Video_Prompt_Generator', 'FLOW_VID_PROMPT'),
    ('Video_Script_Generator', 'FLOW_VID_SCRIPT'),
    ('Video_Scene_Generator', 'FLOW_VID_SCENES');

  -- Flow Engine tables
  UPDATE caf_core.flow_definitions f
    SET flow_type = r.new_ft, updated_at = now()
   FROM _flow_type_rename r
   WHERE f.flow_type = r.old_ft
     AND NOT EXISTS (SELECT 1 FROM caf_core.flow_definitions f2 WHERE f2.flow_type = r.new_ft);

  UPDATE caf_core.prompt_templates p
    SET flow_type = r.new_ft, updated_at = now()
   FROM _flow_type_rename r
   WHERE p.flow_type = r.old_ft;

  UPDATE caf_core.output_schemas s
    SET flow_type = r.new_ft, updated_at = now()
   FROM _flow_type_rename r
   WHERE s.flow_type = r.old_ft;

  UPDATE caf_core.qc_checklists q
    SET flow_type = r.new_ft
   FROM _flow_type_rename r
   WHERE q.flow_type = r.old_ft;

  -- Per-project allowed flow types
  UPDATE caf_core.allowed_flow_types a
    SET flow_type = r.new_ft, updated_at = now()
   FROM _flow_type_rename r
   WHERE a.flow_type = r.old_ft;

  -- Existing jobs
  UPDATE caf_core.content_jobs j
    SET flow_type = r.new_ft, updated_at = now()
   FROM _flow_type_rename r
   WHERE j.flow_type = r.old_ft;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Duplicate/rename output schemas to short names (keep old as aliases)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TEMP TABLE _schema_rename(old_name text PRIMARY KEY, new_name text NOT NULL) ON COMMIT DROP;
  INSERT INTO _schema_rename(old_name, new_name) VALUES
    ('Carousel_Insight_Output', 'OS_CAROUSEL'),
    ('Carousel_Angle_Output', 'OS_ANGLE'),
    ('Carousel_Structure_Output', 'OS_STRUCTURE'),
    ('CTA_Output', 'OS_CTA'),
    ('Hook_Variations_Output', 'OS_HOOKS'),
    ('Text_Post_Output', 'OS_TEXT'),
    ('Video_Prompt_Output', 'OS_VID_PROMPT'),
    ('Video_Script_Output', 'OS_VID_SCRIPT'),
    ('Video_Scene_Generator_Output', 'OS_VID_SCENES'),
    ('Viral_Format_Output', 'OS_VIRAL');

  -- Create new schema rows by copying old (if old exists and new doesn't).
  INSERT INTO caf_core.output_schemas (
    output_schema_name, output_schema_version, flow_type,
    schema_json, required_keys, field_types, example_output_json, parsing_notes
  )
  SELECT
    r.new_name,
    s.output_schema_version,
    s.flow_type,
    s.schema_json,
    s.required_keys,
    s.field_types,
    s.example_output_json,
    s.parsing_notes
  FROM caf_core.output_schemas s
  JOIN _schema_rename r ON r.old_name = s.output_schema_name
  WHERE NOT EXISTS (
    SELECT 1 FROM caf_core.output_schemas s2
    WHERE s2.output_schema_name = r.new_name AND s2.output_schema_version = s.output_schema_version
  );

  -- Update flow_definitions and prompt_templates references to prefer the new schema names.
  UPDATE caf_core.flow_definitions f
     SET output_schema_name = r.new_name, updated_at = now()
    FROM _schema_rename r
   WHERE f.output_schema_name = r.old_name;

  UPDATE caf_core.prompt_templates p
     SET output_schema_name = r.new_name, updated_at = now()
    FROM _schema_rename r
   WHERE p.output_schema_name = r.old_name;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Prompt template naming: prefix with flow association (keep old prompt_name aliases)
-- ---------------------------------------------------------------------------
-- Rule: NEW prompt_name = <FLOWKEY>__<OLD>, where FLOWKEY is canonical flow without FLOW_ prefix.
-- We *copy* rows instead of renaming in place so any job payload still pointing at the old prompt_id works.
DO $$
DECLARE
  row RECORD;
  flowkey text;
  new_prompt_name text;
BEGIN
  FOR row IN
    SELECT id, prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
           output_format_rule, output_schema_name, output_schema_version,
           temperature_default, max_tokens_default, stop_sequences, notes, active
      FROM caf_core.prompt_templates
     WHERE flow_type LIKE 'FLOW_%'
  LOOP
    flowkey := regexp_replace(row.flow_type, '^FLOW_', '');
    new_prompt_name := flowkey || '__' || row.prompt_name;

    -- Avoid double-prefixing if already namespaced.
    IF row.prompt_name ~ '^[A-Z0-9_]+__' THEN
      CONTINUE;
    END IF;

    -- Insert copy if it doesn't exist for the same flow_type.
    IF NOT EXISTS (
      SELECT 1 FROM caf_core.prompt_templates p2
       WHERE p2.prompt_name = new_prompt_name AND p2.flow_type = row.flow_type
    ) THEN
      INSERT INTO caf_core.prompt_templates (
        prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
        output_format_rule, output_schema_name, output_schema_version,
        temperature_default, max_tokens_default, stop_sequences, notes, active
      ) VALUES (
        new_prompt_name, row.flow_type, row.prompt_role, row.system_prompt, row.user_prompt_template,
        row.output_format_rule, row.output_schema_name, row.output_schema_version,
        row.temperature_default, row.max_tokens_default, row.stop_sequences, row.notes, row.active
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

