-- Denormalized evidence-row rating snapshot on top-performer insight rows (for ideas LLM + lineage).
-- Broad tier rows keep this NULL.

ALTER TABLE caf_core.inputs_evidence_row_insights
  ADD COLUMN IF NOT EXISTS evidence_performance_review_json jsonb;

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.evidence_performance_review_json IS
  'Snapshot from inputs_evidence_rows rating pass when present: rating_score, rating_components_json, rating_rationale, rated_at. Populated on top_performer_* upserts when the row is already rated, and refreshed via backfill after signal-pack rating.';
