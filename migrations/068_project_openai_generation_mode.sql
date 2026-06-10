-- Per-project OpenAI copy generation mode (null = server env OPENAI_GENERATION_MODE).
ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS openai_generation_mode text;

COMMENT ON COLUMN caf_core.project_system_constraints.openai_generation_mode IS
  'Job copy generation: live (OpenAI) | placeholder (stub, no API). NULL uses OPENAI_GENERATION_MODE env.';
