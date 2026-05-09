-- Estimated provider/host costs for observability (carousel Fly-time proxy, HeyGen $/min).

ALTER TABLE caf_core.api_call_audit
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS billable_video_seconds numeric(14,6),
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(14,6);

COMMENT ON COLUMN caf_core.api_call_audit.latency_ms IS 'Wall-clock ms for carousel POST /render-binary (one slide attempt).';
COMMENT ON COLUMN caf_core.api_call_audit.billable_video_seconds IS 'Rendered output duration when known (HeyGen status poll).';
COMMENT ON COLUMN caf_core.api_call_audit.estimated_cost_usd IS 'Rough USD from CAF_COST_* env at insert time; not invoice-grade.';
