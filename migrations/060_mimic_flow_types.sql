-- Optional top-performer mimic flow_type rows (disabled by default; seeded via seedMimicFlowTypesSkeleton).

-- No schema change required; mimic metadata lives on generation_payload.mimic_v1.

COMMENT ON COLUMN caf_core.content_jobs.generation_payload IS
  'Job JSON contract incl. generated_output, qc_result, render_manifest, mimic_v1 (top-performer visual mimic draft/render metadata).';
