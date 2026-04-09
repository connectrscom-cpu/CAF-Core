-- Post-approval LLM reviews (vision + text): scores and learning signal for approved content only.

CREATE TABLE IF NOT EXISTS caf_core.llm_approval_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id             text NOT NULL,
  project_id            uuid NOT NULL REFERENCES caf_core.projects(id) ON DELETE CASCADE,
  task_id               text NOT NULL,
  run_id                text,
  flow_type             text,
  platform              text,
  model                 text NOT NULL,
  overall_score         numeric(6,4),
  scores_json           jsonb NOT NULL DEFAULT '{}',
  strengths             jsonb NOT NULL DEFAULT '[]',
  weaknesses            jsonb NOT NULL DEFAULT '[]',
  improvement_bullets   jsonb NOT NULL DEFAULT '[]',
  risk_flags            jsonb NOT NULL DEFAULT '[]',
  summary               text,
  raw_assistant_text    text,
  vision_image_urls     jsonb NOT NULL DEFAULT '[]',
  text_bundle_chars     integer,
  minted_pending_rule   boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_approval_reviews_project_created
  ON caf_core.llm_approval_reviews (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_approval_reviews_task
  ON caf_core.llm_approval_reviews (project_id, task_id);
