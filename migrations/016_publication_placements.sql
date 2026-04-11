-- Scheduled / completed social publishes keyed by task_id (Review → n8n → callback).

CREATE TABLE IF NOT EXISTS caf_core.publication_placements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  task_id               text NOT NULL,
  content_format        text NOT NULL DEFAULT 'unknown'
    CHECK (content_format IN ('carousel', 'video', 'unknown')),
  platform              text NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at          timestamptz,
  published_at          timestamptz,
  caption_snapshot      text,
  title_snapshot        text,
  media_urls_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  video_url_snapshot    text,
  platform_post_id      text,
  posted_url            text,
  publish_error         text,
  external_ref          text,
  result_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publication_placements_project_task
  ON caf_core.publication_placements (project_id, task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_publication_placements_project_status_schedule
  ON caf_core.publication_placements (project_id, status, scheduled_at);

COMMENT ON TABLE caf_core.publication_placements IS 'Social publish intent + outcome; join to content_jobs and downstream tables via (project_id, task_id).';
