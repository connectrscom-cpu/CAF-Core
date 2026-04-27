-- Idea lists: store multiple idea-generation outputs per inputs_import_id.
-- This decouples "build ideas" from "build signal pack" so operators can iterate on cutoffs/prompts.

CREATE TABLE IF NOT EXISTS caf_core.inputs_idea_lists (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  inputs_import_id   uuid NOT NULL REFERENCES caf_core.inputs_evidence_imports(id) ON DELETE CASCADE,
  title              text,
  params_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  derived_globals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inputs_idea_lists_project_created
  ON caf_core.inputs_idea_lists(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inputs_idea_lists_import_created
  ON caf_core.inputs_idea_lists(inputs_import_id, created_at DESC);

CREATE TABLE IF NOT EXISTS caf_core.inputs_ideas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  idea_list_id       uuid NOT NULL REFERENCES caf_core.inputs_idea_lists(id) ON DELETE CASCADE,
  idea_id            text NOT NULL,
  platform           text,
  confidence_score   numeric(8,4),
  idea_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_list_id, idea_id)
);

CREATE INDEX IF NOT EXISTS idx_inputs_ideas_list_confidence
  ON caf_core.inputs_ideas(idea_list_id, confidence_score DESC NULLS LAST, created_at DESC);

