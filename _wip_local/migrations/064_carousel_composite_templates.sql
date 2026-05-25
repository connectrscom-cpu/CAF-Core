-- Reusable carousel composite templates: stored background plates + typography/layout spec.
-- Alternative to Puppeteer .hbs for listicle-style carousels and top-performer mimic (template_bg).

CREATE TABLE IF NOT EXISTS caf_core.carousel_composite_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  template_key           text NOT NULL,
  display_name           text,
  canvas_width           int NOT NULL DEFAULT 1080,
  canvas_height          int NOT NULL DEFAULT 1350,
  /** Per slide role: cover | body | cta — bucket, object_path, public_url, optional mime */
  background_plates_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Typography + colors — mirrors carousel_mimic_bg.hbs CSS vars */
  theme_json             jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Text zone layout spec (padding, font sizes, weights) — versioned in app code with optional overrides */
  layout_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_insights_id     text,
  source_evidence_row_id text,
  metadata_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carousel_composite_templates_key_check CHECK (char_length(trim(template_key)) >= 3)
  CONSTRAINT carousel_composite_templates_project_template_key UNIQUE (project_id, template_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_carousel_composite_templates_insights
  ON caf_core.carousel_composite_templates (project_id, source_insights_id)
  WHERE source_insights_id IS NOT NULL AND trim(source_insights_id) <> '';

COMMENT ON TABLE caf_core.carousel_composite_templates IS
  'Stored background plates + layout for Sharp text compositing (listicle / mimic template_bg). Alternative to .hbs renderer.';
