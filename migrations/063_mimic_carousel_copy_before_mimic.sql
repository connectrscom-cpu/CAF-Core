-- Mimic carousel: resolve reference + render plan before LLM copy when listicle / text-heavy.

UPDATE caf_core.prompt_templates
SET user_prompt_template = $$Write a top-performer **carousel mimic** copy package for:

{{creation_pack_json}}

Lane context (carousel media lane):
{{top_performer_mimic_knowledge}}

When `mimic_render_context.copy_before_visual_mimic` is true (listicle or text-heavy reference):
- Read `mimic_render_context.target_slide_count` and match that slide count unless platform_constraints forbid it.
- Write **all** slide copy in this step — render extracts a background plate and overlays this text later; gpt-image-1 does not run until copy exists.
- Do not reuse reference hook_text_preview or on-screen transcripts verbatim.

Preserve hook + slide architecture from the reference; vary wording for brand fit.

Return a single JSON object matching the carousel output schema.$$,
    updated_at = now()
WHERE prompt_name = 'MIMIC__Top_Performer_Carousel_v1'
  AND flow_type = 'FLOW_TOP_PERFORMER_MIMIC_CAROUSEL';
