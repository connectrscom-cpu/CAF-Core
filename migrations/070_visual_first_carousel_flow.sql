-- Visual-first carousel lane (ideas_json carousel_style=visual_first) — separate flow_type from manual mimic picks.
-- Shares top-performer carousel render engine; distinct planning cap + prompts.

INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  'FLOW_VISUAL_FIRST_CAROUSEL',
  v.description,
  'visual_first_carousel',
  base.supported_platforms,
  base.output_asset_types,
  true, true, true,
  base.required_inputs, base.optional_inputs,
  1,
  base.output_schema_name, base.output_schema_version,
  base.qc_checklist_name, base.qc_checklist_version,
  base.risk_profile_default,
  base.candidate_row_template,
  v.description
FROM (VALUES
  ('Visual-first carousel — new ideas grounded to top_performer_carousel references; TP-grounded render (not templated FLOW_CAROUSEL).')
) AS v(description)
LEFT JOIN LATERAL (
  SELECT supported_platforms, output_asset_types, required_inputs, optional_inputs,
         output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
         risk_profile_default, candidate_row_template
  FROM caf_core.flow_definitions
  WHERE flow_type = 'FLOW_TOP_PERFORMER_MIMIC_CAROUSEL'
  LIMIT 1
) AS base ON TRUE
ON CONFLICT (flow_type) DO NOTHING;

INSERT INTO caf_core.prompt_templates (
  prompt_name, flow_type, prompt_role,
  system_prompt, user_prompt_template,
  output_format_rule, output_schema_name, output_schema_version,
  temperature_default, max_tokens_default, stop_sequences, notes, active
)
SELECT
  v.prompt_name, v.flow_type, 'generator',
  v.system_prompt, v.user_prompt_template,
  'json_object', base.output_schema_name, base.output_schema_version,
  0.85, 5500, NULL, v.notes, true
FROM (VALUES
  ('VISUAL_FIRST__Carousel_v1', 'FLOW_VISUAL_FIRST_CAROUSEL',
   $$You are a carousel copywriter for the **visual-first carousel** lane.

Goal: produce carousel JSON for a **new original idea** (from ideas_json) that is grounded to a top_performer_carousel reference. Mirror the reference **structure and persuasion pattern** (hook device, slide pacing, CTA shape) while writing fresh copy for the planned idea — not a verbatim competitor replica.

Rules:
- Read `top_performer_mimic_knowledge` / creation_pack for deck structure hints from the grounded reference.
- Honor the planned candidate idea (title, thesis, key_points) — this is not a manual mimic pick.
- Visual plates are generated at render; focus on copy structure and on-slide readability.
- Respect `publication_output_contract`, platform constraints, and brand banned words.
- Output one JSON object matching the FLOW_CAROUSEL schema.$$,
   $$Write a **visual-first carousel** copy package for:

{{creation_pack_json}}

Reference lane context (carousel media lane):
{{top_performer_mimic_knowledge}}

Ground the slide architecture in the reference; write fresh copy for the planned idea.

Return a single JSON object matching the carousel output schema.$$,
   'Visual-first carousel — idea-driven copy grounded to TP carousel reference.')
) AS v(prompt_name, flow_type, system_prompt, user_prompt_template, notes)
LEFT JOIN LATERAL (
  SELECT output_schema_name, output_schema_version
  FROM caf_core.flow_definitions
  WHERE flow_type = 'FLOW_CAROUSEL'
  LIMIT 1
) AS base ON TRUE
ON CONFLICT (prompt_name, flow_type) DO NOTHING;
