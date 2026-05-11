-- Creative intelligence: top-performer media, multimodal analyses, aggregated insights, mimic templates.

CREATE TABLE caf_core.creative_source_assets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  source_type             text NOT NULL DEFAULT 'unknown',
  external_source_id      text,
  source_url              text,
  platform                text,
  media_type              text NOT NULL,
  asset_role              text NOT NULL DEFAULT 'original',
  asset_url               text,
  storage_bucket          text,
  storage_key             text,
  mime_type               text,
  width                   integer,
  height                  integer,
  duration_sec            numeric(10,2),
  position_index          integer NOT NULL DEFAULT 0,
  performance_metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_group_id         uuid NOT NULL,
  ingest_batch_id         uuid,
  provenance_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_creative_source_assets_project_created
  ON caf_core.creative_source_assets (project_id, created_at DESC);
CREATE INDEX idx_creative_source_assets_group
  ON caf_core.creative_source_assets (project_id, source_group_id);

COMMENT ON TABLE caf_core.creative_source_assets IS
  'Reference media from top performers (slides, images, video copies, thumbnails, extracted frames).';

CREATE TABLE caf_core.creative_visual_analyses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  source_asset_id         uuid REFERENCES caf_core.creative_source_assets(id) ON DELETE SET NULL,
  source_group_id         uuid,
  analysis_model          text,
  analysis_version        text NOT NULL DEFAULT '1',
  media_type              text,
  analysis_status         text NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'completed', 'failed')),
  visual_summary          text,
  style_tags_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout_json             jsonb,
  color_palette_json      jsonb,
  typography_json         jsonb,
  composition_json        jsonb,
  motion_json             jsonb,
  editing_json            jsonb,
  hook_visual_pattern      text,
  text_overlay_json        jsonb,
  design_pattern           text,
  mimicry_notes            text,
  generation_guidance      text,
  confidence               numeric(6,4),
  raw_model_output_json    jsonb,
  error_message            text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_creative_visual_analyses_project_status
  ON caf_core.creative_visual_analyses (project_id, analysis_status, created_at DESC);
CREATE INDEX idx_creative_visual_analyses_group
  ON caf_core.creative_visual_analyses (project_id, source_group_id);

CREATE TABLE caf_core.creative_insights (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  insight_ref                text NOT NULL,
  scope_platform             text,
  scope_media_type           text,
  scope_content_format       text,
  insight_type               text NOT NULL,
  title                      text NOT NULL,
  summary                    text,
  guidance                   text,
  evidence_asset_ids_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_analysis_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_source_urls_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  support_count              integer NOT NULL DEFAULT 1,
  confidence                 numeric(6,4),
  status                     text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'rejected', 'archived')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, insight_ref)
);

CREATE INDEX idx_creative_insights_project_status
  ON caf_core.creative_insights (project_id, status, created_at DESC);

COMMENT ON COLUMN caf_core.creative_insights.insight_ref IS
  'Stable id for ideas.grounding_insight_ids (e.g. ci_<hex>); distinct from inputs_evidence_row_insights.insights_id.';

CREATE TABLE caf_core.creative_carousel_mimic_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  creative_insight_id   uuid REFERENCES caf_core.creative_insights(id) ON DELETE SET NULL,
  source_group_id       uuid,
  template_file_name    text NOT NULL,
  hbs_source            text NOT NULL,
  metadata_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_file_name)
);

CREATE INDEX idx_creative_carousel_mimic_templates_insight
  ON caf_core.creative_carousel_mimic_templates (project_id, creative_insight_id);

COMMENT ON TABLE caf_core.creative_carousel_mimic_templates IS
  'Stored .hbs sources derived from creative analyses; template_file_name matches disk under CAROUSEL_TEMPLATES_DIR.';
