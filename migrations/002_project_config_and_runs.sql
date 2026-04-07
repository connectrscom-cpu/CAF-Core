-- CAF Core — Migration 002: Project config expansion + run lifecycle + signal pack enrichment
-- Adds structured project profiles (matching Project Config Sheet), run state machine,
-- enriched signal packs with per-platform detail sheets, and reference/viral format tables.

-- ---------------------------------------------------------------------------
-- 1. Strategy Defaults (per project)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.strategy_defaults (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  project_type              text,
  core_offer                text,
  target_audience           text,
  audience_problem          text,
  transformation_promise    text,
  positioning_statement     text,
  primary_business_goal     text,
  primary_content_goal      text,
  north_star_metric         text,
  monetization_model        text,
  traffic_destination       text,
  funnel_stage_focus        text,
  brand_archetype           text,
  strategic_content_pillars text,
  authority_angle           text,
  differentiation_angle     text,
  growth_strategy           text,
  publishing_intensity      text,
  time_horizon              text,
  owner                     text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- ---------------------------------------------------------------------------
-- 2. Brand Constraints (per project)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.brand_constraints (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  tone                      text,
  voice_style               text,
  audience_level            text,
  emotional_intensity       numeric(4,1),
  humor_level               numeric(4,1),
  emoji_policy              text,
  max_emojis_per_caption    integer,
  banned_claims             text,
  banned_words              text,
  mandatory_disclaimers     text,
  cta_style_rules           text,
  storytelling_style        text,
  positioning_statement     text,
  differentiation_angle     text,
  risk_level_default        text,
  manual_review_required    boolean NOT NULL DEFAULT true,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- ---------------------------------------------------------------------------
-- 3. Platform Constraints (per project+platform)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.platform_constraints (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  platform                  text NOT NULL,
  caption_max_chars         integer,
  hook_must_fit_first_lines boolean DEFAULT true,
  hook_max_chars            integer,
  slide_min_chars           integer,
  slide_max_chars           integer,
  slide_min                 integer,
  slide_max                 integer,
  max_hashtags              integer,
  hashtag_format_rule       text,
  line_break_policy         text,
  emoji_allowed             boolean DEFAULT true,
  link_allowed              boolean DEFAULT false,
  tag_allowed               boolean DEFAULT true,
  formatting_rules          text,
  posting_frequency_limit   text,
  best_posting_window       text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, platform)
);

-- ---------------------------------------------------------------------------
-- 4. Risk Rules (per project+flow_type)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.risk_rules (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  flow_type                 text NOT NULL,
  trigger_condition         text,
  risk_level                text,
  auto_approve_allowed      boolean DEFAULT false,
  requires_manual_review    boolean DEFAULT true,
  escalation_level          text,
  sensitive_topics          text,
  claim_restrictions        text,
  rejection_reason_tag      text,
  rollback_flag             boolean DEFAULT false,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_rules_project ON caf_core.risk_rules(project_id, flow_type);

-- ---------------------------------------------------------------------------
-- 5. Allowed Flow Types (per project)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.allowed_flow_types (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  flow_type                 text NOT NULL,
  enabled                   boolean NOT NULL DEFAULT true,
  default_variation_count   integer DEFAULT 1,
  requires_signal_pack      boolean DEFAULT true,
  requires_learning_context boolean DEFAULT true,
  allowed_platforms         text,
  output_schema_version     text,
  qc_checklist_version      text,
  prompt_template_id        text,
  priority_weight           numeric(4,2),
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, flow_type)
);

-- ---------------------------------------------------------------------------
-- 6. Reference Posts (per project)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.reference_posts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  reference_post_id         text NOT NULL,
  platform                  text,
  post_url                  text,
  status                    text DEFAULT 'pending',
  last_run_id               text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, reference_post_id)
);

-- ---------------------------------------------------------------------------
-- 7. Viral Format Library (per project)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.viral_formats (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  reference_post_id         text,
  platform                  text,
  post_url                  text,
  asset_type                text,
  author_handle             text,
  timestamp_utc             timestamptz,
  duration_seconds          numeric(8,2),
  caption                   text,
  hashtags_json             jsonb NOT NULL DEFAULT '[]',
  views                     bigint,
  likes                     bigint,
  comments_count            bigint,
  audio_id                  text,
  music_artist              text,
  music_title               text,
  hook_type                 text,
  hook_text                 text,
  hook_seconds              numeric(6,2),
  pattern_structure_json    jsonb NOT NULL DEFAULT '[]',
  emotional_arc             text,
  retention_devices_json    jsonb NOT NULL DEFAULT '[]',
  cta_pattern               text,
  replication_template_json jsonb NOT NULL DEFAULT '{}',
  transcript_full           text,
  notes                     text,
  run_id                    text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, reference_post_id, platform)
);

CREATE INDEX idx_viral_formats_project ON caf_core.viral_formats(project_id);

-- ---------------------------------------------------------------------------
-- 8. HeyGen Config (per project+flow_type+config_key)
-- ---------------------------------------------------------------------------
CREATE TABLE caf_core.heygen_config (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  config_id                 text NOT NULL,
  platform                  text,
  flow_type                 text,
  config_key                text NOT NULL,
  value                     text,
  render_mode               text,
  value_type                text DEFAULT 'string',
  is_active                 boolean NOT NULL DEFAULT true,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, config_id)
);

CREATE INDEX idx_heygen_config_project ON caf_core.heygen_config(project_id, flow_type);

-- ---------------------------------------------------------------------------
-- 9. Enrich runs table with status + signal_pack link
-- ---------------------------------------------------------------------------
ALTER TABLE caf_core.runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','PLANNING','PLANNED','GENERATING','RENDERING','REVIEWING','COMPLETED','FAILED','CANCELLED')),
  ADD COLUMN IF NOT EXISTS signal_pack_id uuid REFERENCES caf_core.signal_packs(id),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_jobs integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jobs_completed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_runs_project_status ON caf_core.runs(project_id, status);

-- ---------------------------------------------------------------------------
-- 10. Enrich signal_packs with per-platform detail sheets
-- ---------------------------------------------------------------------------
ALTER TABLE caf_core.signal_packs
  ADD COLUMN IF NOT EXISTS ig_archetypes_json jsonb,
  ADD COLUMN IF NOT EXISTS ig_7day_plan_json jsonb,
  ADD COLUMN IF NOT EXISTS ig_top_examples_json jsonb,
  ADD COLUMN IF NOT EXISTS tiktok_archetypes_json jsonb,
  ADD COLUMN IF NOT EXISTS tiktok_7day_plan_json jsonb,
  ADD COLUMN IF NOT EXISTS tiktok_top_examples_json jsonb,
  ADD COLUMN IF NOT EXISTS reddit_archetypes_json jsonb,
  ADD COLUMN IF NOT EXISTS reddit_top_examples_json jsonb,
  ADD COLUMN IF NOT EXISTS html_findings_raw_json jsonb,
  ADD COLUMN IF NOT EXISTS reddit_subreddit_insights_json jsonb,
  ADD COLUMN IF NOT EXISTS upload_filename text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
