-- Carousel render typography defaults per project + platform (merged into generation_payload.generated_output.render).

ALTER TABLE caf_core.platform_constraints
  ADD COLUMN IF NOT EXISTS carousel_headline_font_px integer,
  ADD COLUMN IF NOT EXISTS carousel_body_font_px integer,
  ADD COLUMN IF NOT EXISTS carousel_kicker_font_px integer,
  ADD COLUMN IF NOT EXISTS carousel_cta_font_px integer,
  ADD COLUMN IF NOT EXISTS carousel_handle_font_px integer,
  ADD COLUMN IF NOT EXISTS carousel_font_scale numeric(6, 4);

COMMENT ON COLUMN caf_core.platform_constraints.carousel_headline_font_px IS 'Default carousel headline CSS size (px) for this platform; merged into generated_output.render';
COMMENT ON COLUMN caf_core.platform_constraints.carousel_body_font_px IS 'Default carousel body CSS size (px)';
COMMENT ON COLUMN caf_core.platform_constraints.carousel_kicker_font_px IS 'Default carousel kicker CSS size (px)';
COMMENT ON COLUMN caf_core.platform_constraints.carousel_cta_font_px IS 'Default carousel CTA CSS size (px)';
COMMENT ON COLUMN caf_core.platform_constraints.carousel_handle_font_px IS 'Default carousel handle CSS size (px)';
COMMENT ON COLUMN caf_core.platform_constraints.carousel_font_scale IS 'Optional global scale (e.g. 0.9–1.1) merged as render.font_scale';
