-- Align CUISINA per-flow and run-level planning caps with SNS.
-- Copies max_jobs_per_flow_type plus carousel/video aggregate caps from the SNS template project.

UPDATE caf_core.project_system_constraints cuisina
SET
  max_carousel_jobs_per_run = sns.max_carousel_jobs_per_run,
  max_video_jobs_per_run = sns.max_video_jobs_per_run,
  max_jobs_per_flow_type = sns.max_jobs_per_flow_type,
  updated_at = now()
FROM caf_core.project_system_constraints sns
JOIN caf_core.projects sns_p ON sns_p.id = sns.project_id AND upper(sns_p.slug) = 'SNS'
JOIN caf_core.projects cuisina_p ON upper(cuisina_p.slug) = 'CUISINA'
WHERE cuisina.project_id = cuisina_p.id;
