-- Per-project BFL FLUX model for top-performer mimic image edits (null = server env default).
ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS mimic_image_bfl_model text;

COMMENT ON COLUMN caf_core.project_system_constraints.mimic_image_bfl_model IS
  'BFL endpoint slug for mimic renders: flux-2-klein-4b | flux-2-flex. NULL uses MIMIC_IMAGE_BFL_MODEL env.';
