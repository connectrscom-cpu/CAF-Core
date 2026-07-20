-- Learning loop upgrades: planning-side attribution + holdout experiment support.
--
-- 1. `phase` distinguishes generation-path attribution (existing rows, prompt guidance)
--    from planning-path attribution (ranking rules applied in decideGenerationPlan).
-- 2. Planning rows are written before a task_id exists, so they are keyed by
--    (project_id, candidate_id, run_id) and task_id becomes nullable. Task resolution
--    joins content_jobs on the documented text-ID pattern (project_id, candidate_id, run_id).
-- 3. `control_rule_ids` records rules that were withheld from this generation because the
--    job fell into a holdout control group (learning experiments) — the counterfactual side
--    of `applied_rule_ids`.

ALTER TABLE caf_core.learning_generation_attribution
  ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE caf_core.learning_generation_attribution
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'generation',
  ADD COLUMN IF NOT EXISTS candidate_id text,
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS control_rule_ids jsonb NOT NULL DEFAULT '[]';

DO $$
BEGIN
  ALTER TABLE caf_core.learning_generation_attribution
    ADD CONSTRAINT learning_gen_attr_phase_check
      CHECK (phase IN ('generation', 'planning'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_learning_gen_attr_project_phase
  ON caf_core.learning_generation_attribution (project_id, phase, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_gen_attr_candidate
  ON caf_core.learning_generation_attribution (project_id, candidate_id)
  WHERE candidate_id IS NOT NULL;
