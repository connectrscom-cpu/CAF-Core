-- Optional traceability for rework chains and exported publish URLs (also stored in generation_payload).

ALTER TABLE caf_core.content_jobs
  ADD COLUMN IF NOT EXISTS rework_parent_task_id text;

COMMENT ON COLUMN caf_core.content_jobs.rework_parent_task_id IS 'Original task_id when this row was created by rework orchestration (mirror of generation_payload.rework_parent_task_id).';
