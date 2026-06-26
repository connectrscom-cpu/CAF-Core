-- Slide Intelligence Layer (Why Mimic): normalized per-slide role/mechanism/why + deck why_analysis.
-- Derived (cheap path) from aesthetic_analysis_json, or filled by a richer provider pass.
-- Additive + reversible; consumers always fall back to deriving on-read when null.

ALTER TABLE caf_core.inputs_evidence_row_insights
  ADD COLUMN IF NOT EXISTS slide_intelligence_json jsonb;

COMMENT ON COLUMN caf_core.inputs_evidence_row_insights.slide_intelligence_json IS
  'slide_intelligence_v1 bundle (src/domain/slide-intelligence.ts): per-slide role/emotion/attention/curiosity/persuasion/symbolic_elements/why_it_works + deck why_analysis_v1. Each row carries provider + confidence + evidence_refs. Null until computed; derivable on-read from aesthetic_analysis_json.';
