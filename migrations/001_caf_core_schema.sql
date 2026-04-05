-- CAF Core — initial schema (Postgres / Supabase-compatible)
-- Run against your Core database. Uses schema `caf_core` to sit beside legacy `public` if needed.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS caf_core;

-- ---------------------------------------------------------------------------
-- Projects & system constraints
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  display_name      text,
  active            boolean NOT NULL DEFAULT true,
  config_json       jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caf_core.project_system_constraints (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  max_daily_jobs            integer,
  min_score_to_generate     numeric(6,4),
  max_active_prompt_versions integer,
  default_variation_cap     integer NOT NULL DEFAULT 1,
  auto_validation_pass_threshold numeric(6,4),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- ---------------------------------------------------------------------------
-- Runs & signal packs
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            text NOT NULL,
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  source_window     text,
  metadata_json     jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, run_id)
);

CREATE TABLE caf_core.signal_packs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  text NOT NULL,
  project_id              uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  source_window           text,
  overall_candidates_json jsonb NOT NULL DEFAULT '[]',
  ig_summary_json         jsonb,
  tiktok_summary_json     jsonb,
  reddit_summary_json     jsonb,
  fb_summary_json         jsonb,
  html_summary_json       jsonb,
  derived_globals_json    jsonb NOT NULL DEFAULT '{}',
  notes                   text,
  UNIQUE (project_id, run_id, created_at)
);

CREATE INDEX idx_signal_packs_project_run ON caf_core.signal_packs(project_id, run_id);

-- ---------------------------------------------------------------------------
-- Prompt versions & experiments
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.prompt_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  flow_type         text NOT NULL,
  prompt_id         text NOT NULL,
  version           text NOT NULL,
  status            text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'test', 'deprecated')),
  system_prompt_version text,
  user_prompt_version   text,
  output_schema_version text,
  temperature       numeric(5,2),
  max_tokens        integer,
  experiment_tag    text,
  win_rate          numeric(6,4),
  rejection_rate    numeric(6,4),
  last_used_at      timestamptz,
  metadata_json     jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, flow_type, prompt_id, version)
);

CREATE INDEX idx_prompt_versions_lookup ON caf_core.prompt_versions(project_id, flow_type, status);

CREATE TABLE caf_core.experiments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  experiment_id         text NOT NULL,
  name                  text,
  status                text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
  hypothesis            text,
  prompt_version_a_id   uuid REFERENCES caf_core.prompt_versions(id),
  prompt_version_b_id   uuid REFERENCES caf_core.prompt_versions(id),
  traffic_split_a       numeric(5,4) NOT NULL DEFAULT 0.5,
  winner_prompt_version_id uuid REFERENCES caf_core.prompt_versions(id),
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, experiment_id)
);

-- ---------------------------------------------------------------------------
-- Candidates & content jobs (normalized + JSON slices)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.candidates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      text NOT NULL,
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id            text NOT NULL,
  signal_pack_run_id text,
  platform          text,
  origin_platform   text,
  target_platform   text,
  flow_type         text,
  candidate_json    jsonb NOT NULL DEFAULT '{}',
  recommended_route text,
  confidence_score  numeric(8,4),
  pre_gen_score     numeric(8,4),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, candidate_id)
);

CREATE INDEX idx_candidates_run ON caf_core.candidates(project_id, run_id);

CREATE TABLE caf_core.content_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id                text NOT NULL,
  candidate_id          text,
  variation_name        text,
  flow_type             text,
  platform              text,
  origin_platform       text,
  target_platform       text,
  status                text,
  recommended_route     text,
  qc_status             text,
  render_provider       text,
  render_status         text,
  render_job_id         text,
  asset_id              text,
  generation_payload    jsonb NOT NULL DEFAULT '{}',
  render_state          jsonb NOT NULL DEFAULT '{}',
  scene_bundle_state    jsonb NOT NULL DEFAULT '{}',
  review_snapshot       jsonb NOT NULL DEFAULT '{}',
  pre_gen_score         numeric(8,4),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, task_id)
);

CREATE INDEX idx_content_jobs_run ON caf_core.content_jobs(project_id, run_id);
CREATE INDEX idx_content_jobs_status ON caf_core.content_jobs(project_id, status);

CREATE TABLE caf_core.job_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id              text NOT NULL UNIQUE,
  task_id               text NOT NULL,
  candidate_id          text,
  run_id                text,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  attempt_no            integer,
  revision_round        integer,
  prompt_name           text,
  prompt_version        text,
  generated_payload     jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caf_core.assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          text,
  task_id           text NOT NULL,
  project_id        uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  asset_type        text,
  asset_version     text,
  bucket            text,
  object_path       text,
  public_url        text,
  provider          text,
  position          integer DEFAULT 0,
  metadata_json     jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_task ON caf_core.assets(project_id, task_id);

-- ---------------------------------------------------------------------------
-- Audits, reviews, validation events
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.diagnostic_audits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              text NOT NULL UNIQUE,
  task_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  audit_type            text,
  failure_types         jsonb NOT NULL DEFAULT '[]',
  strengths             jsonb NOT NULL DEFAULT '[]',
  risk_findings         jsonb NOT NULL DEFAULT '[]',
  improvement_suggestions jsonb NOT NULL DEFAULT '[]',
  audit_score           numeric(8,4),
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caf_core.editorial_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               text NOT NULL,
  candidate_id          text,
  run_id                text,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  review_status         text,
  decision              text CHECK (decision IS NULL OR decision IN ('APPROVED', 'NEEDS_EDIT', 'REJECTED')),
  rejection_tags        jsonb NOT NULL DEFAULT '[]',
  notes                 text,
  overrides_json        jsonb NOT NULL DEFAULT '{}',
  validator             text,
  submit                boolean DEFAULT false,
  submitted_at          timestamptz,
  source                text DEFAULT 'api',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_editorial_task ON caf_core.editorial_reviews(project_id, task_id);

CREATE TABLE caf_core.validation_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              text NOT NULL UNIQUE,
  task_id               text,
  candidate_id          text,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  from_status           text,
  to_status             text,
  changed_by            text,
  rejection_reason_tag  text,
  notes                 text,
  changed_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Performance metrics (early vs stabilized windows)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.performance_metrics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  candidate_id          text,
  task_id               text,
  platform              text,
  metric_window         text NOT NULL CHECK (metric_window IN ('early', 'stabilized')),
  window_label          text,
  metric_date           date,
  posted_at             timestamptz,
  likes                 bigint,
  comments              bigint,
  shares                bigint,
  saves                 bigint,
  watch_time_sec        bigint,
  engagement_rate       numeric(12,8),
  raw_json              jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_perf_task ON caf_core.performance_metrics(project_id, task_id);

-- ---------------------------------------------------------------------------
-- Learning rules — mutation contract
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.learning_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  trigger_type          text NOT NULL,
  scope_flow_type       text,
  scope_platform        text,
  action_type           text NOT NULL,
  action_payload        jsonb NOT NULL DEFAULT '{}',
  confidence            numeric(6,4),
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'superseded', 'rejected')),
  source_entity_ids     jsonb NOT NULL DEFAULT '[]',
  applied_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, rule_id)
);

CREATE INDEX idx_learning_rules_project ON caf_core.learning_rules(project_id, status);

-- ---------------------------------------------------------------------------
-- Suppression rules (Phase 0.5)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.suppression_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  active                boolean NOT NULL DEFAULT true,
  rule_type             text NOT NULL
    CHECK (rule_type IN ('REJECTION_RATE', 'QC_FAIL_RATE', 'ENGAGEMENT_FLOOR', 'BLOCK_FLOW', 'BLOCK_PROMPT_VERSION')),
  scope_flow_type       text,
  scope_platform        text,
  threshold_numeric     numeric(12,6),
  window_days           integer DEFAULT 7,
  action                text NOT NULL DEFAULT 'BLOCK_FLOW'
    CHECK (action IN ('BLOCK_FLOW', 'REDUCE_VOLUME', 'FORCE_HUMAN_REVIEW', 'BLOCK_PROMPT_VERSION')),
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- State transitions & decision traces
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.job_state_transitions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  from_state            text,
  to_state              text NOT NULL,
  triggered_by          text NOT NULL CHECK (triggered_by IN ('system', 'human', 'rule', 'experiment')),
  rule_id               text,
  actor                 text,
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transitions_task ON caf_core.job_state_transitions(project_id, task_id);

CREATE TABLE caf_core.decision_traces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id              text NOT NULL UNIQUE,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  run_id                text,
  engine_version        text NOT NULL DEFAULT 'v1',
  input_snapshot        jsonb NOT NULL DEFAULT '{}',
  output_snapshot       jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caf_core.auto_validation_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  format_ok             boolean,
  hook_score            numeric(6,4),
  clarity_score         numeric(6,4),
  banned_hits           jsonb NOT NULL DEFAULT '[]',
  overall_score         numeric(6,4),
  pass_auto             boolean NOT NULL DEFAULT false,
  metadata_json         jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_val_task ON caf_core.auto_validation_results(project_id, task_id);

-- Daily job counts helper (optional materialized via app)
CREATE TABLE caf_core.generation_counters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  day_utc               date NOT NULL,
  jobs_created          integer NOT NULL DEFAULT 0,
  UNIQUE (project_id, day_utc)
);
