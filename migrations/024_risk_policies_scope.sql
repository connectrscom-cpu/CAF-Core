-- Scope `risk_policies` so they can apply to a specific `flow_type` instead of
-- running on every job. NULL means "global" to preserve today's behavior — the
-- QC runtime's `listRiskPoliciesForJob(flow_type)` returns `applies_to_flow_type
-- IS NULL OR = flow_type`. See Initiative 2 in the CAF Core build plan.
--
-- This migration is additive and backward compatible:
--   - existing rows default to NULL (global scan, unchanged behavior)
--   - the new helper `listRiskPoliciesForJob` filters by `flow_type` OR NULL
--   - the old `listRiskPolicies(db)` is preserved for admin listing
ALTER TABLE caf_core.risk_policies
  ADD COLUMN IF NOT EXISTS applies_to_flow_type text;

COMMENT ON COLUMN caf_core.risk_policies.applies_to_flow_type IS
  'Optional scope: when set, this policy only runs for content_jobs with the matching flow_type. NULL means the policy is global and applies to every job.';

CREATE INDEX IF NOT EXISTS risk_policies_flow_scope_idx
  ON caf_core.risk_policies (applies_to_flow_type)
  WHERE applies_to_flow_type IS NOT NULL;
