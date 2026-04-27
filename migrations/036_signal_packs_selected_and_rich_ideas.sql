-- Rich idea objects + explicit selection on signal packs (stage 3/4).
-- Keeps legacy `ideas_json` intact; adds a richer, boss-facing idea shape and a selection list.

ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS ideas_v2_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_idea_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caf_core.signal_packs.ideas_v2_json IS
  'Richer idea objects derived from Insights; includes thesis, audience, novelty angle, key points, CTA, expected outcome, risk flags, and grounding_insight_ids.';

COMMENT ON COLUMN caf_core.signal_packs.selected_idea_ids_json IS
  'Ordered list of idea IDs selected for execution (stage 4). These selected ideas are what should be materialized into run planner rows.';

