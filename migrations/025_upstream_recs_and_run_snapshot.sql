-- Post-approval LLM review: structured upstream recommendations + run-level
-- generation context snapshots (prompt versions, project config slice, learning
-- fingerprint). See docs/CAF_CORE_COMPLETE_GUIDE.md + approved-content-llm-review.ts.

-- ── 1. upstream_recommendations on llm_approval_reviews ──────────────────
ALTER TABLE caf_core.llm_approval_reviews
  ADD COLUMN IF NOT EXISTS upstream_recommendations jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN caf_core.llm_approval_reviews.upstream_recommendations IS
  'Structured list of what-to-change-upstream items emitted by the LLM reviewer. Each item: { target (prompt_template|output_schema|flow_definition|project_brand|learning_guidance|qc_checklist|other), change, rationale, field_or_check_id? }.';

-- ── 2. context_snapshot_json on runs ─────────────────────────────────────
-- Frozen snapshot of the generation context at planning time: which prompt
-- versions per flow_type, which project config slices, compiled learning
-- fingerprint + applied rule ids. Enables "what did we use vs what do we
-- recommend now" forensics across reruns.
ALTER TABLE caf_core.runs
  ADD COLUMN IF NOT EXISTS context_snapshot_json jsonb;

COMMENT ON COLUMN caf_core.runs.context_snapshot_json IS
  'Frozen generation-context snapshot captured at end-of-planning. See services/run-context-snapshot.ts.';
