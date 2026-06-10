-- Per-project mimic render knobs (null = server env default).
ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS mimic_visual_similarity_pct smallint,
  ADD COLUMN IF NOT EXISTS mimic_carousel_text_via_flux boolean;

COMMENT ON COLUMN caf_core.project_system_constraints.mimic_visual_similarity_pct IS
  'Target visual similarity for full-bleed mimic variants (50–95). NULL uses MIMIC_VISUAL_SIMILARITY_PCT env (default 70).';

COMMENT ON COLUMN caf_core.project_system_constraints.mimic_carousel_text_via_flux IS
  'When true, on-image copy is baked by the image model. When false, art-only plate + Puppeteer HBS. NULL uses MIMIC_CAROUSEL_TEXT_VIA_FLUX env.';
