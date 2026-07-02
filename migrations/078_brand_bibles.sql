-- Brand Visual System (BVS): versioned brand bibles per project.
-- Holds brand_bible_v1 — visual mode, palette, motifs, application guide, asset role refs.
-- Active version is snapshotted onto jobs as generation_payload.bvs_v1 when BVS is enabled per idea.

CREATE TABLE caf_core.brand_bibles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  label         text,
  bible_json    jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX idx_brand_bibles_project_active
  ON caf_core.brand_bibles(project_id, is_active, version DESC);

COMMENT ON TABLE caf_core.brand_bibles IS
  'Brand Visual System: versioned brand_bible_v1 per project (style refs, palette, application guide). Snapshotted to content_jobs.generation_payload.bvs_v1 when use_brand_visual_system is set on the planned candidate. See src/domain/brand-bible.ts.';
