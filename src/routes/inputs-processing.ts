import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import { listApiCallAuditsForInputsPipeline } from "../repositories/api-call-audit.js";
import { listInsightsPacks } from "../repositories/insights-packs.js";
import {
  deleteQcFlowProfile,
  listQcFlowProfiles,
  upsertQcFlowProfile,
} from "../repositories/qc-flow-profiles.js";
import {
  getImportEvidenceStats,
  getInputsEvidenceImport,
  listEvidenceRowsByIds,
} from "../repositories/inputs-evidence.js";
import {
  countEvidenceRowInsightsByImportTier,
  countEvidenceRowInsightsByImportTierAndKind,
  listEvidenceRowInsightsEnriched,
} from "../repositories/inputs-evidence-insights.js";
import {
  defaultCriteriaJson,
  getInputsProcessingProfile,
  upsertInputsProcessingProfile,
} from "../repositories/inputs-processing-profile.js";
import { computeInputHealth, persistImportHealth } from "../services/input-health.js";
import { buildSignalPackFromEvidenceImport } from "../services/inputs-to-signal-pack.js";
import { getPreLlmEvidencePreview } from "../services/inputs-pre-llm-preview.js";
import {
  estimateBroadInsightsForImport,
  previewBroadInsightsPrompt,
  runBroadInsightsForImport,
} from "../services/inputs-broad-llm-insights.js";
import { runDeepImageInsightsForImport } from "../services/inputs-deep-image-insights.js";
import { runDeepVideoInsightsForImport } from "../services/inputs-deep-video-insights.js";
import { runDeepCarouselInsightsForImport } from "../services/inputs-deep-carousel-insights.js";
import { getRtpSummaryForProject } from "../services/rtp-metrics.js";
import {
  bulkInsertInputsIdeas,
  getInputsIdeaListById,
  insertInputsIdeaList,
  listInputsIdeaListsForImport,
  listInputsIdeasForList,
} from "../repositories/inputs-idea-lists.js";
import { synthesizeIdeasJsonFromInsightsLlm } from "../services/ideas-from-insights-llm.js";
import { buildSignalPackFromIdeaList } from "../services/idea-list-to-signal-pack.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerInputsProcessingRoutes(app: FastifyInstance, deps: { db: Pool; config: AppConfig }) {
  const { db, config } = deps;

  app.get("/v1/inputs-processing/:project_slug/profile", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    let row = await getInputsProcessingProfile(db, project.id);
    if (!row) {
      row = await upsertInputsProcessingProfile(db, project.id, { criteria_json: defaultCriteriaJson() });
    }
    return { ok: true, profile: row, criteria_help: defaultCriteriaJson() };
  });

  const putProfileSchema = z
    .object({
      criteria_json: z.record(z.unknown()).optional(),
      rating_model: z.string().max(80).optional(),
      synth_model: z.string().max(80).optional(),
      max_rows_for_rating: z.number().int().min(1).max(5000).optional(),
      max_rows_per_llm_batch: z.number().int().min(1).max(80).optional(),
      max_ideas_in_signal_pack: z.number().int().min(1).max(200).optional(),
      max_insights_for_ideas_llm: z.number().int().min(20).max(2000).optional(),
      min_top_performer_insights_for_ideas_llm: z.number().int().min(0).max(500).optional(),
      min_llm_score_for_pack: z.number().min(0).max(1).optional(),
      extra_instructions: z.string().max(8000).nullable().optional(),
    })
    .superRefine((b, ctx) => {
      const cap = b.max_insights_for_ideas_llm;
      const minTp = b.min_top_performer_insights_for_ideas_llm;
      if (cap != null && minTp != null && minTp > cap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "min_top_performer_insights_for_ideas_llm must be <= max_insights_for_ideas_llm",
          path: ["min_top_performer_insights_for_ideas_llm"],
        });
      }
    });

  app.put("/v1/inputs-processing/:project_slug/profile", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = putProfileSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_body",
        details: {
          ...(params.success ? {} : { params: params.error.flatten() }),
          ...(body.success ? {} : { body: body.error.flatten() }),
        },
      });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const row = await upsertInputsProcessingProfile(db, project.id, body.data);
    return { ok: true, profile: row };
  });

  app.get("/v1/inputs-processing/:project_slug/import/:import_id/stats", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({ recompute_health: z.string().optional() })
      .safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.import_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    let imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });
    if (String(query.data.recompute_health ?? "") === "1") {
      const h = await computeInputHealth(
        db,
        project.id,
        params.data.import_id,
        (imp.sheet_stats_json ?? {}) as Record<string, unknown>
      );
      await persistImportHealth(db, project.id, params.data.import_id, h);
      imp = (await getInputsEvidenceImport(db, project.id, params.data.import_id))!;
    }
    const stats = await getImportEvidenceStats(db, project.id, params.data.import_id);
    return { ok: true, import: imp, stats };
  });

  /**
   * GET /v1/inputs-processing/:project_slug/import/:import_id/pre-llm-evidence
   * Preview rows for one evidence_kind after pre-LLM gates + adjustable score cutoff (no LLM).
   */
  app.get("/v1/inputs-processing/:project_slug/import/:import_id/pre-llm-evidence", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({
        evidence_kind: z.string().min(1).max(80),
        min_score: z.coerce.number().min(0).max(1).default(0),
        include_below_cutoff: z
          .enum(["1", "0", "true", "false"])
          .optional()
          .transform((v) => v === "1" || v === "true"),
        sort: z.enum(["score_desc", "score_asc"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.import_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });
    let profile = await getInputsProcessingProfile(db, project.id);
    if (!profile) {
      profile = await upsertInputsProcessingProfile(db, project.id, { criteria_json: defaultCriteriaJson() });
    }
    const criteria = (profile.criteria_json ?? {}) as Record<string, unknown>;
    const preview = await getPreLlmEvidencePreview(
      db,
      project.id,
      params.data.import_id,
      query.data.evidence_kind,
      criteria,
      query.data.min_score,
      query.data.limit,
      query.data.offset,
      {
        include_below_cutoff: query.data.include_below_cutoff ?? false,
        sort: query.data.sort,
      }
    );
    return { ok: true, ...preview };
  });

  app.get("/v1/inputs-processing/:project_slug/import/:import_id/evidence-insights", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({
        tier: z
          .enum(["broad_llm", "top_performer_deep", "top_performer_video", "top_performer_carousel"])
          .optional(),
        evidence_kind: z.string().min(1).max(80).optional(),
        sort: z
          .enum(["updated_desc", "rating_desc", "pre_llm_desc"])
          .optional()
          .default("updated_desc"),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.import_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });
    const tier = query.data.tier ?? null;
    const evidenceKind = query.data.evidence_kind?.trim() || null;
    const rows = await listEvidenceRowInsightsEnriched(db, project.id, params.data.import_id, {
      tier,
      evidence_kind: evidenceKind,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const sort = query.data.sort;
    if (sort === "rating_desc") {
      rows.sort((a, b) => (parseFloat(b.evidence_rating_score ?? "0") || 0) - (parseFloat(a.evidence_rating_score ?? "0") || 0));
    } else if (sort === "pre_llm_desc") {
      rows.sort((a, b) => (parseFloat(b.pre_llm_score ?? "0") || 0) - (parseFloat(a.pre_llm_score ?? "0") || 0));
    } else {
      // updated_desc already from SQL order for most branches; keep stable fallback
      rows.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    }
    const broadAll = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "broad_llm");
    const deepAll = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_deep");
    const videoAll = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_video");
    const carouselAll = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_carousel");
    const countsImport = {
      broad_llm: broadAll,
      top_performer_deep: deepAll,
      top_performer_video: videoAll,
      top_performer_carousel: carouselAll,
    };
    // When the client filters by evidence_kind, tier totals must match that filter (otherwise UI shows "6" for IG while the table is empty).
    let counts = countsImport;
    if (evidenceKind) {
      counts = {
        broad_llm: await countEvidenceRowInsightsByImportTierAndKind(
          db,
          project.id,
          params.data.import_id,
          "broad_llm",
          evidenceKind
        ),
        top_performer_deep: await countEvidenceRowInsightsByImportTierAndKind(
          db,
          project.id,
          params.data.import_id,
          "top_performer_deep",
          evidenceKind
        ),
        top_performer_video: await countEvidenceRowInsightsByImportTierAndKind(
          db,
          project.id,
          params.data.import_id,
          "top_performer_video",
          evidenceKind
        ),
        top_performer_carousel: await countEvidenceRowInsightsByImportTierAndKind(
          db,
          project.id,
          params.data.import_id,
          "top_performer_carousel",
          evidenceKind
        ),
      };
    }
    return {
      ok: true,
      evidence_kind: evidenceKind,
      sort,
      counts,
      counts_import: countsImport,
      insights: rows,
    };
  });

  // ── Idea lists (build ideas separately from building a signal pack) ─────────

  app.get("/v1/inputs-processing/:project_slug/import/:import_id/idea-lists", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.import_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });
    const lists = await listInputsIdeaListsForImport(db, project.id, params.data.import_id, query.data.limit, query.data.offset);
    return { ok: true, idea_lists: lists };
  });

  app.get("/v1/inputs-processing/:project_slug/idea-lists/:idea_list_id/ideas", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), idea_list_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const list = await getInputsIdeaListById(db, params.data.idea_list_id);
    if (!list) return reply.code(404).send({ ok: false, error: "not_found" });
    if (list.project_id !== project.id) return reply.code(403).send({ ok: false, error: "wrong_project" });
    const ideas = await listInputsIdeasForList(db, project.id, params.data.idea_list_id, query.data.limit, query.data.offset);
    return { ok: true, idea_list: list, ideas };
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/build-ideas-list", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        title: z.string().max(200).optional(),
        model: z.string().max(80).optional(),
        target_idea_count: z.number().int().min(1).max(200).optional(),
        context_insight_cap: z.number().int().min(20).max(2000).optional(),
        min_top_performer_in_context: z.number().int().min(0).max(2000).optional(),
        extra_instructions: z.string().max(8000).optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const imp = await getInputsEvidenceImport(db, project.id, params.data.import_id);
    if (!imp) return reply.code(404).send({ ok: false, error: "not_found" });

    let profile = await getInputsProcessingProfile(db, project.id);
    if (!profile) {
      profile = await upsertInputsProcessingProfile(db, project.id, { criteria_json: defaultCriteriaJson() });
    }

    const synthModel = body.data.model ?? profile.synth_model ?? "gpt-4o-mini";
    const targetIdeaCount = body.data.target_idea_count ?? profile.max_ideas_in_signal_pack ?? 35;
    const contextInsightCap = body.data.context_insight_cap ?? Number(profile.max_insights_for_ideas_llm ?? 200);
    const minTop = body.data.min_top_performer_in_context ?? Number(profile.min_top_performer_insights_for_ideas_llm ?? 20);
    const extra = body.data.extra_instructions ?? profile.extra_instructions ?? "";

    const result = await synthesizeIdeasJsonFromInsightsLlm(db, config, project.id, {
      importId: params.data.import_id,
      packRunId: `IDEAS_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`,
      targetIdeaCount,
      contextInsightCap,
      minTopPerformerInContext: minTop,
      model: synthModel,
      extraInstructions: extra,
    });

    const listRow = await insertInputsIdeaList(db, {
      project_id: project.id,
      inputs_import_id: params.data.import_id,
      title: body.data.title ?? `Ideas for import ${params.data.import_id.slice(0, 8)}`,
      params_json: {
        model: synthModel,
        target_idea_count: targetIdeaCount,
        context_insight_cap: contextInsightCap,
        min_top_performer_in_context: minTop,
        extra_instructions: extra ? "[set]" : "",
      },
      derived_globals_json: {
        context_insights_used: result.context_insights_used,
        top_performer_rows_in_context: result.top_performer_rows_in_context,
      },
    });

    const inserted = await bulkInsertInputsIdeas(db, {
      project_id: project.id,
      idea_list_id: listRow.id,
      ideas: result.ideas.map((i) => ({
        idea_id: String(i.idea_id ?? "").trim() || String(i.content_idea ?? "").slice(0, 40),
        platform: i.platform ?? null,
        confidence_score: i.confidence_score ?? null,
        idea_json: i as unknown as Record<string, unknown>,
      })),
    });

    return {
      ok: true,
      idea_list_id: listRow.id,
      ideas_count: result.ideas.length,
      inserted_rows: inserted,
      context_insights_used: result.context_insights_used,
      top_performer_rows_in_context: result.top_performer_rows_in_context,
    };
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/run-broad-insights", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        evidence_kind: z.string().max(80).nullable().optional(),
        max_rows: z.number().int().min(1).max(5000).optional(),
        rescan: z.boolean().optional(),
        min_pre_llm_score: z.number().min(0).max(1).optional(),
        debug: z.boolean().optional(),
        custom_label_1: z.string().max(120).nullable().optional(),
        custom_label_2: z.string().max(120).nullable().optional(),
        custom_label_3: z.string().max(120).nullable().optional(),
        system_prompt: z.string().max(50_000).nullable().optional(),
        user_prompt: z.string().max(50_000).nullable().optional(),
        dry_run: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      if (body.data.dry_run) {
        const est = await estimateBroadInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
          evidence_kind: body.data.evidence_kind ?? null,
          max_rows: body.data.max_rows,
          rescan: body.data.rescan,
          min_pre_llm_score: body.data.min_pre_llm_score,
          custom_label_1: body.data.custom_label_1 ?? null,
          custom_label_2: body.data.custom_label_2 ?? null,
          custom_label_3: body.data.custom_label_3 ?? null,
          system_prompt: body.data.system_prompt ?? null,
          user_prompt: body.data.user_prompt ?? null,
        });
        return { ok: true, dry_run: true, ...est };
      }
      const result = await runBroadInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
        evidence_kind: body.data.evidence_kind ?? null,
        max_rows: body.data.max_rows,
        rescan: body.data.rescan,
        min_pre_llm_score: body.data.min_pre_llm_score,
        debug: body.data.debug,
        custom_label_1: body.data.custom_label_1 ?? null,
        custom_label_2: body.data.custom_label_2 ?? null,
        custom_label_3: body.data.custom_label_3 ?? null,
        system_prompt: body.data.system_prompt ?? null,
        user_prompt: body.data.user_prompt ?? null,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "broad_insights_failed", message: msg });
    }
  });

  app.get(
    "/v1/inputs-processing/:project_slug/import/:import_id/evidence-row/:row_id",
    async (request, reply) => {
      const params = z
        .object({ project_slug: z.string(), import_id: z.string(), row_id: z.string() })
        .safeParse(request.params);
      if (!params.success || !UUID_RE.test(params.data.import_id)) {
        return reply.code(400).send({ ok: false, error: "bad_params" });
      }
      try {
        const project = await ensureProject(db, params.data.project_slug);
        const rows = await listEvidenceRowsByIds(db, project.id, params.data.import_id, [params.data.row_id]);
        const row = rows[0] ?? null;
        if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
        return reply.send({ ok: true, row });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(500).send({ ok: false, error: "server_error", message: msg });
      }
    }
  );

  /**
   * GET /v1/inputs-processing/:project_slug/import/:import_id/broad-insights-prompt
   * Preview the exact system/user prompt (with a sample batch payload) for broad insights.
   */
  app.get("/v1/inputs-processing/:project_slug/import/:import_id/broad-insights-prompt", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const query = z
      .object({
        evidence_kind: z.string().max(80).nullable().optional(),
        custom_label_1: z.string().max(120).nullable().optional(),
        custom_label_2: z.string().max(120).nullable().optional(),
        custom_label_3: z.string().max(120).nullable().optional(),
        system_prompt: z.string().max(50_000).nullable().optional(),
        user_prompt: z.string().max(50_000).nullable().optional(),
      })
      .safeParse(request.query);
    if (!params.success || !UUID_RE.test(params.data.import_id) || !query.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const out = await previewBroadInsightsPrompt(
        db,
        config,
        params.data.project_slug,
        params.data.import_id,
        {
          evidence_kind: query.data.evidence_kind ?? null,
          custom_label_1: query.data.custom_label_1 ?? null,
          custom_label_2: query.data.custom_label_2 ?? null,
          custom_label_3: query.data.custom_label_3 ?? null,
          system_prompt: query.data.system_prompt ?? null,
          user_prompt: query.data.user_prompt ?? null,
        }
      );
      return { ok: true, ...out };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "prompt_preview_failed", message: msg });
    }
  });

  /**
   * POST /v1/inputs-processing/:project_slug/import/:import_id/broad-insights-prompt
   * Same as GET, but avoids huge URL query strings (prompt overrides can exceed header limits).
   */
  app.post("/v1/inputs-processing/:project_slug/import/:import_id/broad-insights-prompt", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        evidence_kind: z.string().max(80).nullable().optional(),
        custom_label_1: z.string().max(120).nullable().optional(),
        custom_label_2: z.string().max(120).nullable().optional(),
        custom_label_3: z.string().max(120).nullable().optional(),
        system_prompt: z.string().max(50_000).nullable().optional(),
        user_prompt: z.string().max(50_000).nullable().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const out = await previewBroadInsightsPrompt(
        db,
        config,
        params.data.project_slug,
        params.data.import_id,
        {
          evidence_kind: body.data.evidence_kind ?? null,
          custom_label_1: body.data.custom_label_1 ?? null,
          custom_label_2: body.data.custom_label_2 ?? null,
          custom_label_3: body.data.custom_label_3 ?? null,
          system_prompt: body.data.system_prompt ?? null,
          user_prompt: body.data.user_prompt ?? null,
        }
      );
      return { ok: true, ...out };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "prompt_preview_failed", message: msg });
    }
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/run-deep-image-insights", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        max_rows: z.number().int().min(1).max(80).optional(),
        min_pre_llm_score: z.number().min(0).max(1).optional(),
        rescan: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const result = await runDeepImageInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
        max_rows: body.data.max_rows,
        min_pre_llm_score: body.data.min_pre_llm_score,
        rescan: body.data.rescan,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "deep_image_insights_failed", message: msg });
    }
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/run-deep-video-insights", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        max_rows: z.number().int().min(1).max(80).optional(),
        min_pre_llm_score: z.number().min(0).max(1).optional(),
        max_frames: z.number().int().min(1).max(12).optional(),
        rescan: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const result = await runDeepVideoInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
        max_rows: body.data.max_rows,
        min_pre_llm_score: body.data.min_pre_llm_score,
        max_frames: body.data.max_frames,
        rescan: body.data.rescan,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "deep_video_insights_failed", message: msg });
    }
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/run-deep-carousel-insights", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    const body = z
      .object({
        max_rows: z.number().int().min(1).max(40).optional(),
        min_pre_llm_score: z.number().min(0).max(1).optional(),
        max_slides: z.number().int().min(2).max(12).optional(),
        rescan: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const result = await runDeepCarouselInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
        max_rows: body.data.max_rows,
        min_pre_llm_score: body.data.min_pre_llm_score,
        max_slides: body.data.max_slides,
        rescan: body.data.rescan,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "deep_carousel_insights_failed", message: msg });
    }
  });

  app.get("/v1/inputs-processing/:project_slug/insights-packs", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).default(0) })
      .safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const packs = await listInsightsPacks(db, project.id, query.data.limit, query.data.offset);
    return { ok: true, insights_packs: packs };
  });

  app.get("/v1/inputs-processing/:project_slug/rtp-summary", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = z.object({ window_days: z.coerce.number().int().min(1).max(730).default(90) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const summary = await getRtpSummaryForProject(db, project.id, query.data.window_days);
    return { ok: true, ...summary };
  });

  app.get("/v1/inputs-processing/:project_slug/qc-flow-profiles", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listQcFlowProfiles(db, project.id);
    return { ok: true, profiles: rows };
  });

  app.put("/v1/inputs-processing/:project_slug/qc-flow-profiles/:flow_type", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), flow_type: z.string() })
      .safeParse(request.params);
    const body = z.object({ profile_json: z.record(z.unknown()) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "invalid_body" });
    const project = await ensureProject(db, params.data.project_slug);
    await upsertQcFlowProfile(db, project.id, params.data.flow_type, body.data.profile_json);
    return { ok: true };
  });

  app.delete("/v1/inputs-processing/:project_slug/qc-flow-profiles/:flow_type", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), flow_type: z.string() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    await deleteQcFlowProfile(db, project.id, params.data.flow_type);
    return { ok: true, deleted: true };
  });

  app.get("/v1/inputs-processing/:project_slug/audit", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listApiCallAuditsForInputsPipeline(db, project.id, query.data.limit);
    return { ok: true, audits: rows };
  });

  app.post("/v1/inputs-processing/:project_slug/import/:import_id/build-signal-pack", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), import_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !UUID_RE.test(params.data.import_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const body = z
      .object({
        /** If set, build a pack from this stored idea list (separate step from idea generation). */
        idea_list_id: z.string().uuid().optional(),
        run_name: z.string().max(200).optional(),
        notes: z.string().max(4000).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });
    try {
      if (body.data.idea_list_id) {
        const out = await buildSignalPackFromIdeaList(db, config, params.data.project_slug, body.data.idea_list_id, {
          run_name: body.data.run_name ?? null,
          notes: body.data.notes ?? null,
        });
        return { ok: true, mode: "from_idea_list", ...out };
      }
      const result = await buildSignalPackFromEvidenceImport(
        db,
        config,
        params.data.project_slug,
        params.data.import_id
      );
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "build_failed", message: msg });
    }
  });
}
