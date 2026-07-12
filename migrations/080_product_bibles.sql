-- Product Bible: versioned product evidence per project (screenshots, UI stages, feature demos).
-- Complements project_product_profile (text copy) with structured modules + asset refs.
-- Active version is snapshotted onto jobs as generation_payload.product_bible_v1 when enabled.

CREATE TABLE caf_core.product_bibles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  label         text,
  bible_json    jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX idx_product_bibles_project_active
  ON caf_core.product_bibles(project_id, is_active, version DESC);

COMMENT ON TABLE caf_core.product_bibles IS
  'Product evidence bible: product_bible_v1 per project (modules, features, screenshot refs). Snapshotted to content_jobs.generation_payload.product_bible_v1 when use_product_bible is set or content_lens=product. See src/domain/product-bible.ts.';
