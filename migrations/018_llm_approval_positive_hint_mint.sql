-- Track positive-strength GENERATION_GUIDANCE minted from post-approval LLM reviews (separate from low-score corrective hints).

ALTER TABLE caf_core.llm_approval_reviews
  ADD COLUMN IF NOT EXISTS minted_pending_positive_rule boolean NOT NULL DEFAULT false;
