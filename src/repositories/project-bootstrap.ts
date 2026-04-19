import type { Pool } from "pg";
import { CANONICAL_ALLOWED_FLOW_SEEDS } from "../domain/canonical-flow-types.js";
import { qOne } from "../db/queries.js";
import {
  seedCanonicalAllowedFlowTypes,
  seedProductFlowTypesSkeleton,
  upsertHeygenConfig,
  upsertRiskRule,
} from "./project-config.js";

type ProfileCounts = {
  flow_types: number;
  risk_rules: number;
  heygen_config: number;
  constraints: number;
};

async function loadProfileCounts(db: Pool, projectId: string): Promise<ProfileCounts> {
  const row = await qOne<ProfileCounts>(
    db,
    `SELECT
       (SELECT COUNT(*)::int FROM caf_core.allowed_flow_types WHERE project_id = $1) AS flow_types,
       (SELECT COUNT(*)::int FROM caf_core.risk_rules WHERE project_id = $1) AS risk_rules,
       (SELECT COUNT(*)::int FROM caf_core.heygen_config WHERE project_id = $1) AS heygen_config,
       (SELECT COUNT(*)::int FROM caf_core.project_system_constraints WHERE project_id = $1) AS constraints`,
    [projectId]
  );
  if (!row) {
    return { flow_types: 0, risk_rules: 0, heygen_config: 0, constraints: 0 };
  }
  return row;
}

/**
 * Ensures every project has baseline config: allowed flow types (canonical + product skeleton),
 * starter risk rules, HeyGen placeholder rows, and system constraints — matching `seed:demo` defaults.
 * Safe to call on every request: one cheap counts query, then no-ops when already populated.
 */
export async function ensureDefaultProjectProfileData(db: Pool, projectId: string): Promise<void> {
  const c = await loadProfileCounts(db, projectId);
  if (c.flow_types > 0 && c.risk_rules > 0 && c.heygen_config > 0 && c.constraints > 0) {
    return;
  }

  if (c.constraints === 0) {
    await db.query(
      `INSERT INTO caf_core.project_system_constraints
        (project_id, max_daily_jobs, min_score_to_generate, max_active_prompt_versions, default_variation_cap,
         auto_validation_pass_threshold, max_carousel_jobs_per_run, max_video_jobs_per_run, max_jobs_per_flow_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET
         max_daily_jobs = EXCLUDED.max_daily_jobs,
         min_score_to_generate = EXCLUDED.min_score_to_generate,
         max_active_prompt_versions = EXCLUDED.max_active_prompt_versions,
         default_variation_cap = EXCLUDED.default_variation_cap,
         auto_validation_pass_threshold = EXCLUDED.auto_validation_pass_threshold,
         max_carousel_jobs_per_run = EXCLUDED.max_carousel_jobs_per_run,
         max_video_jobs_per_run = EXCLUDED.max_video_jobs_per_run,
         max_jobs_per_flow_type = EXCLUDED.max_jobs_per_flow_type,
         updated_at = now()`,
      [
        projectId,
        200,
        0.35,
        5,
        2,
        0.72,
        null,
        null,
        JSON.stringify({}),
      ]
    );
  }

  if (c.flow_types === 0) {
    await seedCanonicalAllowedFlowTypes(db, projectId);
    await seedProductFlowTypesSkeleton(db, projectId);
  }

  if (c.risk_rules === 0) {
    for (const seed of CANONICAL_ALLOWED_FLOW_SEEDS) {
      await upsertRiskRule(db, projectId, {
        flow_type: seed.flow_type,
        trigger_condition:
          "Default: escalate when content touches regulated topics, strong claims, or brand-sensitive subjects.",
        risk_level: "medium",
        auto_approve_allowed: false,
        requires_manual_review: true,
        escalation_level: "standard",
        sensitive_topics: null,
        claim_restrictions:
          "Avoid unsubstantiated health, financial, or legal claims unless approved by brand policy.",
        rejection_reason_tag: null,
        rollback_flag: false,
        notes: "Starter rule — tighten per brand and compliance.",
      });
    }
  }

  if (c.heygen_config === 0) {
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_voice",
      platform: null,
      flow_type: null,
      config_key: "voice",
      value: null,
      render_mode: null,
      value_type: "string",
      is_active: true,
      notes: "Set HeyGen voice_id here, use PUT /v1/projects/:slug/heygen-defaults, or HEYGEN_DEFAULT_VOICE_ID env.",
    });
    await upsertHeygenConfig(db, projectId, {
      config_id: "defaults_avatar_pool",
      platform: null,
      flow_type: null,
      config_key: "avatar_pool_json",
      value: "[]",
      render_mode: null,
      value_type: "string",
      is_active: true,
      notes:
        "Add [{\"avatar_id\":\"...\",\"voice_id\":\"...\"}] for rotating avatars, or set defaults_avatar_id via heygen-defaults.",
    });
  }
}
