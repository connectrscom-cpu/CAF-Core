-- Project-level product profile: value proposition, features, problem, positioning, differentiation, etc.
-- Drives FLOW_PRODUCT_* video generation (LLM prompts AND HeyGen Video Agent prompt).

CREATE TABLE caf_core.project_product_profile (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid NOT NULL UNIQUE REFERENCES caf_core.projects(id) ON DELETE CASCADE,

  -- What the product IS
  product_name               text,
  product_category           text,
  product_url                text,
  one_liner                  text,
  value_proposition          text,
  elevator_pitch             text,

  -- Who it's FOR
  primary_audience           text,
  audience_pain_points       text,
  audience_desires           text,
  use_cases                  text,
  anti_audience              text,

  -- Why it's DIFFERENT
  key_features               text,
  key_benefits               text,
  differentiators            text,
  proof_points               text,
  social_proof               text,
  competitors                text,
  comparison_angles          text,

  -- Commercial
  pricing_summary            text,
  current_offer              text,
  offer_urgency              text,
  guarantee                  text,
  primary_cta                text,
  secondary_cta              text,

  -- Brand voice specific to the product (overrides nothing; augments)
  do_say                     text,
  dont_say                   text,
  taglines                   text,
  keywords                   text,

  -- Extra structured data (open slot)
  metadata_json              jsonb NOT NULL DEFAULT '{}',

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_product_profile_project ON caf_core.project_product_profile(project_id);

COMMENT ON TABLE caf_core.project_product_profile IS
  'Product-centric briefing per project; feeds FLOW_PRODUCT_* LLM prompt context and HeyGen Video Agent brand/product prompt block.';
