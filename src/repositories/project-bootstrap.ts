import type { Pool } from "pg";
import { CANONICAL_ALLOWED_FLOW_SEEDS } from "../domain/canonical-flow-types.js";
import { q, qOne } from "../db/queries.js";
import {
  seedCanonicalAllowedFlowTypes,
  seedProductFlowTypesSkeleton,
  type HeygenConfigRow,
  upsertHeygenConfig,
  upsertRiskRule,
} from "./project-config.js";

/** HeyGen rows are copied from this project when present (same IDs as your demo / production SNS workbook). */
const HEYGEN_TEMPLATE_PROJECT_SLUG = "SNS";

async function getProjectIdBySlug(db: Pool, slug: string): Promise<string | null> {
  const row = await qOne<{ id: string }>(db, `SELECT id FROM caf_core.projects WHERE slug = $1`, [slug]);
  return row?.id ?? null;
}

async function countHeygenRows(db: Pool, projectId: string): Promise<number> {
  const row = await qOne<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM caf_core.heygen_config WHERE project_id = $1`,
    [projectId]
  );
  return row?.n ?? 0;
}

/** True when this project only has the two empty bootstrap placeholders (not customized). */
async function isOnlyEmptyDefaultHeygenPlaceholders(db: Pool, projectId: string): Promise<boolean> {
  const rows = await q<{ config_id: string; value: string | null }>(
    db,
    `SELECT config_id, value FROM caf_core.heygen_config WHERE project_id = $1`,
    [projectId]
  );
  if (rows.length !== 2) return false;
  const ids = new Set(rows.map((r) => r.config_id));
  if (!ids.has("defaults_voice") || !ids.has("defaults_avatar_pool")) return false;
  const voice = rows.find((r) => r.config_id === "defaults_voice");
  const pool = rows.find((r) => r.config_id === "defaults_avatar_pool");
  const voiceEmpty = !voice?.value?.trim();
  const poolRaw = (pool?.value ?? "").trim();
  const poolEmpty = poolRaw === "" || poolRaw === "[]";
  return voiceEmpty && poolEmpty;
}

async function copyHeygenConfigFromProject(db: Pool, targetProjectId: string, sourceProjectId: string): Promise<void> {
  const rows = await q<HeygenConfigRow>(
    db,
    `SELECT * FROM caf_core.heygen_config WHERE project_id = $1 ORDER BY config_id`,
    [sourceProjectId]
  );
  for (const r of rows) {
    await upsertHeygenConfig(db, targetProjectId, {
      config_id: r.config_id,
      platform: r.platform,
      flow_type: r.flow_type,
      config_key: r.config_key,
      value: r.value,
      render_mode: r.render_mode,
      value_type: r.value_type,
      is_active: r.is_active,
      notes: r.notes,
    });
  }
}

/**
 * When project `SNS` has HeyGen rows, new projects (or empty HeyGen) get a full copy.
 * Projects that still have only the two empty placeholder rows are upgraded to match SNS.
 */
async function maybeSyncHeygenFromSnsTemplate(db: Pool, projectId: string): Promise<void> {
  const templateId = await getProjectIdBySlug(db, HEYGEN_TEMPLATE_PROJECT_SLUG);
  if (!templateId || templateId === projectId) return;

  const snsCount = await countHeygenRows(db, templateId);
  if (snsCount === 0) return;

  const targetCount = await countHeygenRows(db, projectId);
  if (targetCount === 0) {
    await copyHeygenConfigFromProject(db, projectId, templateId);
    return;
  }
  if (await isOnlyEmptyDefaultHeygenPlaceholders(db, projectId)) {
    await db.query(
      `DELETE FROM caf_core.heygen_config WHERE project_id = $1 AND config_id IN ('defaults_voice', 'defaults_avatar_pool')`,
      [projectId]
    );
    await copyHeygenConfigFromProject(db, projectId, templateId);
  }
}

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
 * starter risk rules, HeyGen rows (copied from SNS when available), and system constraints — matching `seed:demo` defaults.
 * Safe to call on every request: one cheap counts query, then no-ops when already populated.
 */
export async function ensureDefaultProjectProfileData(db: Pool, projectId: string): Promise<void> {
  await maybeSyncHeygenFromSnsTemplate(db, projectId);

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
