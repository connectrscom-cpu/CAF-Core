-- CAF Core — Migration 047: Deactivate un-namespaced prompt template aliases
--
-- Background:
-- Migration 041 intentionally created prompt_name aliases by copying rows:
--   <FLOWKEY>__<prompt_name>  (namespaced, clearer in Prompt Labs)
--   <prompt_name>            (legacy / unprefixed)
--
-- This migration keeps both rows for backward compatibility, but makes the
-- namespaced prompt the canonical "active" template to avoid ambiguity and
-- to make Prompt Labs listings match operator expectations.

BEGIN;

-- For FLOW_* flow types:
-- If both "FLOWKEY__X" and "X" exist and are active, deactivate the legacy "X".
WITH pairs AS (
  SELECT
    p.flow_type,
    p.prompt_name AS legacy_prompt_name,
    (regexp_replace(p.flow_type, '^FLOW_', '') || '__' || p.prompt_name) AS namespaced_prompt_name
  FROM caf_core.prompt_templates p
  WHERE p.flow_type LIKE 'FLOW_%'
    AND p.prompt_name !~ '^[A-Z0-9_]+__'
),
to_deactivate AS (
  SELECT
    l.flow_type,
    l.prompt_name AS legacy_prompt_name
  FROM caf_core.prompt_templates l
  JOIN pairs pa
    ON pa.flow_type = l.flow_type
   AND pa.legacy_prompt_name = l.prompt_name
  JOIN caf_core.prompt_templates n
    ON n.flow_type = pa.flow_type
   AND n.prompt_name = pa.namespaced_prompt_name
  WHERE l.active = true
    AND n.active = true
)
UPDATE caf_core.prompt_templates p
   SET active = false,
       notes = CASE
         WHEN COALESCE(p.notes, '') ILIKE '%alias%' THEN p.notes
         WHEN COALESCE(p.notes, '') = '' THEN 'Alias (legacy, un-namespaced). Canonical prompt is the namespaced FLOWKEY__ variant.'
         ELSE p.notes || E'\n\n' || 'Alias (legacy, un-namespaced). Canonical prompt is the namespaced FLOWKEY__ variant.'
       END,
       updated_at = now()
 WHERE (p.flow_type, p.prompt_name) IN (
   SELECT flow_type, legacy_prompt_name FROM to_deactivate
 );

COMMIT;

