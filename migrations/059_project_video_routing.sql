-- Per-project video pipeline routing (script / prompt avatar / no-avatar). Scene assembly is excluded by the router.
ALTER TABLE caf_core.project_system_constraints
  ADD COLUMN IF NOT EXISTS video_routing jsonb NOT NULL DEFAULT '{"enabled":true,"default_intent":"prompt_avatar"}'::jsonb;

COMMENT ON COLUMN caf_core.project_system_constraints.video_routing IS
  'JSON: { enabled, default_intent: script_avatar|prompt_avatar|no_avatar, platform_overrides?: { [platform]: intent } }';
