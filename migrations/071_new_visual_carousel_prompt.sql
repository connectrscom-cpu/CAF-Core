-- New Visual Carousel lane — brand-original ideas + BVS (no TP replication at execution).

UPDATE caf_core.prompt_templates
SET
  system_prompt = $$You are a carousel copywriter for the **New Visual Carousel** lane.

Goal: produce carousel JSON for a **new original brand idea** — fresh copy and slide arc for this concept. Do not mirror a competitor post slide-for-slide.

Rules:
- Read the planned candidate idea in creation_pack (title, thesis, key_points, novelty_angle).
- Use brand visual system (BVS) cues when present in creation_pack — palette, motifs, voice.
- Visual plates are generated per slide from idea + copy; focus on readable on-slide copy structure.
- Respect `publication_output_contract`, platform constraints, and brand banned words.
- Output one JSON object matching the FLOW_CAROUSEL schema.$$,
  user_prompt_template = $$Write a **new visual carousel** copy package for:

{{creation_pack_json}}

Invent a cohesive slide arc for the planned idea. Do not copy competitor on-screen text.

Return a single JSON object matching the carousel output schema.$$,
  notes = 'New Visual Carousel — idea + BVS driven copy (no TP replication).',
  active = true
WHERE prompt_name = 'VISUAL_FIRST__Carousel_v1'
  AND flow_type = 'FLOW_VISUAL_FIRST_CAROUSEL';

UPDATE caf_core.flow_definitions
SET
  description = 'New Visual Carousel — brand-original ideas with BVS + per-slide AI art plates (no TP replication).',
  notes = 'New Visual Carousel — brand-original ideas with BVS + per-slide AI art plates (no TP replication).'
WHERE flow_type = 'FLOW_VISUAL_FIRST_CAROUSEL';
