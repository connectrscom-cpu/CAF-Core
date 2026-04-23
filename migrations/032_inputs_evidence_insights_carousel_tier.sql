-- Carousel multi-slide vision tier (full deck in one multimodal call).

ALTER TABLE caf_core.inputs_evidence_row_insights
  DROP CONSTRAINT IF EXISTS chk_inputs_evidence_insights_tier;

ALTER TABLE caf_core.inputs_evidence_row_insights
  ADD CONSTRAINT chk_inputs_evidence_insights_tier CHECK (
    analysis_tier IN (
      'broad_llm',
      'top_performer_deep',
      'top_performer_video',
      'top_performer_carousel'
    )
  );

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.analysis_tier IS
  'broad_llm = text-only; top_performer_deep = single static image; top_performer_video = sampled frames + transcript; top_performer_carousel = multi-slide HTTPS deck (carousel_slide_urls etc.).';
