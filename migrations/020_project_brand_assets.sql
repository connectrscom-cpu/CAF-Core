-- Project-level brand kit: logos, reference images, palettes (metadata), fonts (metadata + URLs).
-- Optional HeyGen v3 asset_id after POST /v3/assets sync.

CREATE TABLE caf_core.project_brand_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  kind                  text NOT NULL CHECK (kind IN ('logo', 'reference_image', 'palette', 'font', 'other')),
  label                 text,
  sort_order            integer NOT NULL DEFAULT 0,
  public_url            text,
  storage_path          text,
  heygen_asset_id       text,
  heygen_synced_at      timestamptz,
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_brand_assets_project ON caf_core.project_brand_assets(project_id, sort_order);

COMMENT ON TABLE caf_core.project_brand_assets IS 'Brand kit per project; HeyGen Video Agent reference files for FLOW_PRODUCT_* when heygen_asset_id or public_url is set.';
