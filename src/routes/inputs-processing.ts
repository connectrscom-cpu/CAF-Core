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
import { getImportEvidenceStats, getInputsEvidenceImport } from "../repositories/inputs-evidence.js";
import {
  countEvidenceRowInsightsByImportTier,
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
import { runBroadInsightsForImport } from "../services/inputs-broad-llm-insights.js";
import { runDeepImageInsightsForImport } from "../services/inputs-deep-image-insights.js";
import { runDeepVideoInsightsForImport } from "../services/inputs-deep-video-insights.js";
import { runDeepCarouselInsightsForImport } from "../services/inputs-deep-carousel-insights.js";
import { getRtpSummaryForProject } from "../services/rtp-metrics.js";

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
      query.data.offset
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
    const broad = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "broad_llm");
    const deep = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_deep");
    const video = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_video");
    const carousel = await countEvidenceRowInsightsByImportTier(db, params.data.import_id, "top_performer_carousel");
    return {
      ok: true,
      counts: {
        broad_llm: broad,
        top_performer_deep: deep,
        top_performer_video: video,
        top_performer_carousel: carousel,
      },
      insights: rows,
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
      })
      .safeParse(request.body ?? {});
    if (!params.success || !UUID_RE.test(params.data.import_id) || !body.success) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    try {
      const result = await runBroadInsightsForImport(db, config, params.data.project_slug, params.data.import_id, {
        evidence_kind: body.data.evidence_kind ?? null,
        max_rows: body.data.max_rows,
        rescan: body.data.rescan,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "broad_insights_failed", message: msg });
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
    try {
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
