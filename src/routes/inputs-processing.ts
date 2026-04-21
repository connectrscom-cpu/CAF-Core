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
  defaultCriteriaJson,
  getInputsProcessingProfile,
  upsertInputsProcessingProfile,
} from "../repositories/inputs-processing-profile.js";
import { computeInputHealth, persistImportHealth } from "../services/input-health.js";
import { buildSignalPackFromEvidenceImport } from "../services/inputs-to-signal-pack.js";
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

  const putProfileSchema = z.object({
    criteria_json: z.record(z.unknown()).optional(),
    rating_model: z.string().max(80).optional(),
    synth_model: z.string().max(80).optional(),
    max_rows_for_rating: z.number().int().min(1).max(5000).optional(),
    max_rows_per_llm_batch: z.number().int().min(1).max(80).optional(),
    max_ideas_in_signal_pack: z.number().int().min(1).max(200).optional(),
    min_llm_score_for_pack: z.number().min(0).max(1).optional(),
    extra_instructions: z.string().max(8000).nullable().optional(),
  });

  app.put("/v1/inputs-processing/:project_slug/profile", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = putProfileSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body" });
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
