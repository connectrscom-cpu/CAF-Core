-- Marks editorial review rows already folded into editorial analysis (learning loop B).
-- Only submitted decisions with a non-null verdict participate; rework placeholder rows stay untouched.

ALTER TABLE caf_core.editorial_reviews
  ADD COLUMN IF NOT EXISTS editorial_analysis_consumed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_editorial_pending_analysis
  ON caf_core.editorial_reviews (project_id, created_at DESC)
  WHERE submit = true
    AND decision IS NOT NULL
    AND editorial_analysis_consumed_at IS NULL;
