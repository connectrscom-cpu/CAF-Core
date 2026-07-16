-- CAF Core — Migration 081: distinct text content flows
-- FLOW_LINKEDIN_TEXT_POST, FLOW_REDDIT_POST, FLOW_INSTAGRAM_THREAD (+ backfill FLOW_LINKEDIN_DOCUMENT_POST defs)

BEGIN;

INSERT INTO caf_core.allowed_flow_types (
  project_id,
  flow_type,
  enabled,
  default_variation_count,
  requires_signal_pack,
  requires_learning_context,
  allowed_platforms,
  output_schema_version,
  qc_checklist_version,
  prompt_template_id,
  priority_weight,
  notes,
  heygen_mode
)
SELECT
  p.id,
  v.flow_type,
  false,
  1,
  true,
  false,
  v.allowed_platforms,
  NULL,
  NULL,
  NULL,
  v.priority_weight,
  v.notes,
  NULL
FROM caf_core.projects p
CROSS JOIN (
  VALUES
    (
      'FLOW_LINKEDIN_TEXT_POST',
      'LinkedIn',
      5,
      'LinkedIn text-only post — copy, no companion images'
    ),
    (
      'FLOW_REDDIT_POST',
      'Reddit',
      4,
      'Reddit text post — title + body (community-native tone)'
    ),
    (
      'FLOW_INSTAGRAM_THREAD',
      'Instagram',
      4,
      'Instagram thread — multi-part caption chain (3–8 parts)'
    )
) AS v(flow_type, allowed_platforms, priority_weight, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM caf_core.allowed_flow_types a
  WHERE a.project_id = p.id
    AND a.flow_type = v.flow_type
);

INSERT INTO caf_core.flow_definitions (
  flow_type, description, category, supported_platforms, output_asset_types,
  requires_signal_pack, requires_learning_context, requires_brand_constraints,
  required_inputs, optional_inputs, default_variation_count,
  output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
  risk_profile_default, candidate_row_template, notes
)
SELECT
  v.flow_type,
  v.description,
  base.category,
  v.supported_platforms,
  base.output_asset_types,
  base.requires_signal_pack,
  base.requires_learning_context,
  base.requires_brand_constraints,
  base.required_inputs,
  base.optional_inputs,
  base.default_variation_count,
  base.output_schema_name,
  base.output_schema_version,
  base.qc_checklist_name,
  base.qc_checklist_version,
  base.risk_profile_default,
  base.candidate_row_template,
  v.notes
FROM (
  VALUES
    (
      'FLOW_LINKEDIN_TEXT_POST',
      'LinkedIn text-only post — professional copy, no render.',
      'LinkedIn',
      'Shares FLOW_TEXT prompt templates (resolveFlowEngineTemplateFlowType → FLOW_TEXT).'
    ),
    (
      'FLOW_REDDIT_POST',
      'Reddit text post — title + body markdown.',
      'Reddit',
      'Shares FLOW_TEXT prompt templates; Reddit-specific LLM addendum in Core.'
    ),
    (
      'FLOW_INSTAGRAM_THREAD',
      'Instagram thread — ordered caption parts.',
      'Instagram',
      'Shares FLOW_TEXT prompt templates; thread-specific LLM addendum in Core.'
    )
) AS v(flow_type, description, supported_platforms, notes)
CROSS JOIN LATERAL (
  SELECT *
  FROM caf_core.flow_definitions
  WHERE flow_type IN ('FLOW_TEXT', 'Text_Post_Generator')
  ORDER BY CASE flow_type WHEN 'FLOW_TEXT' THEN 0 ELSE 1 END
  LIMIT 1
) AS base
WHERE NOT EXISTS (
  SELECT 1 FROM caf_core.flow_definitions fd WHERE fd.flow_type = v.flow_type
);

UPDATE caf_core.flow_definitions fd
SET
  supported_platforms = COALESCE(NULLIF(btrim(fd.supported_platforms), ''), 'LinkedIn'),
  notes = COALESCE(NULLIF(btrim(fd.notes), ''), 'LinkedIn post with images — long copy + 2–3 companion images.')
WHERE fd.flow_type = 'FLOW_LINKEDIN_DOCUMENT_POST'
  AND (fd.supported_platforms IS NULL OR btrim(fd.supported_platforms) = '');

COMMIT;
