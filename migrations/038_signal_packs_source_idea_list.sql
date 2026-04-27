-- Link signal packs to a specific inputs idea list (so packs can be built from different idea iterations per import).

ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS source_inputs_idea_list_id uuid REFERENCES caf_core.inputs_idea_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signal_packs_source_idea_list
  ON caf_core.signal_packs(source_inputs_idea_list_id);

