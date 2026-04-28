-- Stage 3/4 structures as first-class tables (non-breaking).
-- These tables become the source of truth for Ideas + selection, while keeping legacy JSON columns
-- (`signal_packs.ideas_json`, `ideas_v2_json`, `selected_idea_ids_json`) for downstream compatibility.

-- ---------------------------------------------------------------------------
-- Ideas (canonical rich idea contract)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.ideas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  -- stable external id (e.g. idea_<slug>_<n>); used by UI/materialization
  idea_id            text NOT NULL,
  -- provenance links (nullable to support manual/human ideas)
  inputs_import_id   uuid REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  run_id             text,

  -- requested fields
  title              text,
  three_liner        text,
  thesis             text,
  who_for            text,
  format             text,
  platform           text,
  why_now            text,
  key_points_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  novelty_angle      text,
  cta                text,
  expected_outcome   text,
  risk_flags_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             text,

  -- store full rich idea object for forward-compat (UI may add fields)
  idea_json          jsonb NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (project_id, idea_id)
);

CREATE INDEX IF NOT EXISTS idx_ideas_project_created
  ON caf_core.ideas(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ideas_project_platform
  ON caf_core.ideas(project_id, platform, created_at DESC);

-- ---------------------------------------------------------------------------
-- Idea grounding: enforce “no orphan ideas” (>= 1 insight link at write time)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.idea_grounding_insights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  idea_id            uuid NOT NULL REFERENCES caf_core.ideas(id) ON DELETE CASCADE,
  -- Points to the structured insight row (stage 2)
  insight_row_id     uuid NOT NULL REFERENCES caf_core.inputs_evidence_row_insights(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, insight_row_id)
);

CREATE INDEX IF NOT EXISTS idx_idea_grounding_idea
  ON caf_core.idea_grounding_insights(project_id, idea_id);

CREATE INDEX IF NOT EXISTS idx_idea_grounding_insight
  ON caf_core.idea_grounding_insights(project_id, insight_row_id);

-- ---------------------------------------------------------------------------
-- Signal Pack ↔ Ideas (ordered) + explicit selection (stage 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caf_core.signal_pack_ideas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  signal_pack_id uuid NOT NULL REFERENCES caf_core.signal_packs(id) ON DELETE CASCADE,
  idea_row_id    uuid NOT NULL REFERENCES caf_core.ideas(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_pack_id, idea_row_id),
  UNIQUE (signal_pack_id, position)
);

CREATE INDEX IF NOT EXISTS idx_signal_pack_ideas_pack
  ON caf_core.signal_pack_ideas(project_id, signal_pack_id, position);

CREATE TABLE IF NOT EXISTS caf_core.signal_pack_selected_ideas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  signal_pack_id uuid NOT NULL REFERENCES caf_core.signal_packs(id) ON DELETE CASCADE,
  idea_row_id    uuid NOT NULL REFERENCES caf_core.ideas(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_pack_id, idea_row_id),
  UNIQUE (signal_pack_id, position)
);

CREATE INDEX IF NOT EXISTS idx_signal_pack_selected_pack
  ON caf_core.signal_pack_selected_ideas(project_id, signal_pack_id, position);

