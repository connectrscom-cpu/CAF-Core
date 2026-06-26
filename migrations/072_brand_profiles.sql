-- Brand-Aware Why Mimic: versioned brand profiles per project.
-- Holds brand_profile_v1 (palette, symbol_map, tone, visual style, allowed/forbidden motifs).
-- Gated per project: generation only applies brand translation when an active profile exists.

CREATE TABLE caf_core.brand_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  label         text,
  profile_json  jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX idx_brand_profiles_project_active
  ON caf_core.brand_profiles(project_id, is_active, version DESC);

COMMENT ON TABLE caf_core.brand_profiles IS
  'Brand-Aware Why Mimic: versioned brand_profile_v1 (palette, symbol_map, tone, visual style) per project. The active version drives brand translation of reference intent at generation while preserving why_analysis_v1.strategic_thesis. See src/domain/brand-profile.ts.';
