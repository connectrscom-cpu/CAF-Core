-- Per-project allowlist of carousel renderer templates (.hbs filenames).
-- Used by admin: assign templates from the Carousel templates gallery to a project; shown on Project Config.

CREATE TABLE IF NOT EXISTS caf_core.project_carousel_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  html_template_name     text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, html_template_name)
);

CREATE INDEX IF NOT EXISTS idx_project_carousel_templates_project
  ON caf_core.project_carousel_templates(project_id);

COMMENT ON TABLE caf_core.project_carousel_templates IS
  'Projects may pin carousel .hbs templates (html_template_name) for operator reference and future generation constraints.';
