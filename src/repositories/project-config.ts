import type { Pool } from "pg";
import { CANONICAL_ALLOWED_FLOW_SEEDS } from "../domain/canonical-flow-types.js";
import {
  PRODUCT_IMAGE_FLOW_TYPES,
  PRODUCT_VIDEO_FLOW_TYPES,
  coerceProductHeygenMode,
  defaultProductFlowHeygenMode,
  isProductVideoFlow,
  type ProductHeygenMode,
} from "../domain/product-flow-types.js";
import { q, qOne } from "../db/queries.js";

// ---------------------------------------------------------------------------
// Strategy Defaults
// ---------------------------------------------------------------------------
export interface StrategyDefaultsRow {
  id: string;
  project_id: string;
  project_type: string | null;
  core_offer: string | null;
  target_audience: string | null;
  audience_problem: string | null;
  transformation_promise: string | null;
  positioning_statement: string | null;
  primary_business_goal: string | null;
  primary_content_goal: string | null;
  north_star_metric: string | null;
  monetization_model: string | null;
  traffic_destination: string | null;
  funnel_stage_focus: string | null;
  brand_archetype: string | null;
  strategic_content_pillars: string | null;
  authority_angle: string | null;
  differentiation_angle: string | null;
  growth_strategy: string | null;
  publishing_intensity: string | null;
  time_horizon: string | null;
  owner: string | null;
  notes: string | null;
  instagram_handle: string | null;
}

export async function getStrategyDefaults(db: Pool, projectId: string): Promise<StrategyDefaultsRow | null> {
  return qOne<StrategyDefaultsRow>(db,
    `SELECT * FROM caf_core.strategy_defaults WHERE project_id = $1`, [projectId]);
}

export async function upsertStrategyDefaults(
  db: Pool,
  projectId: string,
  data: Omit<StrategyDefaultsRow, "id" | "project_id">
): Promise<StrategyDefaultsRow> {
  const row = await qOne<StrategyDefaultsRow>(db, `
    INSERT INTO caf_core.strategy_defaults (
      project_id, project_type, core_offer, target_audience, audience_problem,
      transformation_promise, positioning_statement, primary_business_goal, primary_content_goal,
      north_star_metric, monetization_model, traffic_destination, funnel_stage_focus,
      brand_archetype, strategic_content_pillars, authority_angle, differentiation_angle,
      growth_strategy, publishing_intensity, time_horizon, owner, notes, instagram_handle
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT (project_id) DO UPDATE SET
      project_type = EXCLUDED.project_type, core_offer = EXCLUDED.core_offer,
      target_audience = EXCLUDED.target_audience, audience_problem = EXCLUDED.audience_problem,
      transformation_promise = EXCLUDED.transformation_promise, positioning_statement = EXCLUDED.positioning_statement,
      primary_business_goal = EXCLUDED.primary_business_goal, primary_content_goal = EXCLUDED.primary_content_goal,
      north_star_metric = EXCLUDED.north_star_metric, monetization_model = EXCLUDED.monetization_model,
      traffic_destination = EXCLUDED.traffic_destination, funnel_stage_focus = EXCLUDED.funnel_stage_focus,
      brand_archetype = EXCLUDED.brand_archetype, strategic_content_pillars = EXCLUDED.strategic_content_pillars,
      authority_angle = EXCLUDED.authority_angle, differentiation_angle = EXCLUDED.differentiation_angle,
      growth_strategy = EXCLUDED.growth_strategy, publishing_intensity = EXCLUDED.publishing_intensity,
      time_horizon = EXCLUDED.time_horizon, owner = EXCLUDED.owner, notes = EXCLUDED.notes,
      instagram_handle = EXCLUDED.instagram_handle,
      updated_at = now()
    RETURNING *`,
    [
      projectId, data.project_type, data.core_offer, data.target_audience, data.audience_problem,
      data.transformation_promise, data.positioning_statement, data.primary_business_goal, data.primary_content_goal,
      data.north_star_metric, data.monetization_model, data.traffic_destination, data.funnel_stage_focus,
      data.brand_archetype, data.strategic_content_pillars, data.authority_angle, data.differentiation_angle,
      data.growth_strategy, data.publishing_intensity, data.time_horizon, data.owner, data.notes,
      data.instagram_handle,
    ]);
  if (!row) throw new Error("Failed to upsert strategy_defaults");
  return row;
}

// ---------------------------------------------------------------------------
// Brand Constraints
// ---------------------------------------------------------------------------
export interface BrandConstraintsRow {
  id: string;
  project_id: string;
  tone: string | null;
  voice_style: string | null;
  audience_level: string | null;
  emotional_intensity: number | null;
  humor_level: number | null;
  emoji_policy: string | null;
  max_emojis_per_caption: number | null;
  banned_claims: string | null;
  banned_words: string | null;
  mandatory_disclaimers: string | null;
  cta_style_rules: string | null;
  storytelling_style: string | null;
  positioning_statement: string | null;
  differentiation_angle: string | null;
  risk_level_default: string | null;
  manual_review_required: boolean;
  notes: string | null;
}

export async function getBrandConstraints(db: Pool, projectId: string): Promise<BrandConstraintsRow | null> {
  return qOne<BrandConstraintsRow>(db,
    `SELECT * FROM caf_core.brand_constraints WHERE project_id = $1`, [projectId]);
}

export async function upsertBrandConstraints(
  db: Pool,
  projectId: string,
  data: Omit<BrandConstraintsRow, "id" | "project_id">
): Promise<BrandConstraintsRow> {
  const row = await qOne<BrandConstraintsRow>(db, `
    INSERT INTO caf_core.brand_constraints (
      project_id, tone, voice_style, audience_level, emotional_intensity, humor_level,
      emoji_policy, max_emojis_per_caption, banned_claims, banned_words, mandatory_disclaimers,
      cta_style_rules, storytelling_style, positioning_statement, differentiation_angle,
      risk_level_default, manual_review_required, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (project_id) DO UPDATE SET
      tone = EXCLUDED.tone, voice_style = EXCLUDED.voice_style, audience_level = EXCLUDED.audience_level,
      emotional_intensity = EXCLUDED.emotional_intensity, humor_level = EXCLUDED.humor_level,
      emoji_policy = EXCLUDED.emoji_policy, max_emojis_per_caption = EXCLUDED.max_emojis_per_caption,
      banned_claims = EXCLUDED.banned_claims, banned_words = EXCLUDED.banned_words,
      mandatory_disclaimers = EXCLUDED.mandatory_disclaimers, cta_style_rules = EXCLUDED.cta_style_rules,
      storytelling_style = EXCLUDED.storytelling_style, positioning_statement = EXCLUDED.positioning_statement,
      differentiation_angle = EXCLUDED.differentiation_angle, risk_level_default = EXCLUDED.risk_level_default,
      manual_review_required = EXCLUDED.manual_review_required, notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING *`,
    [
      projectId, data.tone, data.voice_style, data.audience_level, data.emotional_intensity,
      data.humor_level, data.emoji_policy, data.max_emojis_per_caption, data.banned_claims,
      data.banned_words, data.mandatory_disclaimers, data.cta_style_rules, data.storytelling_style,
      data.positioning_statement, data.differentiation_angle, data.risk_level_default,
      data.manual_review_required, data.notes,
    ]);
  if (!row) throw new Error("Failed to upsert brand_constraints");
  return row;
}

// ---------------------------------------------------------------------------
// Platform Constraints
// ---------------------------------------------------------------------------
export interface PlatformConstraintsRow {
  id: string;
  project_id: string;
  platform: string;
  caption_max_chars: number | null;
  hook_must_fit_first_lines: boolean;
  hook_max_chars: number | null;
  slide_min_chars: number | null;
  slide_max_chars: number | null;
  slide_min: number | null;
  slide_max: number | null;
  max_hashtags: number | null;
  hashtag_format_rule: string | null;
  line_break_policy: string | null;
  emoji_allowed: boolean;
  link_allowed: boolean;
  tag_allowed: boolean;
  formatting_rules: string | null;
  posting_frequency_limit: string | null;
  best_posting_window: string | null;
  notes: string | null;
}

export async function listPlatformConstraints(db: Pool, projectId: string): Promise<PlatformConstraintsRow[]> {
  return q<PlatformConstraintsRow>(db,
    `SELECT * FROM caf_core.platform_constraints WHERE project_id = $1 ORDER BY platform`, [projectId]);
}

export async function upsertPlatformConstraints(
  db: Pool,
  projectId: string,
  data: Omit<PlatformConstraintsRow, "id" | "project_id">
): Promise<PlatformConstraintsRow> {
  const row = await qOne<PlatformConstraintsRow>(db, `
    INSERT INTO caf_core.platform_constraints (
      project_id, platform, caption_max_chars, hook_must_fit_first_lines, hook_max_chars,
      slide_min_chars, slide_max_chars, slide_min, slide_max, max_hashtags, hashtag_format_rule,
      line_break_policy, emoji_allowed, link_allowed, tag_allowed, formatting_rules,
      posting_frequency_limit, best_posting_window, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (project_id, platform) DO UPDATE SET
      caption_max_chars = EXCLUDED.caption_max_chars, hook_must_fit_first_lines = EXCLUDED.hook_must_fit_first_lines,
      hook_max_chars = EXCLUDED.hook_max_chars, slide_min_chars = EXCLUDED.slide_min_chars,
      slide_max_chars = EXCLUDED.slide_max_chars, slide_min = EXCLUDED.slide_min, slide_max = EXCLUDED.slide_max,
      max_hashtags = EXCLUDED.max_hashtags, hashtag_format_rule = EXCLUDED.hashtag_format_rule,
      line_break_policy = EXCLUDED.line_break_policy, emoji_allowed = EXCLUDED.emoji_allowed,
      link_allowed = EXCLUDED.link_allowed, tag_allowed = EXCLUDED.tag_allowed,
      formatting_rules = EXCLUDED.formatting_rules, posting_frequency_limit = EXCLUDED.posting_frequency_limit,
      best_posting_window = EXCLUDED.best_posting_window, notes = EXCLUDED.notes, updated_at = now()
    RETURNING *`,
    [
      projectId, data.platform, data.caption_max_chars, data.hook_must_fit_first_lines, data.hook_max_chars,
      data.slide_min_chars, data.slide_max_chars, data.slide_min, data.slide_max, data.max_hashtags,
      data.hashtag_format_rule, data.line_break_policy, data.emoji_allowed, data.link_allowed,
      data.tag_allowed, data.formatting_rules, data.posting_frequency_limit, data.best_posting_window, data.notes,
    ]);
  if (!row) throw new Error("Failed to upsert platform_constraints");
  return row;
}

export async function deletePlatformConstraint(db: Pool, projectId: string, platform: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.platform_constraints WHERE project_id = $1 AND platform = $2`, [projectId, platform]);
}

// ---------------------------------------------------------------------------
// Risk Rules
// ---------------------------------------------------------------------------
export interface RiskRuleRow {
  id: string;
  project_id: string;
  flow_type: string;
  trigger_condition: string | null;
  risk_level: string | null;
  auto_approve_allowed: boolean;
  requires_manual_review: boolean;
  escalation_level: string | null;
  sensitive_topics: string | null;
  claim_restrictions: string | null;
  rejection_reason_tag: string | null;
  rollback_flag: boolean;
  notes: string | null;
}

export async function listRiskRules(db: Pool, projectId: string): Promise<RiskRuleRow[]> {
  return q<RiskRuleRow>(db,
    `SELECT * FROM caf_core.risk_rules WHERE project_id = $1 ORDER BY flow_type`, [projectId]);
}

/**
 * Count of configured `risk_rules` for a project.
 *
 * NOTE: `risk_rules` are project-level policy documentation today — they are
 * NOT applied by the QC runtime (`src/services/qc-runtime.ts`). See
 * `docs/RISK_RULES.md` and the `/v1/projects/:slug/risk-qc-status` endpoint
 * which surfaces this asymmetry to operators.
 */
export async function countRiskRules(db: Pool, projectId: string): Promise<number> {
  const row = await qOne<{ count: string }>(db,
    `SELECT COUNT(*)::text AS count FROM caf_core.risk_rules WHERE project_id = $1`, [projectId]);
  return row ? Number(row.count) : 0;
}

export async function upsertRiskRule(db: Pool, projectId: string, data: Omit<RiskRuleRow, "id" | "project_id">): Promise<RiskRuleRow> {
  const row = await qOne<RiskRuleRow>(db, `
    INSERT INTO caf_core.risk_rules (
      project_id, flow_type, trigger_condition, risk_level, auto_approve_allowed,
      requires_manual_review, escalation_level, sensitive_topics, claim_restrictions,
      rejection_reason_tag, rollback_flag, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    [
      projectId, data.flow_type, data.trigger_condition, data.risk_level, data.auto_approve_allowed,
      data.requires_manual_review, data.escalation_level, data.sensitive_topics, data.claim_restrictions,
      data.rejection_reason_tag, data.rollback_flag, data.notes,
    ]);
  if (!row) throw new Error("Failed to insert risk_rule");
  return row;
}

export async function deleteRiskRules(db: Pool, projectId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.risk_rules WHERE project_id = $1`, [projectId]);
}

// ---------------------------------------------------------------------------
// Allowed Flow Types
// ---------------------------------------------------------------------------
export interface AllowedFlowTypeRow {
  id: string;
  project_id: string;
  flow_type: string;
  enabled: boolean;
  default_variation_count: number;
  requires_signal_pack: boolean;
  requires_learning_context: boolean;
  allowed_platforms: string | null;
  output_schema_version: string | null;
  qc_checklist_version: string | null;
  prompt_template_id: string | null;
  priority_weight: number | null;
  notes: string | null;
  /**
   * For FLOW_PRODUCT_* (and any flow the operator wants to pin):
   * 'script_led' → /v3/videos verbatim TTS.
   * 'prompt_led' → /v3/video-agents free creative.
   * NULL → use the code default (see domain/product-flow-types.ts#defaultProductFlowHeygenMode).
   * Ignored for non-product flows where the legacy flow-type regex already picks a route.
   */
  heygen_mode: ProductHeygenMode | null;
}

export async function listAllowedFlowTypes(db: Pool, projectId: string): Promise<AllowedFlowTypeRow[]> {
  return q<AllowedFlowTypeRow>(db,
    `SELECT * FROM caf_core.allowed_flow_types WHERE project_id = $1 ORDER BY priority_weight DESC NULLS LAST`, [projectId]);
}

export async function upsertAllowedFlowType(
  db: Pool, projectId: string, data: Omit<AllowedFlowTypeRow, "id" | "project_id">
): Promise<AllowedFlowTypeRow> {
  const row = await qOne<AllowedFlowTypeRow>(db, `
    INSERT INTO caf_core.allowed_flow_types (
      project_id, flow_type, enabled, default_variation_count, requires_signal_pack,
      requires_learning_context, allowed_platforms, output_schema_version, qc_checklist_version,
      prompt_template_id, priority_weight, notes, heygen_mode
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (project_id, flow_type) DO UPDATE SET
      enabled = EXCLUDED.enabled, default_variation_count = EXCLUDED.default_variation_count,
      requires_signal_pack = EXCLUDED.requires_signal_pack, requires_learning_context = EXCLUDED.requires_learning_context,
      allowed_platforms = EXCLUDED.allowed_platforms, output_schema_version = EXCLUDED.output_schema_version,
      qc_checklist_version = EXCLUDED.qc_checklist_version, prompt_template_id = EXCLUDED.prompt_template_id,
      priority_weight = EXCLUDED.priority_weight, notes = EXCLUDED.notes,
      heygen_mode = EXCLUDED.heygen_mode,
      updated_at = now()
    RETURNING *`,
    [
      projectId, data.flow_type, data.enabled, data.default_variation_count,
      data.requires_signal_pack, data.requires_learning_context, data.allowed_platforms,
      data.output_schema_version, data.qc_checklist_version, data.prompt_template_id,
      data.priority_weight, data.notes,
      data.heygen_mode ?? null,
    ]);
  if (!row) throw new Error("Failed to upsert allowed_flow_type");
  return row;
}

/**
 * Resolve the effective HeyGen routing mode for a product-flow job.
 * Checks per-project override first, then falls back to the baked-in default mapping.
 * Returns null when flow_type is not a product flow (caller should use legacy regex routing).
 */
export async function resolveProductFlowHeygenMode(
  db: Pool,
  projectId: string,
  flowType: string | null | undefined
): Promise<ProductHeygenMode | null> {
  if (!isProductVideoFlow(flowType)) return null;
  try {
    const row = await qOne<{ heygen_mode: string | null }>(
      db,
      `SELECT heygen_mode FROM caf_core.allowed_flow_types WHERE project_id = $1 AND flow_type = $2`,
      [projectId, String(flowType).trim()]
    );
    const override = coerceProductHeygenMode(row?.heygen_mode);
    if (override) return override;
  } catch {
    /* allowed_flow_types is optional — fall through to default. */
  }
  return defaultProductFlowHeygenMode(flowType);
}

/** Upsert Flow Engine–aligned flows: carousel + 3 video paths (enabled). Safe to re-run. */
export async function seedCanonicalAllowedFlowTypes(db: Pool, projectId: string): Promise<void> {
  for (const row of CANONICAL_ALLOWED_FLOW_SEEDS) {
    await upsertAllowedFlowType(db, projectId, {
      flow_type: row.flow_type,
      enabled: true,
      default_variation_count: row.default_variation_count,
      requires_signal_pack: row.requires_signal_pack,
      requires_learning_context: false,
      allowed_platforms: row.allowed_platforms,
      output_schema_version: null,
      qc_checklist_version: null,
      prompt_template_id: null,
      priority_weight: row.priority_weight,
      notes: row.notes,
      heygen_mode: null,
    });
  }
}

/**
 * Additive product marketing flows — **disabled** until you enable per project.
 * Does not alter canonical carousel/video rows from {@link seedCanonicalAllowedFlowTypes}.
 * `heygen_mode` seeded from {@link defaultProductFlowHeygenMode} so freshly seeded rows show
 * the operator the effective default in the Flow Types settings UI (they can flip it anytime).
 */
export async function seedProductFlowTypesSkeleton(db: Pool, projectId: string): Promise<void> {
  let p = 6;
  for (const ft of PRODUCT_VIDEO_FLOW_TYPES) {
    await upsertAllowedFlowType(db, projectId, {
      flow_type: ft,
      enabled: false,
      default_variation_count: 1,
      requires_signal_pack: true,
      requires_learning_context: false,
      allowed_platforms: null,
      output_schema_version: null,
      qc_checklist_version: null,
      prompt_template_id: null,
      priority_weight: p--,
      notes: "Product marketing video — maps to Video_Prompt_Generator templates; enable when ready.",
      heygen_mode: defaultProductFlowHeygenMode(ft),
    });
  }
  p = 5;
  for (const ft of PRODUCT_IMAGE_FLOW_TYPES) {
    await upsertAllowedFlowType(db, projectId, {
      flow_type: ft,
      enabled: false,
      default_variation_count: 1,
      requires_signal_pack: true,
      requires_learning_context: false,
      allowed_platforms: null,
      output_schema_version: null,
      qc_checklist_version: null,
      prompt_template_id: null,
      priority_weight: p--,
      notes: "Image ad flow — generation blocked until image tool is integrated.",
      heygen_mode: null,
    });
  }
}

/**
 * If the project has no enabled flow types, make Start Run usable:
 * - rows exist but all disabled → enable carousel-like row or the first row
 * - no rows → seed canonical carousel + three video flow types (workbook names)
 */
export async function ensureDefaultAllowedFlowsIfNone(db: Pool, projectId: string): Promise<void> {
  const rows = await listAllowedFlowTypes(db, projectId);
  const enabled = rows.filter((r) => r.enabled);
  if (enabled.length > 0) return;

  if (rows.length > 0) {
    const carousel = rows.find((r) => /carousel/i.test(r.flow_type));
    const pick = carousel ?? rows[0];
    await upsertAllowedFlowType(db, projectId, {
      flow_type: pick.flow_type,
      enabled: true,
      default_variation_count: pick.default_variation_count,
      requires_signal_pack: pick.requires_signal_pack,
      requires_learning_context: pick.requires_learning_context,
      allowed_platforms: pick.allowed_platforms,
      output_schema_version: pick.output_schema_version,
      qc_checklist_version: pick.qc_checklist_version,
      prompt_template_id: pick.prompt_template_id,
      priority_weight: pick.priority_weight,
      notes: pick.notes,
      heygen_mode: pick.heygen_mode ?? null,
    });
    return;
  }

  await seedCanonicalAllowedFlowTypes(db, projectId);
}

export async function deleteAllowedFlowType(db: Pool, projectId: string, flowType: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.allowed_flow_types WHERE project_id = $1 AND flow_type = $2`, [projectId, flowType]);
}

/** Remove every allowed_flow_types row for a project (e.g. before re-seeding canonical flows). */
export async function deleteAllAllowedFlowTypesForProject(db: Pool, projectId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.allowed_flow_types WHERE project_id = $1`, [projectId]);
}

// ---------------------------------------------------------------------------
// Reference Posts
// ---------------------------------------------------------------------------
export interface ReferencePostRow {
  id: string;
  project_id: string;
  reference_post_id: string;
  platform: string | null;
  post_url: string | null;
  status: string;
  last_run_id: string | null;
  notes: string | null;
}

export async function listReferencePosts(db: Pool, projectId: string): Promise<ReferencePostRow[]> {
  return q<ReferencePostRow>(db,
    `SELECT * FROM caf_core.reference_posts WHERE project_id = $1 ORDER BY created_at`, [projectId]);
}

export async function upsertReferencePost(
  db: Pool, projectId: string, data: Omit<ReferencePostRow, "id" | "project_id">
): Promise<ReferencePostRow> {
  const row = await qOne<ReferencePostRow>(db, `
    INSERT INTO caf_core.reference_posts (project_id, reference_post_id, platform, post_url, status, last_run_id, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (project_id, reference_post_id) DO UPDATE SET
      platform = EXCLUDED.platform, post_url = EXCLUDED.post_url, status = EXCLUDED.status,
      last_run_id = EXCLUDED.last_run_id, notes = EXCLUDED.notes, updated_at = now()
    RETURNING *`,
    [projectId, data.reference_post_id, data.platform, data.post_url, data.status, data.last_run_id, data.notes]);
  if (!row) throw new Error("Failed to upsert reference_post");
  return row;
}

export async function deleteReferencePost(db: Pool, projectId: string, referencePostId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.reference_posts WHERE project_id = $1 AND reference_post_id = $2`, [projectId, referencePostId]);
}

// ---------------------------------------------------------------------------
// Viral Formats
// ---------------------------------------------------------------------------
export async function listViralFormats(db: Pool, projectId: string, limit = 100, offset = 0) {
  return q(db,
    `SELECT * FROM caf_core.viral_formats WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]);
}

export async function insertViralFormat(db: Pool, projectId: string, data: Record<string, unknown>): Promise<string> {
  const row = await qOne<{ id: string }>(db, `
    INSERT INTO caf_core.viral_formats (
      project_id, reference_post_id, platform, post_url, asset_type, author_handle,
      timestamp_utc, duration_seconds, caption, hashtags_json, views, likes, comments_count,
      audio_id, music_artist, music_title, hook_type, hook_text, hook_seconds,
      pattern_structure_json, emotional_arc, retention_devices_json, cta_pattern,
      replication_template_json, transcript_full, notes, run_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb,$23,$24::jsonb,$25,$26,$27)
    ON CONFLICT (project_id, reference_post_id, platform) DO UPDATE SET
      post_url = EXCLUDED.post_url, asset_type = EXCLUDED.asset_type, author_handle = EXCLUDED.author_handle,
      timestamp_utc = EXCLUDED.timestamp_utc, duration_seconds = EXCLUDED.duration_seconds,
      caption = EXCLUDED.caption, hashtags_json = EXCLUDED.hashtags_json, views = EXCLUDED.views,
      likes = EXCLUDED.likes, comments_count = EXCLUDED.comments_count,
      hook_type = EXCLUDED.hook_type, hook_text = EXCLUDED.hook_text, hook_seconds = EXCLUDED.hook_seconds,
      pattern_structure_json = EXCLUDED.pattern_structure_json, emotional_arc = EXCLUDED.emotional_arc,
      retention_devices_json = EXCLUDED.retention_devices_json, cta_pattern = EXCLUDED.cta_pattern,
      replication_template_json = EXCLUDED.replication_template_json, transcript_full = EXCLUDED.transcript_full,
      notes = EXCLUDED.notes
    RETURNING id`,
    [
      projectId, data.reference_post_id, data.platform, data.post_url, data.asset_type, data.author_handle,
      data.timestamp_utc ?? null, data.duration_seconds ?? null, data.caption,
      JSON.stringify(data.hashtags_json ?? []), data.views ?? null, data.likes ?? null, data.comments_count ?? null,
      data.audio_id ?? null, data.music_artist ?? null, data.music_title ?? null,
      data.hook_type ?? null, data.hook_text ?? null, data.hook_seconds ?? null,
      JSON.stringify(data.pattern_structure_json ?? []), data.emotional_arc ?? null,
      JSON.stringify(data.retention_devices_json ?? []), data.cta_pattern ?? null,
      JSON.stringify(data.replication_template_json ?? {}), data.transcript_full ?? null,
      data.notes ?? null, data.run_id ?? null,
    ]);
  if (!row) throw new Error("Failed to insert viral_format");
  return row.id;
}

// ---------------------------------------------------------------------------
// HeyGen Config
// ---------------------------------------------------------------------------
export interface HeygenConfigRow {
  id: string;
  project_id: string;
  config_id: string;
  platform: string | null;
  flow_type: string | null;
  config_key: string;
  value: string | null;
  render_mode: string | null;
  value_type: string;
  is_active: boolean;
  notes: string | null;
}

export async function listHeygenConfig(db: Pool, projectId: string): Promise<HeygenConfigRow[]> {
  return q<HeygenConfigRow>(db,
    `SELECT * FROM caf_core.heygen_config WHERE project_id = $1 AND is_active = true ORDER BY config_key`, [projectId]);
}

export async function upsertHeygenConfig(
  db: Pool, projectId: string, data: Omit<HeygenConfigRow, "id" | "project_id">
): Promise<HeygenConfigRow> {
  const row = await qOne<HeygenConfigRow>(db, `
    INSERT INTO caf_core.heygen_config (
      project_id, config_id, platform, flow_type, config_key, value, render_mode, value_type, is_active, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (project_id, config_id) DO UPDATE SET
      platform = EXCLUDED.platform, flow_type = EXCLUDED.flow_type, config_key = EXCLUDED.config_key,
      value = EXCLUDED.value, render_mode = EXCLUDED.render_mode, value_type = EXCLUDED.value_type,
      is_active = EXCLUDED.is_active, notes = EXCLUDED.notes, updated_at = now()
    RETURNING *`,
    [
      projectId, data.config_id, data.platform, data.flow_type, data.config_key,
      data.value, data.render_mode, data.value_type, data.is_active, data.notes,
    ]);
  if (!row) throw new Error("Failed to upsert heygen_config");
  return row;
}

export async function deleteHeygenConfig(db: Pool, projectId: string, configId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.heygen_config WHERE project_id = $1 AND config_id = $2`, [projectId, configId]);
}

export async function deleteRiskRule(db: Pool, id: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.risk_rules WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Brand assets (project kit for HeyGen reference files, etc.)
// ---------------------------------------------------------------------------
export interface ProjectBrandAssetRow {
  id: string;
  project_id: string;
  kind: string;
  label: string | null;
  sort_order: number;
  public_url: string | null;
  storage_path: string | null;
  heygen_asset_id: string | null;
  heygen_synced_at: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listProjectBrandAssets(db: Pool, projectId: string): Promise<ProjectBrandAssetRow[]> {
  const rows = await q<Record<string, unknown>>(db,
    `SELECT id, project_id, kind, label, sort_order, public_url, storage_path,
            heygen_asset_id, heygen_synced_at, metadata_json, created_at, updated_at
     FROM caf_core.project_brand_assets WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [projectId]
  );
  return rows.map((r) => ({
    ...r,
    metadata_json: (r.metadata_json as Record<string, unknown>) ?? {},
  })) as ProjectBrandAssetRow[];
}

export async function getProjectBrandAsset(
  db: Pool,
  projectId: string,
  assetId: string
): Promise<ProjectBrandAssetRow | null> {
  const row = await qOne<Record<string, unknown>>(db,
    `SELECT id, project_id, kind, label, sort_order, public_url, storage_path,
            heygen_asset_id, heygen_synced_at, metadata_json, created_at, updated_at
     FROM caf_core.project_brand_assets WHERE project_id = $1 AND id = $2`,
    [projectId, assetId]
  );
  if (!row) return null;
  return { ...row, metadata_json: (row.metadata_json as Record<string, unknown>) ?? {} } as ProjectBrandAssetRow;
}

export async function insertProjectBrandAsset(
  db: Pool,
  projectId: string,
  data: {
    kind: string;
    label?: string | null;
    sort_order?: number;
    public_url?: string | null;
    storage_path?: string | null;
    heygen_asset_id?: string | null;
    metadata_json?: Record<string, unknown>;
  }
): Promise<ProjectBrandAssetRow> {
  const row = await qOne<ProjectBrandAssetRow>(db,
    `INSERT INTO caf_core.project_brand_assets (
       project_id, kind, label, sort_order, public_url, storage_path, heygen_asset_id, metadata_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING id, project_id, kind, label, sort_order, public_url, storage_path,
               heygen_asset_id, heygen_synced_at, metadata_json, created_at, updated_at`,
    [
      projectId,
      data.kind,
      data.label ?? null,
      data.sort_order ?? 0,
      data.public_url ?? null,
      data.storage_path ?? null,
      data.heygen_asset_id ?? null,
      JSON.stringify(data.metadata_json ?? {}),
    ]
  );
  if (!row) throw new Error("insertProjectBrandAsset failed");
  return row;
}

export async function updateProjectBrandAsset(
  db: Pool,
  projectId: string,
  assetId: string,
  data: Partial<{
    kind: string;
    label: string | null;
    sort_order: number;
    public_url: string | null;
    storage_path: string | null;
    heygen_asset_id: string | null;
    heygen_synced_at: string | null;
    metadata_json: Record<string, unknown>;
  }>
): Promise<ProjectBrandAssetRow | null> {
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (data.kind !== undefined) put("kind", data.kind);
  if (data.label !== undefined) put("label", data.label);
  if (data.sort_order !== undefined) put("sort_order", data.sort_order);
  if (data.public_url !== undefined) put("public_url", data.public_url);
  if (data.storage_path !== undefined) put("storage_path", data.storage_path);
  if (data.heygen_asset_id !== undefined) put("heygen_asset_id", data.heygen_asset_id);
  if (data.heygen_synced_at !== undefined) put("heygen_synced_at", data.heygen_synced_at);
  if (data.metadata_json !== undefined) put("metadata_json", JSON.stringify(data.metadata_json));
  if (sets.length === 1) return getProjectBrandAsset(db, projectId, assetId);
  const nextParam = vals.length + 1;
  vals.push(projectId, assetId);
  const row = await qOne<ProjectBrandAssetRow>(
    db,
    `UPDATE caf_core.project_brand_assets SET ${sets.join(", ")}
     WHERE project_id = $${nextParam} AND id = $${nextParam + 1}
     RETURNING id, project_id, kind, label, sort_order, public_url, storage_path,
               heygen_asset_id, heygen_synced_at, metadata_json, created_at, updated_at`,
    vals
  );
  return row;
}

export async function deleteProjectBrandAsset(db: Pool, projectId: string, assetId: string): Promise<boolean> {
  const res = await db.query(
    `DELETE FROM caf_core.project_brand_assets WHERE project_id = $1 AND id = $2`,
    [projectId, assetId]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Product Profile (per-project; drives FLOW_PRODUCT_* prompts)
// ---------------------------------------------------------------------------
export interface ProductProfileRow {
  id: string;
  project_id: string;
  product_name: string | null;
  product_category: string | null;
  product_url: string | null;
  one_liner: string | null;
  value_proposition: string | null;
  elevator_pitch: string | null;
  primary_audience: string | null;
  audience_pain_points: string | null;
  audience_desires: string | null;
  use_cases: string | null;
  anti_audience: string | null;
  key_features: string | null;
  key_benefits: string | null;
  differentiators: string | null;
  proof_points: string | null;
  social_proof: string | null;
  competitors: string | null;
  comparison_angles: string | null;
  pricing_summary: string | null;
  current_offer: string | null;
  offer_urgency: string | null;
  guarantee: string | null;
  primary_cta: string | null;
  secondary_cta: string | null;
  do_say: string | null;
  dont_say: string | null;
  taglines: string | null;
  keywords: string | null;
  metadata_json: Record<string, unknown>;
}

const PRODUCT_PROFILE_COLS = [
  "product_name",
  "product_category",
  "product_url",
  "one_liner",
  "value_proposition",
  "elevator_pitch",
  "primary_audience",
  "audience_pain_points",
  "audience_desires",
  "use_cases",
  "anti_audience",
  "key_features",
  "key_benefits",
  "differentiators",
  "proof_points",
  "social_proof",
  "competitors",
  "comparison_angles",
  "pricing_summary",
  "current_offer",
  "offer_urgency",
  "guarantee",
  "primary_cta",
  "secondary_cta",
  "do_say",
  "dont_say",
  "taglines",
  "keywords",
] as const;

export async function getProductProfile(db: Pool, projectId: string): Promise<ProductProfileRow | null> {
  return qOne<ProductProfileRow>(db,
    `SELECT * FROM caf_core.project_product_profile WHERE project_id = $1`, [projectId]);
}

export async function upsertProductProfile(
  db: Pool,
  projectId: string,
  data: Partial<Omit<ProductProfileRow, "id" | "project_id">>
): Promise<ProductProfileRow> {
  const values = PRODUCT_PROFILE_COLS.map((col) => {
    const v = (data as Record<string, unknown>)[col];
    if (v == null) return null;
    if (typeof v === "string") {
      const trimmed = v.trim();
      return trimmed ? trimmed : null;
    }
    return v;
  });
  const metadata = data.metadata_json && typeof data.metadata_json === "object" && !Array.isArray(data.metadata_json)
    ? data.metadata_json
    : {};

  const insertCols = ["project_id", ...PRODUCT_PROFILE_COLS, "metadata_json"];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(",");
  const updateCols = [...PRODUCT_PROFILE_COLS, "metadata_json"]
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  const row = await qOne<ProductProfileRow>(db, `
    INSERT INTO caf_core.project_product_profile (${insertCols.join(",")})
    VALUES (${placeholders})
    ON CONFLICT (project_id) DO UPDATE SET
      ${updateCols}, updated_at = now()
    RETURNING *`,
    [projectId, ...values, metadata]);
  if (!row) throw new Error("Failed to upsert project_product_profile");
  return row;
}

// ---------------------------------------------------------------------------
// Project carousel template pins (.hbs names)
// ---------------------------------------------------------------------------

export async function listProjectCarouselTemplates(db: Pool, projectId: string): Promise<string[]> {
  const rows = await q<{ html_template_name: string }>(db,
    `SELECT html_template_name FROM caf_core.project_carousel_templates
     WHERE project_id = $1 ORDER BY html_template_name`,
    [projectId]);
  return rows.map((r) => r.html_template_name);
}

export async function addProjectCarouselTemplate(
  db: Pool,
  projectId: string,
  htmlTemplateName: string
): Promise<void> {
  await db.query(
    `INSERT INTO caf_core.project_carousel_templates (project_id, html_template_name)
     VALUES ($1, $2)
     ON CONFLICT (project_id, html_template_name) DO NOTHING`,
    [projectId, htmlTemplateName]
  );
}

export async function removeProjectCarouselTemplate(
  db: Pool,
  projectId: string,
  htmlTemplateName: string
): Promise<void> {
  await db.query(
    `DELETE FROM caf_core.project_carousel_templates WHERE project_id = $1 AND html_template_name = $2`,
    [projectId, htmlTemplateName]
  );
}

/** Replace all pinned carousel `.hbs` names for a project (transactional). */
export async function setProjectCarouselTemplates(db: Pool, projectId: string, names: string[]): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM caf_core.project_carousel_templates WHERE project_id = $1`, [projectId]);
    for (const n of names) {
      const trimmed = String(n ?? "").trim();
      if (!trimmed) continue;
      await client.query(
        `INSERT INTO caf_core.project_carousel_templates (project_id, html_template_name) VALUES ($1, $2)`,
        [projectId, trimmed]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Full Project Profile (composite read)
// ---------------------------------------------------------------------------
export async function getFullProjectProfile(db: Pool, projectId: string) {
  const [strategy, brand, platforms, riskRules, flowTypes, referencePosts, heygenConfig, brandAssets, product, carouselTemplates] =
    await Promise.all([
      getStrategyDefaults(db, projectId),
      getBrandConstraints(db, projectId),
      listPlatformConstraints(db, projectId),
      listRiskRules(db, projectId),
      listAllowedFlowTypes(db, projectId),
      listReferencePosts(db, projectId),
      listHeygenConfig(db, projectId),
      listProjectBrandAssets(db, projectId),
      getProductProfile(db, projectId),
      listProjectCarouselTemplates(db, projectId),
    ]);
  return {
    strategy,
    brand,
    platforms,
    risk_rules: riskRules,
    flow_types: flowTypes,
    reference_posts: referencePosts,
    heygen_config: heygenConfig,
    brand_assets: brandAssets,
    product,
    carousel_templates: carouselTemplates,
  };
}
