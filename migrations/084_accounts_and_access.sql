-- CAF Core — Migration 084: Agency / personal accounts + Review access
-- Additive only. Existing pipeline tables unchanged. Connectrs owns current brands.

CREATE TABLE IF NOT EXISTS caf_core.users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  email_normalized  text NOT NULL UNIQUE,
  display_name      text,
  password_hash     text NOT NULL,
  password_salt     text NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caf_core.accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  account_type      text NOT NULL DEFAULT 'agency'
                    CHECK (account_type IN ('agency', 'personal')),
  max_projects      integer NOT NULL DEFAULT 25,
  max_members       integer NOT NULL DEFAULT 50,
  plan_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caf_core.account_members (
  account_id        uuid NOT NULL REFERENCES caf_core.accounts(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES caf_core.users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
  invited_at        timestamptz,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS account_members_user_idx
  ON caf_core.account_members (user_id);

CREATE TABLE IF NOT EXISTS caf_core.account_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES caf_core.accounts(id) ON DELETE CASCADE,
  email             text NOT NULL,
  email_normalized  text NOT NULL,
  role              text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin', 'member')),
  token_hash        text NOT NULL UNIQUE,
  invited_by_user_id uuid REFERENCES caf_core.users(id) ON DELETE SET NULL,
  expires_at        timestamptz NOT NULL,
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_invites_account_email_idx
  ON caf_core.account_invites (account_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS caf_core.project_members (
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES caf_core.users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'editor'
                    CHECK (role IN ('editor', 'viewer')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_members_user_idx
  ON caf_core.project_members (user_id);

CREATE TABLE IF NOT EXISTS caf_core.auth_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES caf_core.users(id) ON DELETE CASCADE,
  token_hash        text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  user_agent        text,
  ip_address        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON caf_core.auth_sessions (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE caf_core.projects
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES caf_core.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_account_id_idx
  ON caf_core.projects (account_id)
  WHERE account_id IS NOT NULL;

-- Seed Connectrs as the owner account for all existing non-system brands.
INSERT INTO caf_core.accounts (slug, display_name, account_type, max_projects, max_members, plan_json)
VALUES (
  'connectrs',
  'Connectrs',
  'agency',
  100,
  100,
  '{"tier":"owner","notes":"Platform owner account for existing CAF brands"}'::jsonb
)
ON CONFLICT (slug) DO UPDATE
SET display_name = EXCLUDED.display_name,
    updated_at = now();

UPDATE caf_core.projects p
SET account_id = a.id,
    updated_at = now()
FROM caf_core.accounts a
WHERE a.slug = 'connectrs'
  AND p.account_id IS NULL
  AND COALESCE(p.is_system, false) = false
  AND p.slug <> 'caf-global';
