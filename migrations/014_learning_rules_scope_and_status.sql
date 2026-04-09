-- CAF Core — Migration 014: Learning rules scope + lifecycle compatibility
-- Brings caf_core.learning_rules schema in line with current code expectations:
-- - adds scope_type / rule_family and evidence + validity window fields
-- - allows 'expired' status (used by retireLearningRule)

ALTER TABLE caf_core.learning_rules
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS rule_family text,
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS hypothesis_id text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS provenance text,
  ADD COLUMN IF NOT EXISTS created_by text;

-- Ensure validity window semantics have a sensible default.
UPDATE caf_core.learning_rules
SET valid_from = COALESCE(valid_from, created_at)
WHERE valid_from IS NULL;

-- The initial schema used a CHECK constraint on status that didn't include 'expired'.
-- Drop any existing status CHECK constraints, then add a compatible one.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'caf_core.learning_rules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE caf_core.learning_rules DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;

  ALTER TABLE caf_core.learning_rules
    ADD CONSTRAINT learning_rules_status_check
      CHECK (status IN ('pending', 'active', 'superseded', 'rejected', 'expired'));
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists; ok.
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_learning_rules_project_scope
  ON caf_core.learning_rules(project_id, scope_type, status);

