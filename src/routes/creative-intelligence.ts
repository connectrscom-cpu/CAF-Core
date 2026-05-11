import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  listCreativeSourceAssets,
  listCreativeVisualAnalyses,
  listCreativeInsights,
  getCreativeInsight,
  applyCarouselTemplateToContentJob,
} from "../repositories/creative-intelligence.js";
import { getSignalPackById } from "../repositories/signal-packs.js";
import { ingestTopPerformers } from "../services/creative-intelligence-ingest.js";
import { mergeCreativeStylingIntoSignalPack } from "../services/creative-intelligence-signal-pack.js";
import { generateAggregatedCreativeInsights } from "../services/creative-intelligence-aggregate.js";
import { generateMimicCarouselTemplate } from "../services/creative-intelligence-mimic-template.js";

const metricsSchema = z.record(z.unknown()).optional();

const ingestItemSchema = z.object({
  source_url: z.string().url().optional(),
  external_source_id: z.string().optional(),
  media_type: z.string().min(1),
  media_urls: z.array(z.string().url()).optional(),
  thumbnail_url: z.string().url().optional(),
  video_url: z.string().url().optional(),
  caption: z.string().optional(),
  metrics: metricsSchema,
  metadata: z.record(z.unknown()).optional(),
});

const ingestBodySchema = z.object({
  platform: z.string().min(1),
  items: z.array(ingestItemSchema).min(1).max(80),
  selection_reason: z.string().optional(),
});

export function registerCreativeIntelligenceRoutes(
  app: FastifyInstance,
  deps: { db: Pool; config: AppConfig }
) {
  const { db, config } = deps;

  app.post("/v1/creative-intelligence/:project_slug/top-performers/ingest", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = ingestBodySchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });
    }
    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await ingestTopPerformers(db, config, project.id, project.slug, body.data);
      return { ok: true, ...result };
    } catch (e) {
      request.log.warn({ err: e }, "creative_intel_ingest");
      return reply.code(500).send({
        ok: false,
        error: "ingest_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/v1/creative-intelligence/:project_slug/assets", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const qry = z.object({ limit: z.coerce.number().optional(), source_group_id: z.string().uuid().optional() }).safeParse(request.query);
    if (!params.success || !qry.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listCreativeSourceAssets(db, project.id, {
      limit: qry.data.limit,
      source_group_id: qry.data.source_group_id,
    });
    return { ok: true, assets: rows, count: rows.length };
  });

  app.get("/v1/creative-intelligence/:project_slug/analyses", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const qry = z
      .object({ limit: z.coerce.number().optional(), status: z.enum(["pending", "completed", "failed"]).optional() })
      .safeParse(request.query);
    if (!params.success || !qry.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listCreativeVisualAnalyses(db, project.id, {
      limit: qry.data.limit,
      status: qry.data.status ?? null,
    });
    return { ok: true, analyses: rows, count: rows.length };
  });

  app.get("/v1/creative-intelligence/:project_slug/insights", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const qry = z
      .object({ limit: z.coerce.number().optional(), status: z.string().optional() })
      .safeParse(request.query);
    if (!params.success || !qry.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listCreativeInsights(db, project.id, {
      limit: qry.data.limit,
      status: qry.data.status ?? undefined,
    });
    return { ok: true, insights: rows, count: rows.length };
  });

  app.get("/v1/creative-intelligence/:project_slug/insights/:id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getCreativeInsight(db, project.id, params.data.id);
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, insight: row };
  });

  app.post("/v1/creative-intelligence/:project_slug/insights/generate", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        limit_analyses: z.coerce.number().int().min(1).max(60).optional(),
        platform: z.string().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    try {
      const out = await generateAggregatedCreativeInsights(db, config, project.id, {
        limit_analyses: body.data.limit_analyses,
        platform: body.data.platform ?? null,
      });
      return { ok: true, ...out };
    } catch (e) {
      request.log.warn({ err: e }, "creative_intel_aggregate");
      return reply.code(500).send({
        ok: false,
        error: "aggregate_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/v1/creative-intelligence/:project_slug/signal-packs/:signal_pack_id/styling", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), signal_pack_id: z.string().uuid() })
      .safeParse(request.params);
    const body = z.object({ max_insights: z.coerce.number().optional() }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, params.data.signal_pack_id);
    if (!pack || pack.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "signal_pack_not_found" });
    }
    const out = await mergeCreativeStylingIntoSignalPack(db, project.id, pack.id, {
      max_insights: body.data.max_insights,
    });
    return { ok: true, ...out };
  });

  app.post("/v1/creative-intelligence/:project_slug/mimic-carousel-template", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = z
      .object({
        creative_insight_id: z.string().uuid().optional(),
        insight_ref: z.string().min(3).optional(),
        template_base_name: z.string().optional(),
      })
      .safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    if (!body.data.creative_insight_id && !body.data.insight_ref) {
      return reply.code(400).send({ ok: false, error: "need_insight_id_or_ref" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    try {
      const out = await generateMimicCarouselTemplate(db, config, project.id, {
        creative_insight_id: body.data.creative_insight_id,
        insight_ref: body.data.insight_ref,
        template_base_name: body.data.template_base_name,
      });
      return { ok: true, ...out };
    } catch (e) {
      request.log.warn({ err: e }, "creative_intel_mimic");
      return reply.code(500).send({
        ok: false,
        error: "mimic_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/v1/creative-intelligence/:project_slug/jobs/:task_id/apply-template", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), task_id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ template_base_name: z.string().min(1) }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const ok = await applyCarouselTemplateToContentJob(
      db,
      project.id,
      params.data.task_id,
      body.data.template_base_name
    );
    if (!ok) return reply.code(404).send({ ok: false, error: "job_not_found" });
    return { ok: true, applied: body.data.template_base_name };
  });
}
