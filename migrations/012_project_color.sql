-- Add optional UI color for projects (admin / review UX)
ALTER TABLE caf_core.projects
  ADD COLUMN IF NOT EXISTS color text;

-- Optional safety: prefer hex colors if set (e.g. #FF00AA)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_color_hex_or_null'
  ) THEN
    ALTER TABLE caf_core.projects
      ADD CONSTRAINT projects_color_hex_or_null
      CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

