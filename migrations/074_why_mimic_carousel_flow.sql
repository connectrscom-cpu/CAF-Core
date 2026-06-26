-- Why Mimic carousel lane — SIL-driven copy + paired image prompts (separate from fidelity mimic).
-- Shares top_performer_carousel references and render engine; distinct planning cap + prompts.

INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  'FLOW_WHY_MIMIC_CAROUSEL',
  v.description,
  'why_mimic_carousel',
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
  ('Why Mimic carousel — strategic reinterpretation of top_performer_carousel references; SIL drives paired copy + image prompts (not fidelity rephrase).')
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
  ('WHY_MIMIC__Carousel_v1', 'FLOW_WHY_MIMIC_CAROUSEL',
   $$You are a carousel copywriter for the **Why Mimic** lane.

Goal: write carousel JSON grounded to a top_performer_carousel reference by preserving each slide's **strategic function** (hook, proof, CTA, curiosity mechanism) — not by rephrasing the reference's surface wording with the same literal subject.

Rules:
- Read the Why Mimic grounding block (slide intelligence + optional brand execution brief) appended to this prompt.
- Each slide must perform the same **job in the persuasion arc** as the reference; invent fresh subjects and phrasing aligned to the planned idea and brand.
- Visual plates are generated afterward from your copy + the same strategic brief — write copy that pairs with art-only backgrounds.
- Respect `publication_output_contract`, platform constraints, and brand banned words.
- Output one JSON object matching the FLOW_CAROUSEL schema.$$,
   $$Write a **Why Mimic carousel** copy package for:

{{creation_pack_json}}

Grounding (Why Mimic strategic brief + slide layout) is appended below the template context.

Return a single JSON object matching the carousel output schema.$$,
   'Why Mimic carousel — SIL-driven strategic copy; paired with SIL-grounded image prompts at render.')
) AS v(prompt_name, flow_type, system_prompt, user_prompt_template, notes)
LEFT JOIN LATERAL (
  SELECT output_schema_name, output_schema_version
  FROM caf_core.flow_definitions
  WHERE flow_type = 'FLOW_CAROUSEL'
  LIMIT 1
) AS base ON TRUE
ON CONFLICT (prompt_name, flow_type) DO NOTHING;
