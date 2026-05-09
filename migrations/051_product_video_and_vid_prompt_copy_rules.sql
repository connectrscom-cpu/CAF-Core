-- CAF Core — Migration 051: Append product-flow copy rules + VID_PROMPT prep contract (non-destructive).
-- Idempotent via substring guards so Prompt Labs edits are preserved and re-runs are safe.

BEGIN;

UPDATE caf_core.prompt_templates
SET system_prompt = system_prompt || $patch$

---
CAF-051 product video copy (hashtags + VO shape)
- `hashtags`: use ONLY bare tokens from `product_video_hashtag_allowlist` or `signal_pack_publication_hints.hashtag_seeds` / `signal_pack_filtered_hashtags` in the creation pack. Pick 3–8 substantive tags; never invent tags outside those lists when non-empty. If every list is empty, omit hashtags rather than inventing scraper noise.
- `spoken_script` MUST be one JSON string (single voiceover). Do not return `spoken_script` as a nested object with hook/agitate/demo fields — combine sections into one fluent VO. You may still set top-level `hook` for editors.
$patch$
WHERE flow_type LIKE 'FLOW_PRODUCT_%'
  AND prompt_role = 'generator'
  AND position('CAF-051 product video copy' in system_prompt) = 0;

UPDATE caf_core.prompt_templates
SET system_prompt = system_prompt || $sp$

CAF-051 (social proof sources): anchor quantitative claims in `product_profile` (proof_points, ratings, review_stats, social_proof). Use `brand_constraints.proof_points` only when product_profile lacks usable proof. Star-rating or numeric-score visuals only when a numeric rating exists in inputs; otherwise use quotes or qualitative social proof only.
$sp$
WHERE flow_type = 'FLOW_PRODUCT_SOCIAL_PROOF'
  AND prompt_role = 'generator'
  AND position('CAF-051 (social proof sources)' in system_prompt) = 0;

UPDATE caf_core.prompt_templates
SET system_prompt = system_prompt || $uc$

CAF-051 (use case): If the candidate names another product, app, or brand that is not `product_profile.product_name`, do not promote it. The VO must center on the product_profile offering; use the candidate only as thematic context, not as an alternate offer.
$uc$
WHERE flow_type = 'FLOW_PRODUCT_USECASE'
  AND prompt_role = 'generator'
  AND position('CAF-051 (use case)' in system_prompt) = 0;

UPDATE caf_core.prompt_templates
SET system_prompt = system_prompt || $cmp$

CAF-051 (comparison): `spoken_script` must be plain speech for TTS — do not wrap the entire script in outer quotation marks.
$cmp$
WHERE flow_type = 'FLOW_PRODUCT_COMPARISON'
  AND prompt_role = 'generator'
  AND position('CAF-051 (comparison)' in system_prompt) = 0;

UPDATE caf_core.prompt_templates
SET user_prompt_template = user_prompt_template || $vp$

---
CAF-051: REQUIRED top-level string field `video_prompt` (non-empty, at least ~10 characters): full instruction for the video agent (scenes, visuals, pacing, on-screen text, how VO relates). Other structured fields are optional for editors; QC expects `video_prompt`.
$vp$
WHERE flow_type = 'FLOW_VID_PROMPT'
  AND prompt_name IN ('VID_PROMPT__HeyGen_Video_Prompt_Prep_v1', 'VID_PROMPT__Prompt_Video_Prompt_v1')
  AND position('CAF-051: REQUIRED top-level' in user_prompt_template) = 0;

COMMIT;
