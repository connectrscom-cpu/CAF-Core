import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { ensureProject, updateProjectBySlug } from "../repositories/core.js";
import {
  getStrategyDefaults, upsertStrategyDefaults,
  getBrandConstraints, upsertBrandConstraints,
  listPlatformConstraints, upsertPlatformConstraints,
  listRiskRules, countRiskRules, upsertRiskRule, deleteRiskRules,
  listAllowedFlowTypes, upsertAllowedFlowType,
  listReferencePosts, upsertReferencePost,
  listViralFormats, insertViralFormat,
  listHeygenConfig, upsertHeygenConfig,
  getFullProjectProfile,
  getProductProfile,
  upsertProductProfile,
  listProjectBrandAssets,
  insertProjectBrandAsset,
  updateProjectBrandAsset,
  deleteProjectBrandAsset,
  getProjectBrandAsset,
} from "../repositories/project-config.js";
import { loadConfig } from "../config.js";
import {
  fetchStoragePathAndUploadToHeygen,
  fetchUrlAndUploadToHeygen,
} from "../services/heygen-assets.js";
import { uploadBuffer } from "../services/supabase-storage.js";
import {
  importProjectFromCsv,
  PROJECT_IMPORT_CSV_TEMPLATE,
} from "../services/project-csv-import.js";
import { exportProjectAsCsv } from "../services/project-csv-export.js";
import { buildRiskQcStatus, riskRulesNotEnforcedNotice } from "../services/risk-qc-status.js";

export function registerProjectConfigRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  // ── List all projects ────────────────────────────────────────────────
  app.get("/v1/projects", async () => {
    const { q } = await import("../db/queries.js");
    const projects = await q(
      db,
      `SELECT p.id, p.slug, p.display_name, p.active, p.color, p.created_at, p.updated_at,
              (SELECT COUNT(*)::int FROM caf_core.runs r WHERE r.project_id = p.id) AS run_count,
              (SELECT COUNT(*)::int FROM caf_core.content_jobs j WHERE j.project_id = p.id) AS job_count
       FROM caf_core.projects p
       ORDER BY p.slug`
    );
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

  // ── Import a project from CSV ────────────────────────────────────────
  //
  // Accepts either:
  //   - multipart/form-data with a file field (any name, first file wins), OR
  //   - application/json body `{ csv: "section,row_key,field,value\n..." }`
  //
  // Query params:
  //   - slug        Optional. Overrides / supplies the project slug (CSV still needs matching data).
  //   - dry_run     Optional (`true`/`false`). Parse-only; no DB writes.
  //
  // Returns: { ok, dry_run, project, applied: { section: rowCount, ... }, warnings, errors }
  app.post("/v1/projects/import-csv", async (request, reply) => {
    const query = z
      .object({
        slug: z.string().trim().min(1).optional(),
        dry_run: z.coerce.boolean().default(false),
        default_display_name: z.string().optional(),
      })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ ok: false, error: "invalid_query", details: query.error.flatten() });
    }

    const contentType = (request.headers["content-type"] ?? "").toLowerCase();

    let csvText: string | null = null;

    try {
      if (contentType.startsWith("multipart/")) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === "file") {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            csvText = Buffer.concat(chunks).toString("utf8");
            break;
          }
        }
        if (!csvText) {
          return reply.code(400).send({ ok: false, error: "file_required", message: "Upload a CSV file in the multipart body." });
        }
      } else if (contentType.startsWith("application/json")) {
        const body = z.object({ csv: z.string().min(1) }).safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });
        }
        csvText = body.data.csv;
      } else {
        return reply.code(415).send({
          ok: false,
          error: "unsupported_media_type",
          message: "Use multipart/form-data (file upload) or application/json { csv: \"...\" }.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "read_failed", message: msg.slice(0, 500) });
    }

    const result = await importProjectFromCsv(db, csvText, {
      slug_override: query.data.slug ?? null,
      default_display_name: query.data.default_display_name ?? null,
      dry_run: query.data.dry_run,
    });
    const status = result.ok ? 200 : 400;
    return reply.code(status).send(result);
  });

  // ── Download a CSV template for the importer ─────────────────────────
  app.get("/v1/projects/import-csv/template", async (_request, reply) => {
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", "attachment; filename=\"caf-project-template.csv\"")
      .send(PROJECT_IMPORT_CSV_TEMPLATE);
  });

  // ── Export an existing project as an import-ready CSV ────────────────
  //
  // Produces the inverse of POST /v1/projects/import-csv: a CSV that, when
  // re-uploaded, re-creates a project with the same configuration.
  //
  // Query params (all optional):
  //   - new_slug              Overrides `project.slug` so the CSV re-imports as a new project.
  //   - new_display_name      Overrides `project.display_name`.
  //   - new_color             Overrides `project.color` (#RRGGBB).
  //   - new_product_name      Overrides `product.product_name`.
  //   - new_product_url       Overrides `product.product_url` and `strategy.traffic_destination`.
  //   - new_instagram_handle  Overrides `strategy.instagram_handle`.
  //   - secrets               `"placeholder"` (default) replaces integration secret
  //                           values with `REPLACE_ME`; `"include"` copies them verbatim.
  //   - risk_rules            `"highest_severity"` (default) keeps one rule per flow;
  //                           `"keep_all"` emits every rule (not round-trip safe).
  //   - format                `"csv"` (default) streams CSV; `"json"` returns
  //                           `{ csv, filename, rows, warnings, metadata }`.
  app.get("/v1/projects/:project_slug/export-csv", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_params" });
    const query = z
      .object({
        new_slug: z.string().trim().min(1).optional(),
        new_display_name: z.string().trim().min(1).optional(),
        new_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        new_product_name: z.string().trim().min(1).optional(),
        new_product_url: z.string().trim().url().optional(),
        new_instagram_handle: z.string().trim().min(1).optional(),
        secrets: z.enum(["placeholder", "include"]).default("placeholder"),
        risk_rules: z.enum(["highest_severity", "keep_all"]).default("highest_severity"),
        format: z.enum(["csv", "json"]).default("csv"),
      })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ ok: false, error: "invalid_query", details: query.error.flatten() });
    }

    try {
      const result = await exportProjectAsCsv(db, params.data.project_slug, {
        new_slug: query.data.new_slug ?? null,
        new_display_name: query.data.new_display_name ?? null,
        new_color: query.data.new_color ?? null,
        new_product_name: query.data.new_product_name ?? null,
        new_product_url: query.data.new_product_url ?? null,
        new_instagram_handle: query.data.new_instagram_handle ?? null,
        secrets: query.data.secrets,
        collapse_risk_rules: query.data.risk_rules,
      });

      if (query.data.format === "json") {
        return reply.send({
          ok: true,
          csv: result.csv,
          filename: result.filename,
          rows: result.rows,
          warnings: result.warnings,
          metadata: result.metadata,
        });
      }

      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${result.filename}"`)
        .header("x-caf-warnings", result.warnings.length ? String(result.warnings.length) : "0")
        .send(result.csv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/project not found/i.test(msg)) {
        return reply.code(404).send({ ok: false, error: "not_found", message: msg });
      }
      return reply.code(500).send({ ok: false, error: "export_failed", message: msg.slice(0, 500) });
    }
  });

  // ── Patch project metadata (admin) ────────────────────────────────────
  app.put("/v1/projects/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        display_name: z.string().nullish(),
        active: z.boolean().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request", details: body.success ? undefined : body.error.flatten() });
    }
    const updated = await updateProjectBySlug(db, params.data.project_slug, {
      display_name: body.data.display_name ?? null,
      active: body.data.active,
      color: body.data.color ?? null,
    });
    if (!updated) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, project: updated };
  });

  // ── Delete project (admin) ────────────────────────────────────────────
  app.delete("/v1/projects/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = z.object({ force: z.coerce.boolean().default(false) }).safeParse(request.query);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const { qOne } = await import("../db/queries.js");
    const counts = await qOne<{ run_count: number; job_count: number }>(
      db,
      `SELECT
         (SELECT COUNT(*)::int FROM caf_core.runs r WHERE r.project_id = p.id) AS run_count,
         (SELECT COUNT(*)::int FROM caf_core.content_jobs j WHERE j.project_id = p.id) AS job_count
       FROM caf_core.projects p
       WHERE p.slug = $1`,
      [params.data.project_slug]
    );
    if (!counts) return reply.code(404).send({ ok: false, error: "not_found" });
    const force = query.success ? query.data.force : false;
    if (!force && (counts.run_count > 0 || counts.job_count > 0)) {
      return reply.code(409).send({ ok: false, error: "project_not_empty", counts });
    }

    await db.query(`DELETE FROM caf_core.projects WHERE slug = $1`, [params.data.project_slug]);
    return { ok: true, deleted: params.data.project_slug };
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
    instagram_handle: z.string().nullish(),
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
      instagram_handle: body.data.instagram_handle ?? null,
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

  // ── Product Profile (drives FLOW_PRODUCT_* video generation) ─────────
  app.get("/v1/projects/:project_slug/product", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getProductProfile(db, project.id);
    return { ok: true, product: row };
  });

  const productSchema = z.object({
    product_name: z.string().nullish(),
    product_category: z.string().nullish(),
    product_url: z.string().nullish(),
    one_liner: z.string().nullish(),
    value_proposition: z.string().nullish(),
    elevator_pitch: z.string().nullish(),
    primary_audience: z.string().nullish(),
    audience_pain_points: z.string().nullish(),
    audience_desires: z.string().nullish(),
    use_cases: z.string().nullish(),
    anti_audience: z.string().nullish(),
    key_features: z.string().nullish(),
    key_benefits: z.string().nullish(),
    differentiators: z.string().nullish(),
    proof_points: z.string().nullish(),
    social_proof: z.string().nullish(),
    competitors: z.string().nullish(),
    comparison_angles: z.string().nullish(),
    pricing_summary: z.string().nullish(),
    current_offer: z.string().nullish(),
    offer_urgency: z.string().nullish(),
    guarantee: z.string().nullish(),
    primary_cta: z.string().nullish(),
    secondary_cta: z.string().nullish(),
    do_say: z.string().nullish(),
    dont_say: z.string().nullish(),
    taglines: z.string().nullish(),
    keywords: z.string().nullish(),
    metadata_json: z.record(z.string(), z.unknown()).nullish(),
  });

  app.put("/v1/projects/:project_slug/product", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = productSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: "invalid_request", details: body.success ? undefined : body.error.flatten() });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertProductProfile(db, project.id, {
      product_name: body.data.product_name ?? null,
      product_category: body.data.product_category ?? null,
      product_url: body.data.product_url ?? null,
      one_liner: body.data.one_liner ?? null,
      value_proposition: body.data.value_proposition ?? null,
      elevator_pitch: body.data.elevator_pitch ?? null,
      primary_audience: body.data.primary_audience ?? null,
      audience_pain_points: body.data.audience_pain_points ?? null,
      audience_desires: body.data.audience_desires ?? null,
      use_cases: body.data.use_cases ?? null,
      anti_audience: body.data.anti_audience ?? null,
      key_features: body.data.key_features ?? null,
      key_benefits: body.data.key_benefits ?? null,
      differentiators: body.data.differentiators ?? null,
      proof_points: body.data.proof_points ?? null,
      social_proof: body.data.social_proof ?? null,
      competitors: body.data.competitors ?? null,
      comparison_angles: body.data.comparison_angles ?? null,
      pricing_summary: body.data.pricing_summary ?? null,
      current_offer: body.data.current_offer ?? null,
      offer_urgency: body.data.offer_urgency ?? null,
      guarantee: body.data.guarantee ?? null,
      primary_cta: body.data.primary_cta ?? null,
      secondary_cta: body.data.secondary_cta ?? null,
      do_say: body.data.do_say ?? null,
      dont_say: body.data.dont_say ?? null,
      taglines: body.data.taglines ?? null,
      keywords: body.data.keywords ?? null,
      metadata_json: (body.data.metadata_json as Record<string, unknown>) ?? {},
    });
    return { ok: true, product: row };
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
    return { ok: true, risk_rules: rows, risk_qc: riskRulesNotEnforcedNotice() };
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
    return { ok: true, risk_rule: row, risk_qc: riskRulesNotEnforcedNotice() };
  });

  app.delete("/v1/projects/:project_slug/risk-rules", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    await deleteRiskRules(db, project.id);
    return { ok: true, risk_qc: riskRulesNotEnforcedNotice() };
  });

  // ── Risk/QC honesty status ──────────────────────────────────────────
  // Surfaces the fact that `risk_rules` are project-level policy
  // documentation only and are NOT applied by the QC runtime. See
  // `docs/RISK_RULES.md` and `src/services/risk-qc-status.ts`.
  app.get("/v1/projects/:project_slug/risk-qc-status", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const count = await countRiskRules(db, project.id);
    return { ok: true, project_slug: project.slug, ...buildRiskQcStatus(count) };
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
    /** "script_led" → /v3/videos verbatim TTS; "prompt_led" → /v3/video-agents agent-written VO; null = code default. */
    heygen_mode: z.enum(["script_led", "prompt_led"]).nullish(),
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
      heygen_mode: body.data.heygen_mode ?? null,
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

  // ── Brand assets (project kit) ───────────────────────────────────────
  const brandAssetKindSchema = z.enum(["logo", "reference_image", "palette", "font", "other"]);

  function guessBrandKitContentType(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".woff2")) return "font/woff2";
    if (lower.endsWith(".woff")) return "font/woff";
    if (lower.endsWith(".ttf")) return "font/ttf";
    if (lower.endsWith(".otf")) return "font/otf";
    return "application/octet-stream";
  }

  /** Multipart upload to Supabase public bucket; returns URLs for brand kit rows. */
  app.post("/v1/projects/:project_slug/brand-assets/upload", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    await ensureProject(db, params.data.project_slug);
    const appConfig = loadConfig();
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let fileName = "upload.bin";
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        fileName = part.filename || fileName;
      }
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ ok: false, error: "file_required" });
    }
    const safeSlug = params.data.project_slug.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64) || "project";
    const base = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "") || "file";
    const short = base.slice(0, 120);
    const objectRel = `brand-kit/${safeSlug}/${randomUUID()}-${short}`;
    try {
      const up = await uploadBuffer(appConfig, objectRel, fileBuffer, guessBrandKitContentType(fileName));
      return {
        ok: true,
        public_url: up.public_url,
        storage_path: up.object_path,
        bucket: up.bucket,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(503).send({ ok: false, error: "upload_failed", message: msg.slice(0, 500) });
    }
  });

  app.get("/v1/projects/:project_slug/brand-assets", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listProjectBrandAssets(db, project.id);
    return { ok: true, brand_assets: rows };
  });

  app.post("/v1/projects/:project_slug/brand-assets", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        kind: brandAssetKindSchema,
        label: z.string().nullish(),
        sort_order: z.number().int().optional(),
        public_url: z.string().nullish(),
        storage_path: z.string().nullish(),
        heygen_asset_id: z.string().nullish(),
        metadata_json: z.record(z.unknown()).optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const row = await insertProjectBrandAsset(db, project.id, {
      kind: body.data.kind,
      label: body.data.label ?? null,
      sort_order: body.data.sort_order,
      public_url: body.data.public_url?.trim() || null,
      storage_path: body.data.storage_path ?? null,
      heygen_asset_id: body.data.heygen_asset_id?.trim() || null,
      metadata_json: body.data.metadata_json,
    });
    return { ok: true, brand_asset: row };
  });

  app.patch("/v1/projects/:project_slug/brand-assets/:asset_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), asset_id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        kind: brandAssetKindSchema.optional(),
        label: z.string().nullish(),
        sort_order: z.number().int().optional(),
        public_url: z.string().nullish(),
        storage_path: z.string().nullish(),
        heygen_asset_id: z.string().nullish(),
        metadata_json: z.record(z.unknown()).optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const row = await updateProjectBrandAsset(db, project.id, params.data.asset_id, {
      kind: body.data.kind,
      label: body.data.label,
      sort_order: body.data.sort_order,
      public_url: body.data.public_url === "" ? null : body.data.public_url,
      storage_path: body.data.storage_path,
      heygen_asset_id: body.data.heygen_asset_id?.trim(),
      metadata_json: body.data.metadata_json,
    });
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, brand_asset: row };
  });

  app.delete("/v1/projects/:project_slug/brand-assets/:asset_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), asset_id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const ok = await deleteProjectBrandAsset(db, project.id, params.data.asset_id);
    if (!ok) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true };
  });

  app.post("/v1/projects/:project_slug/brand-assets/:asset_id/sync-heygen", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), asset_id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const asset = await getProjectBrandAsset(db, project.id, params.data.asset_id);
    if (!asset) return reply.code(404).send({ ok: false, error: "not_found" });
    const storagePath = (asset.storage_path ?? "").trim();
    const url = (asset.public_url ?? "").trim();
    if (!storagePath && !url) {
      return reply.code(400).send({
        ok: false,
        error: "source_required",
        message: "Set storage_path (preferred) or public_url on the asset before syncing to HeyGen.",
      });
    }
    const appConfig = loadConfig();
    const bucket = appConfig.SUPABASE_ASSETS_BUCKET || "assets";
    /**
     * Prefer storage_path download via the service-role client — works even when the Supabase
     * bucket is private (the public /object/public/... URL returns 400 in that case, which is
     * what triggered the previous sync failure).
     */
    try {
      const up = storagePath
        ? await fetchStoragePathAndUploadToHeygen(appConfig, bucket, storagePath, asset.label)
        : await fetchUrlAndUploadToHeygen(appConfig, url);
      const row = await updateProjectBrandAsset(db, project.id, asset.id, {
        heygen_asset_id: up.asset_id,
        heygen_synced_at: new Date().toISOString(),
      });
      return { ok: true, brand_asset: row, heygen: { asset_id: up.asset_id } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).send({ ok: false, error: "heygen_sync_failed", message: msg.slice(0, 800) });
    }
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

  // ── HeyGen Defaults (convenience) ─────────────────────────────────────
  const heygenDefaultsSchema = z
    .object({
      /** HeyGen voice id for TTS (same value as heygen_config `voice`). */
      voice_id: z.string().nullish(),
      /** Single avatar id (same value as heygen_config `avatar_id`). */
      avatar_id: z.string().nullish(),
      /** JSON array of { avatar_id, voice_id? } (same value as heygen_config `avatar_pool_json`). */
      avatar_pool_json: z.string().nullish(),
      /** Allow clients to target a project besides the path param; path still wins when provided. */
      project_slug: z.string().optional(),
    })
    .strict();

  function parseAvatarPoolJson(raw: string): { normalized: string; count: number } {
    const t = raw.trim();
    if (!t) return { normalized: "[]", count: 0 };
    let parsed: unknown;
    try {
      parsed = JSON.parse(t) as unknown;
    } catch {
      throw new Error("avatar_pool_json must be valid JSON");
    }
    if (!Array.isArray(parsed)) throw new Error("avatar_pool_json must be a JSON array");
    const out: Array<{ avatar_id: string; voice_id?: string }> = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object" || Array.isArray(x)) continue;
      const o = x as Record<string, unknown>;
      const aid = String(o.avatar_id ?? o.avatarId ?? "").trim();
      const vid = String(o.voice_id ?? o.voiceId ?? "").trim();
      if (!aid) continue;
      out.push(vid ? { avatar_id: aid, voice_id: vid } : { avatar_id: aid });
    }
    return { normalized: JSON.stringify(out), count: out.length };
  }

  /**
   * Convenience endpoint for the common case: set a project-level default voice and avatar (id or pool)
   * without manually editing multiple `heygen_config` rows in the admin UI.
   *
   * Storage: still uses `caf_core.heygen_config` so runtime merge logic is unchanged.
   */
  app.put("/v1/projects/:project_slug/heygen-defaults", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = heygenDefaultsSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request", details: body.success ? undefined : body.error.flatten() });
    }

    const project = await ensureProject(db, params.data.project_slug);

    const voiceId = typeof body.data.voice_id === "string" ? body.data.voice_id.trim() : "";
    const avatarId = typeof body.data.avatar_id === "string" ? body.data.avatar_id.trim() : "";
    const avatarPoolRaw = typeof body.data.avatar_pool_json === "string" ? body.data.avatar_pool_json.trim() : "";

    let avatarPoolNormalized: string | null = null;
    let poolCount = 0;
    if (avatarPoolRaw) {
      try {
        const parsed = parseAvatarPoolJson(avatarPoolRaw);
        avatarPoolNormalized = parsed.normalized;
        poolCount = parsed.count;
        if (poolCount === 0) {
          return reply.code(400).send({ ok: false, error: "avatar_pool_empty", message: "avatar_pool_json parsed but contained no valid avatar_id entries" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(400).send({ ok: false, error: "avatar_pool_invalid", message: msg.slice(0, 300) });
      }
    }

    // Voice: write a single broad-scope row (platform/flow/render_mode null).
    if (voiceId) {
      await upsertHeygenConfig(db, project.id, {
        config_id: "defaults_voice",
        platform: null,
        flow_type: null,
        config_key: "voice",
        value: voiceId,
        render_mode: null,
        value_type: "string",
        is_active: true,
        notes: "Project-level default voice (managed by heygen-defaults endpoint)",
      });
    }

    // Avatar defaults: prefer pool when present.
    if (avatarPoolNormalized) {
      await upsertHeygenConfig(db, project.id, {
        config_id: "defaults_avatar_pool",
        platform: null,
        flow_type: null,
        config_key: "avatar_pool_json",
        value: avatarPoolNormalized,
        render_mode: null,
        value_type: "string",
        is_active: true,
        notes: "Project-level default avatar pool (managed by heygen-defaults endpoint)",
      });
      // Disable single-avatar default so pools win deterministically.
      await upsertHeygenConfig(db, project.id, {
        config_id: "defaults_avatar_id",
        platform: null,
        flow_type: null,
        config_key: "avatar_id",
        value: null,
        render_mode: null,
        value_type: "string",
        is_active: false,
        notes: "Disabled because defaults_avatar_pool is active",
      });
    } else if (avatarId) {
      await upsertHeygenConfig(db, project.id, {
        config_id: "defaults_avatar_id",
        platform: null,
        flow_type: null,
        config_key: "avatar_id",
        value: avatarId,
        render_mode: null,
        value_type: "string",
        is_active: true,
        notes: "Project-level default avatar id (managed by heygen-defaults endpoint)",
      });
      // Disable pool to avoid stale overrides.
      await upsertHeygenConfig(db, project.id, {
        config_id: "defaults_avatar_pool",
        platform: null,
        flow_type: null,
        config_key: "avatar_pool_json",
        value: null,
        render_mode: null,
        value_type: "string",
        is_active: false,
        notes: "Disabled because defaults_avatar_id is active",
      });
    }

    return {
      ok: true,
      project: { id: project.id, slug: project.slug },
      applied: {
        voice_id: voiceId || null,
        avatar_id: avatarPoolNormalized ? null : avatarId || null,
        avatar_pool_count: avatarPoolNormalized ? poolCount : 0,
      },
    };
  });
}
