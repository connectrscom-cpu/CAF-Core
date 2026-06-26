-- Why Mimic copy mode: when false (default), mimic carousel copy uses semantic fidelity only
-- (rephrase same idea/subject). When true, the generator also receives strategic-function /
-- brand-translation blocks from slide_intelligence_v1. NULL = server env default.

ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS why_mimic_copy_enabled boolean;

COMMENT ON COLUMN caf_core.project_system_constraints.why_mimic_copy_enabled IS
  'When true, TP-grounded carousel copy generation adds Why Mimic (strategic function) + brand translation prompt blocks. When false, only slide_copy_layout semantic fidelity (exact subject rephrase). NULL uses MIMIC_WHY_COPY_ENABLED env (default false).';
