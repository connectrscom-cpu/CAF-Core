-- Top-performer carousel / video: optional copies of remote slide & frame images in Supabase Storage for human inspection.

ALTER TABLE caf_core.inputs_evidence_row_insights
  ADD COLUMN IF NOT EXISTS stored_inspection_media_json jsonb;

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.stored_inspection_media_json IS
  'When CAF archives top-performer vision sources: bucket/object_path/public_url per slide or frame, plus errors. Null if not archived.';
