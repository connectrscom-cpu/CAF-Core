-- Mimic carousel copy: reference per-job grounded visual guideline in user prompt (also appended in code).

UPDATE caf_core.prompt_templates
SET user_prompt_template = $$Write a top-performer **carousel mimic** copy package for:

{{creation_pack_json}}

Lane context (carousel media lane):
{{top_performer_mimic_knowledge}}

The user message also includes **mimic_visual_guideline_for_copy** and **mimic_render_context** for this job's grounded reference only (not other pack ideas).

When `mimic_render_context.copy_before_visual_mimic` is true (listicle or text-heavy reference):
- Read `mimic_render_context.target_slide_count` and match that slide count unless platform_constraints forbid it.
- Write **all** slide copy in this step — render extracts a background plate and overlays this text later.
- Mirror the reference slide structure (roles, pacing, list length) using `mimic_visual_guideline_for_copy.slides` — fresh wording only; do not transcribe on_screen_text_transcript verbatim.

When `mimic_render_context.render_sequence` is `per_slide_visual_mimic`:
- Prioritize caption + hashtags; keep on-slide copy short per slide (≤120 chars) unless schema requires more.

Preserve hook + slide architecture from the reference; vary wording for brand fit.

Return a single JSON object matching the carousel output schema.$$,
    updated_at = now()
WHERE prompt_name = 'MIMIC__Top_Performer_Carousel_v1'
  AND flow_type = 'FLOW_TOP_PERFORMER_MIMIC_CAROUSEL';
