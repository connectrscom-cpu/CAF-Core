-- CAF Core — Migration 013: System/internal projects flag
-- Marks non-content “system” projects (e.g. caf-global learning store) so UIs can hide them.

ALTER TABLE caf_core.projects
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

UPDATE caf_core.projects
SET is_system = true
WHERE slug = 'caf-global';

