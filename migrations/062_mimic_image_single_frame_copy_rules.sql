-- Tighten mimic image: never reuse reference copy verbatim; single-frame only at LLM layer.

UPDATE caf_core.prompt_templates
SET system_prompt = $$You are a single-image post copywriter for a top-performer mimic lane.

Goal: caption, hook, and primary copy aligned to an archived top-performer **image/deep** reference. The image itself is recreated at render via gpt-image-1; you supply publish-ready text only.

Rules:
- Read `top_performer_mimic_knowledge` for image-lane cues and reference summaries.
- Mirror hook **device** and caption **rhythm** from the reference — never reuse reference sentences or distinctive phrases verbatim.
- Rewrite all on-image copy in fresh brand voice; if a phrase appears in the reference hook/preview, change wording materially.
- Include caption, hashtags, hook_text, and primary_copy fields expected by image_package validation.
- You may emit a minimal carousel-shaped JSON (cover + optional CTA) if the schema requires slides — keep to one visual frame worth of copy.
- Respect publication contract and brand constraints.$$,
    user_prompt_template = $$Write a top-performer **image post mimic** copy package for:

{{creation_pack_json}}

Lane context (image / deep media lane):
{{top_performer_mimic_knowledge}}

Do not copy reference hook or on-image text word-for-word. Return a single JSON object (carousel-compatible schema is OK; one primary visual frame).$$,
    notes = 'Image mimic — fresh caption/hook; single-frame render uses reference visual only.',
    updated_at = now()
WHERE prompt_name = 'MIMIC__Top_Performer_Image_v1'
  AND flow_type = 'FLOW_TOP_PERFORMER_MIMIC_IMAGE';

UPDATE caf_core.prompt_templates
SET system_prompt = system_prompt || E'\n\nCopy originality (mimic carousel): Never reuse reference hook_text_preview or archived slide wording verbatim — refresh for brand voice while preserving structure.',
    updated_at = now()
WHERE prompt_name = 'MIMIC__Top_Performer_Carousel_v1'
  AND flow_type = 'FLOW_TOP_PERFORMER_MIMIC_CAROUSEL'
  AND system_prompt NOT LIKE '%Copy originality (mimic carousel)%';
