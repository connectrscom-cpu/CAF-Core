-- Per-ingest Instagram (and future) evidence media rows for audit + archive pipeline.

CREATE TABLE IF NOT EXISTS caf_core.evidence_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  evidence_row_id bigint NOT NULL REFERENCES caf_core.inputs_evidence_rows(id) ON DELETE CASCADE,
  source_platform text NOT NULL DEFAULT 'instagram',
  source_post_url text,
  source_post_id text,
  source_owner_username text,
  source_url text NOT NULL,
  source_field text,
  asset_role text NOT NULL,
  media_type text NOT NULL,
  slide_index integer,
  storage_bucket text,
  storage_path text,
  public_url text,
  signed_url_expires_at timestamptz,
  archive_status text NOT NULL DEFAULT 'pending',
  error_message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_media_assets_project_row
  ON caf_core.evidence_media_assets(project_id, evidence_row_id);

CREATE INDEX IF NOT EXISTS idx_evidence_media_assets_project_post_id
  ON caf_core.evidence_media_assets(project_id, source_post_id);

CREATE INDEX IF NOT EXISTS idx_evidence_media_assets_project_post_url
  ON caf_core.evidence_media_assets(project_id, source_post_url);

CREATE INDEX IF NOT EXISTS idx_evidence_media_assets_project_archive_status
  ON caf_core.evidence_media_assets(project_id, archive_status);

COMMENT ON TABLE caf_core.evidence_media_assets IS
  'Normalized URLs from evidence ingest (Apify, etc.) for top-performer archive + vision; one row per deduped media URL.';
