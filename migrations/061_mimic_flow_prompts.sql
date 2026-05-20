-- Flow Engine rows for top-performer mimic flows (carousel + single-image post).
--
-- Inherits carousel output schema / QC from FLOW_CAROUSEL so renderer + validation stay unchanged.
-- Idempotent: ON CONFLICT DO NOTHING preserves operator edits from Prompt Labs.

-- ---------------------------------------------------------------------------
-- Flow Definitions
-- ---------------------------------------------------------------------------
INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  v.flow_type,
  v.description,
  'top_performer_mimic',
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
  ('FLOW_TOP_PERFORMER_MIMIC_CAROUSEL',
   'Top-performer carousel mimic — preserve hook/copy structure from archived reference; visual twist applied at render via gpt-image-1.'),
  ('FLOW_TOP_PERFORMER_MIMIC_IMAGE',
   'Top-performer single-image post mimic — caption/hook aligned to archived reference; image recreated at render via gpt-image-1.')
) AS v(flow_type, description)
LEFT JOIN LATERAL (
  SELECT supported_platforms, output_asset_types, required_inputs, optional_inputs,
         output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
         risk_profile_default, candidate_row_template
  FROM caf_core.flow_definitions
  WHERE flow_type = 'FLOW_CAROUSEL'
  LIMIT 1
) AS base ON TRUE
ON CONFLICT (flow_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Prompt Templates
-- ---------------------------------------------------------------------------
INSERT INTO caf_core.prompt_templates (
  prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
  output_format_rule, output_schema_name, output_schema_version,
  temperature_default, max_tokens_default, stop_sequences, notes, active
)
SELECT
  v.prompt_name, v.flow_type, 'generator',
  v.system_prompt, v.user_prompt_template,
  'json_object', base.output_schema_name, base.output_schema_version,
  0.85, 5500, NULL, v.notes, true
FROM (VALUES
  ('MIMIC__Top_Performer_Carousel_v1', 'FLOW_TOP_PERFORMER_MIMIC_CAROUSEL',
   $$You are a carousel copywriter for a top-performer mimic lane.

Goal: produce carousel JSON that mirrors the **structure and persuasion pattern** of the referenced top performer (hook device, slide pacing, CTA shape) while allowing **visual-only** variation at render time.

Rules:
- Read `top_performer_mimic_knowledge` / `creation_pack.top_performer_mimic_knowledge` for lane-specific cues, deck structure hints, and reference entry summaries.
- Do NOT invent a unrelated angle — stay faithful to the reference pattern the candidate is grounded to.
- Copy may be refreshed for brand voice, but slide count, hook type, and narrative arc should match the reference blueprint.
- Visual descriptions in slides are hints for the render phase; do not assume pixel-perfect reuse of logos, faces, or copyrighted assets.
- Respect `publication_output_contract`, platform constraints, and brand banned words.
- Output one JSON object matching the FLOW_CAROUSEL schema (cover, body slides, CTA, caption, hashtags).$$,
   $$Write a top-performer **carousel mimic** copy package for:

{{creation_pack_json}}

Lane context (carousel media lane):
{{top_performer_mimic_knowledge}}

Preserve hook + slide architecture from the reference; vary wording for brand fit. Visual mimic happens later — focus on copy structure.

Return a single JSON object matching the carousel output schema.$$,
   'Carousel mimic — structure-faithful copy; visuals generated at render.'),

  ('MIMIC__Top_Performer_Image_v1', 'FLOW_TOP_PERFORMER_MIMIC_IMAGE',
   $$You are a single-image post copywriter for a top-performer mimic lane.

Goal: caption, hook, and primary copy aligned to an archived top-performer **image/deep** reference. The image itself is recreated at render via gpt-image-1; you supply publish-ready text only.

Rules:
- Read `top_performer_mimic_knowledge` for image-lane cues and reference summaries.
- Mirror hook device and caption rhythm from the reference; refresh wording for brand voice.
- Include caption, hashtags, hook_text, and primary_copy fields expected by image_package validation.
- You may emit a minimal carousel-shaped JSON (cover + optional CTA) if the schema requires slides — keep to one visual frame worth of copy.
- Respect publication contract and brand constraints.$$,
   $$Write a top-performer **image post mimic** copy package for:

{{creation_pack_json}}

Lane context (image / deep media lane):
{{top_performer_mimic_knowledge}}

Return a single JSON object (carousel-compatible schema is OK; one primary visual frame).$$,
   'Image mimic — caption/hook only; STATIC_IMAGE render uses reference at render time.')
) AS v(prompt_name, flow_type, system_prompt, user_prompt_template, notes)
LEFT JOIN LATERAL (
  SELECT output_schema_name, output_schema_version
  FROM caf_core.flow_definitions
  WHERE flow_type = 'FLOW_CAROUSEL'
  LIMIT 1
) AS base ON TRUE
ON CONFLICT (prompt_name, flow_type) DO NOTHING;
