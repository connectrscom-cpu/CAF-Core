ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS mimic_image_input_mode text;

COMMENT ON COLUMN caf_core.project_system_constraints.mimic_image_input_mode IS
  'Per-project mimic slide image input: reference_edit (Flux edit from archived frame) or analysis_t2i (LLM/Nemotron brief → text-to-image). NULL uses server MIMIC_IMAGE_INPUT_MODE.';
