-- Per-project HeyGen routing mode for FLOW_PRODUCT_* (and other flows that want an explicit override).
--
-- Values:
--   'script_led'  -> POST /v3/videos with avatar TTS reading spoken_script verbatim.
--   'prompt_led'  -> POST /v3/video-agents where HeyGen's agent authors and speaks its own VO
--                    from the visual_direction / video_prompt block.
--   NULL          -> fall back to code default (regex on flow_type for legacy flows;
--                    baked-in default mapping for FLOW_PRODUCT_*: FEATURE/COMPARISON/OFFER/USECASE
--                    script_led; PROBLEM/SOCIAL_PROOF prompt_led).
--
-- This lets operators flip a product angle between verbatim-copy and free-creative-direction
-- per project from the Flow Types settings tab without a code change.
ALTER TABLE caf_core.allowed_flow_types
  ADD COLUMN IF NOT EXISTS heygen_mode text;

ALTER TABLE caf_core.allowed_flow_types
  DROP CONSTRAINT IF EXISTS allowed_flow_types_heygen_mode_check;

ALTER TABLE caf_core.allowed_flow_types
  ADD CONSTRAINT allowed_flow_types_heygen_mode_check
  CHECK (heygen_mode IS NULL OR heygen_mode IN ('script_led', 'prompt_led'));

COMMENT ON COLUMN caf_core.allowed_flow_types.heygen_mode IS
  'Per-project override: script_led -> /v3/videos verbatim TTS; prompt_led -> /v3/video-agents free creative. NULL = code default.';
