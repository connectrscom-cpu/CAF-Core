import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import {
  getStrategyDefaults, upsertStrategyDefaults,
  getBrandConstraints, upsertBrandConstraints,
  listPlatformConstraints, upsertPlatformConstraints,
  listRiskRules, upsertRiskRule, deleteRiskRules,
  listAllowedFlowTypes, upsertAllowedFlowType,
  listReferencePosts, upsertReferencePost,
  listViralFormats, insertViralFormat,
  listHeygenConfig, upsertHeygenConfig,
  getFullProjectProfile,
} from "../repositories/project-config.js";

export function registerProjectConfigRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  // ── List all projects ────────────────────────────────────────────────
  app.get("/v1/projects", async () => {
    const { q } = await import("../db/queries.js");
    const projects = await q(db,
      `SELECT id, slug, display_name, active, created_at, updated_at FROM caf_core.projects ORDER BY slug`);
    return { ok: true, projects };
  });

  // ── Create/update project ────────────────────────────────────────────
  app.post("/v1/projects", async (request, reply) => {
    const body = z.object({
      slug: z.string(),
      display_name: z.string().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body" });
    const project = await ensureProject(db, body.data.slug, body.data.display_name);
    return { ok: true, project };
  });

  // ── Full profile ─────────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/profile", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const profile = await getFullProjectProfile(db, project.id);
    return { ok: true, project: { id: project.id, slug: project.slug, display_name: project.display_name }, ...profile };
  });

  // ── Strategy Defaults ────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/strategy", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getStrategyDefaults(db, project.id);
    return { ok: true, strategy: row };
  });

  const strategySchema = z.object({
    project_type: z.string().nullish(),
    core_offer: z.string().nullish(),
    target_audience: z.string().nullish(),
    audience_problem: z.string().nullish(),
    transformation_promise: z.string().nullish(),
    positioning_statement: z.string().nullish(),
    primary_business_goal: z.string().nullish(),
    primary_content_goal: z.string().nullish(),
    north_star_metric: z.string().nullish(),
    monetization_model: z.string().nullish(),
    traffic_destination: z.string().nullish(),
    funnel_stage_focus: z.string().nullish(),
    brand_archetype: z.string().nullish(),
    strategic_content_pillars: z.string().nullish(),
    authority_angle: z.string().nullish(),
    differentiation_angle: z.string().nullish(),
    growth_strategy: z.string().nullish(),
    publishing_intensity: z.string().nullish(),
    time_horizon: z.string().nullish(),
    owner: z.string().nullish(),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/strategy", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = strategySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertStrategyDefaults(db, project.id, {
      project_type: body.data.project_type ?? null,
      core_offer: body.data.core_offer ?? null,
      target_audience: body.data.target_audience ?? null,
      audience_problem: body.data.audience_problem ?? null,
      transformation_promise: body.data.transformation_promise ?? null,
      positioning_statement: body.data.positioning_statement ?? null,
      primary_business_goal: body.data.primary_business_goal ?? null,
      primary_content_goal: body.data.primary_content_goal ?? null,
      north_star_metric: body.data.north_star_metric ?? null,
      monetization_model: body.data.monetization_model ?? null,
      traffic_destination: body.data.traffic_destination ?? null,
      funnel_stage_focus: body.data.funnel_stage_focus ?? null,
      brand_archetype: body.data.brand_archetype ?? null,
      strategic_content_pillars: body.data.strategic_content_pillars ?? null,
      authority_angle: body.data.authority_angle ?? null,
      differentiation_angle: body.data.differentiation_angle ?? null,
      growth_strategy: body.data.growth_strategy ?? null,
      publishing_intensity: body.data.publishing_intensity ?? null,
      time_horizon: body.data.time_horizon ?? null,
      owner: body.data.owner ?? null,
      notes: body.data.notes ?? null,
    });
    return { ok: true, strategy: row };
  });

  // ── Brand Constraints ────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/brand", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getBrandConstraints(db, project.id);
    return { ok: true, brand: row };
  });

  const brandSchema = z.object({
    tone: z.string().nullish(),
    voice_style: z.string().nullish(),
    audience_level: z.string().nullish(),
    emotional_intensity: z.number().nullish(),
    humor_level: z.number().nullish(),
    emoji_policy: z.string().nullish(),
    max_emojis_per_caption: z.number().int().nullish(),
    banned_claims: z.string().nullish(),
    banned_words: z.string().nullish(),
    mandatory_disclaimers: z.string().nullish(),
    cta_style_rules: z.string().nullish(),
    storytelling_style: z.string().nullish(),
    positioning_statement: z.string().nullish(),
    differentiation_angle: z.string().nullish(),
    risk_level_default: z.string().nullish(),
    manual_review_required: z.boolean().default(true),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/brand", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = brandSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertBrandConstraints(db, project.id, {
      tone: body.data.tone ?? null,
      voice_style: body.data.voice_style ?? null,
      audience_level: body.data.audience_level ?? null,
      emotional_intensity: body.data.emotional_intensity ?? null,
      humor_level: body.data.humor_level ?? null,
      emoji_policy: body.data.emoji_policy ?? null,
      max_emojis_per_caption: body.data.max_emojis_per_caption ?? null,
      banned_claims: body.data.banned_claims ?? null,
      banned_words: body.data.banned_words ?? null,
      mandatory_disclaimers: body.data.mandatory_disclaimers ?? null,
      cta_style_rules: body.data.cta_style_rules ?? null,
      storytelling_style: body.data.storytelling_style ?? null,
      positioning_statement: body.data.positioning_statement ?? null,
      differentiation_angle: body.data.differentiation_angle ?? null,
      risk_level_default: body.data.risk_level_default ?? null,
      manual_review_required: body.data.manual_review_required,
      notes: body.data.notes ?? null,
    });
    return { ok: true, brand: row };
  });

  // ── Platform Constraints ─────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/platforms", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listPlatformConstraints(db, project.id);
    return { ok: true, platforms: rows };
  });

  const platformSchema = z.object({
    platform: z.string(),
    caption_max_chars: z.number().int().nullish(),
    hook_must_fit_first_lines: z.boolean().default(true),
    hook_max_chars: z.number().int().nullish(),
    slide_min_chars: z.number().int().nullish(),
    slide_max_chars: z.number().int().nullish(),
    slide_min: z.number().int().nullish(),
    slide_max: z.number().int().nullish(),
    max_hashtags: z.number().int().nullish(),
    hashtag_format_rule: z.string().nullish(),
    line_break_policy: z.string().nullish(),
    emoji_allowed: z.boolean().default(true),
    link_allowed: z.boolean().default(false),
    tag_allowed: z.boolean().default(true),
    formatting_rules: z.string().nullish(),
    posting_frequency_limit: z.string().nullish(),
    best_posting_window: z.string().nullish(),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/platforms", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = platformSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request", details: body.error?.flatten() });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertPlatformConstraints(db, project.id, {
      platform: body.data.platform,
      caption_max_chars: body.data.caption_max_chars ?? null,
      hook_must_fit_first_lines: body.data.hook_must_fit_first_lines,
      hook_max_chars: body.data.hook_max_chars ?? null,
      slide_min_chars: body.data.slide_min_chars ?? null,
      slide_max_chars: body.data.slide_max_chars ?? null,
      slide_min: body.data.slide_min ?? null,
      slide_max: body.data.slide_max ?? null,
      max_hashtags: body.data.max_hashtags ?? null,
      hashtag_format_rule: body.data.hashtag_format_rule ?? null,
      line_break_policy: body.data.line_break_policy ?? null,
      emoji_allowed: body.data.emoji_allowed,
      link_allowed: body.data.link_allowed,
      tag_allowed: body.data.tag_allowed,
      formatting_rules: body.data.formatting_rules ?? null,
      posting_frequency_limit: body.data.posting_frequency_limit ?? null,
      best_posting_window: body.data.best_posting_window ?? null,
      notes: body.data.notes ?? null,
    });
    return { ok: true, platform: row };
  });

  // ── Risk Rules ───────────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/risk-rules", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listRiskRules(db, project.id);
    return { ok: true, risk_rules: rows };
  });

  const riskRuleSchema = z.object({
    flow_type: z.string(),
    trigger_condition: z.string().nullish(),
    risk_level: z.string().nullish(),
    auto_approve_allowed: z.boolean().default(false),
    requires_manual_review: z.boolean().default(true),
    escalation_level: z.string().nullish(),
    sensitive_topics: z.string().nullish(),
    claim_restrictions: z.string().nullish(),
    rejection_reason_tag: z.string().nullish(),
    rollback_flag: z.boolean().default(false),
    notes: z.string().nullish(),
  });

  app.post("/v1/projects/:project_slug/risk-rules", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = riskRuleSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertRiskRule(db, project.id, {
      flow_type: body.data.flow_type,
      trigger_condition: body.data.trigger_condition ?? null,
      risk_level: body.data.risk_level ?? null,
      auto_approve_allowed: body.data.auto_approve_allowed,
      requires_manual_review: body.data.requires_manual_review,
      escalation_level: body.data.escalation_level ?? null,
      sensitive_topics: body.data.sensitive_topics ?? null,
      claim_restrictions: body.data.claim_restrictions ?? null,
      rejection_reason_tag: body.data.rejection_reason_tag ?? null,
      rollback_flag: body.data.rollback_flag,
      notes: body.data.notes ?? null,
    });
    return { ok: true, risk_rule: row };
  });

  app.delete("/v1/projects/:project_slug/risk-rules", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    await deleteRiskRules(db, project.id);
    return { ok: true };
  });

  // ── Allowed Flow Types ───────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/flow-types", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listAllowedFlowTypes(db, project.id);
    return { ok: true, flow_types: rows };
  });

  const flowTypeSchema = z.object({
    flow_type: z.string(),
    enabled: z.boolean().default(true),
    default_variation_count: z.number().int().default(1),
    requires_signal_pack: z.boolean().default(true),
    requires_learning_context: z.boolean().default(true),
    allowed_platforms: z.string().nullish(),
    output_schema_version: z.string().nullish(),
    qc_checklist_version: z.string().nullish(),
    prompt_template_id: z.string().nullish(),
    priority_weight: z.number().nullish(),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/flow-types", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = flowTypeSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertAllowedFlowType(db, project.id, {
      flow_type: body.data.flow_type,
      enabled: body.data.enabled,
      default_variation_count: body.data.default_variation_count,
      requires_signal_pack: body.data.requires_signal_pack,
      requires_learning_context: body.data.requires_learning_context,
      allowed_platforms: body.data.allowed_platforms ?? null,
      output_schema_version: body.data.output_schema_version ?? null,
      qc_checklist_version: body.data.qc_checklist_version ?? null,
      prompt_template_id: body.data.prompt_template_id ?? null,
      priority_weight: body.data.priority_weight ?? null,
      notes: body.data.notes ?? null,
    });
    return { ok: true, flow_type: row };
  });

  // ── Reference Posts ──────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/reference-posts", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listReferencePosts(db, project.id);
    return { ok: true, reference_posts: rows };
  });

  const refPostSchema = z.object({
    reference_post_id: z.string(),
    platform: z.string().nullish(),
    post_url: z.string().nullish(),
    status: z.string().default("pending"),
    last_run_id: z.string().nullish(),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/reference-posts", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = refPostSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertReferencePost(db, project.id, {
      reference_post_id: body.data.reference_post_id,
      platform: body.data.platform ?? null,
      post_url: body.data.post_url ?? null,
      status: body.data.status,
      last_run_id: body.data.last_run_id ?? null,
      notes: body.data.notes ?? null,
    });
    return { ok: true, reference_post: row };
  });

  // ── Viral Formats ────────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/viral-formats", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({ limit: z.coerce.number().int().default(100), offset: z.coerce.number().int().default(0) }).safeParse(request.query);
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listViralFormats(db, project.id, query.data?.limit ?? 100, query.data?.offset ?? 0);
    return { ok: true, viral_formats: rows, count: rows.length };
  });

  app.post("/v1/projects/:project_slug/viral-formats", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const body = request.body as Record<string, unknown>;
    const id = await insertViralFormat(db, project.id, body);
    return { ok: true, id };
  });

  // ── HeyGen Config ────────────────────────────────────────────────────
  app.get("/v1/projects/:project_slug/heygen-config", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listHeygenConfig(db, project.id);
    return { ok: true, heygen_config: rows };
  });

  const heygenSchema = z.object({
    config_id: z.string(),
    platform: z.string().nullish(),
    flow_type: z.string().nullish(),
    config_key: z.string(),
    value: z.string().nullish(),
    render_mode: z.string().nullish(),
    value_type: z.string().default("string"),
    is_active: z.boolean().default(true),
    notes: z.string().nullish(),
  });

  app.put("/v1/projects/:project_slug/heygen-config", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = heygenSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertHeygenConfig(db, project.id, {
      config_id: body.data.config_id,
      platform: body.data.platform ?? null,
      flow_type: body.data.flow_type ?? null,
      config_key: body.data.config_key,
      value: body.data.value ?? null,
      render_mode: body.data.render_mode ?? null,
      value_type: body.data.value_type,
      is_active: body.data.is_active,
      notes: body.data.notes ?? null,
    });
    return { ok: true, heygen_config: row };
  });
}
