/**
 * Learning routes — evidence, rules, analysis, compiled context, CSV performance ingest.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { getProjectBySlug } from "../repositories/core.js";
import {
  applyLearningRule,
  listLearningRulesMerged,
  retireLearningRule,
} from "../repositories/learning.js";
import { getGlobalLearningProjectId } from "../repositories/learning-global.js";
import {
  insertHypothesis,
  insertHypothesisTrial,
  insertInsight,
  insertObservation,
  insertPerformanceIngestionBatch,
  listHypotheses,
  listHypothesisTrials,
  listInsights,
  listObservations,
} from "../repositories/learning-evidence.js";
import { analyzeEditorialPatterns } from "../services/editorial-learning.js";
import {
  ingestPerformanceMetrics,
  analyzeMarketPerformance,
  type PerformanceIngestionInput,
} from "../services/market-learning.js";
import { compileLearningContexts } from "../services/learning-context-compiler.js";
import { LEARNING_TRANSPARENCY_STATIC, learningTransparencySnapshot } from "../services/learning-transparency.js";
import { parseCsvToRecords } from "../services/parse-csv-simple.js";
import {
  mapCsvRowToPerformanceInput,
  type CsvPerformanceColumnMap,
} from "../services/csv-performance-ingest.js";
import { runLlmApprovalReviewsForProject } from "../services/approved-content-llm-review.js";
import { listLlmApprovalReviews } from "../repositories/llm-approval-reviews.js";

interface Deps {
  db: Pool;
  config: AppConfig;
}

async function resolveStorageProjectId(
  db: Pool,
  scopeType: "project" | "global",
  pathProjectId: string
): Promise<{ id: string; error?: string }> {
  if (scopeType === "project") return { id: pathProjectId };
  const gid = await getGlobalLearningProjectId(db);
  if (!gid) return { id: pathProjectId, error: "caf-global project not found (run migration 010)" };
  return { id: gid };
}

export function registerLearningRoutes(app: FastifyInstance, { db, config }: Deps) {
  // ── Transparency (automation + LLM involvement) ─────────────────────
  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/transparency",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const snapshot = await learningTransparencySnapshot(db, project.id);
      return {
        ok: true,
        project_slug: project.slug,
        ...LEARNING_TRANSPARENCY_STATIC,
        snapshot,
      };
    }
  );

  // ── Learning rules (merged with global) ───────────────────────────────
  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/rules",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const globalId = await getGlobalLearningProjectId(db);
      const rules = await listLearningRulesMerged(db, project.id, globalId);
      return { ok: true, rules };
    }
  );

  app.post<{ Params: { project_slug: string; rule_id: string } }>(
    "/v1/learning/:project_slug/rules/:rule_id/apply",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const applied = await applyLearningRule(db, project.id, req.params.rule_id);
      if (!applied) return reply.code(404).send({ ok: false, error: "rule not found or already applied" });
      return { ok: true, rule_id: req.params.rule_id, status: "active" };
    }
  );

  app.post<{ Params: { project_slug: string; rule_id: string } }>(
    "/v1/learning/:project_slug/rules/:rule_id/retire",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const ok = await retireLearningRule(db, project.id, req.params.rule_id);
      if (!ok) return reply.code(404).send({ ok: false, error: "rule not found or not active" });
      return { ok: true, rule_id: req.params.rule_id, status: "expired" };
    }
  );

  // ── Compiled learning context (for debugging / review UI) ────────────
  app.get<{
    Params: { project_slug: string };
    Querystring: { flow_type?: string; platform?: string };
  }>("/v1/learning/:project_slug/context-preview", async (req, reply) => {
    const project = await getProjectBySlug(db, req.params.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const compiled = await compileLearningContexts(
      db,
      project.id,
      req.query.flow_type ?? null,
      req.query.platform ?? null
    );
    return { ok: true, ...compiled };
  });

  // ── Observations ──────────────────────────────────────────────────────
  const observationBody = z.object({
    observation_id: z.string(),
    scope_type: z.enum(["project", "global"]),
    source_type: z.string(),
    flow_type: z.string().optional(),
    platform: z.string().optional(),
    observation_type: z.string(),
    entity_ref: z.string().optional(),
    payload_json: z.record(z.unknown()).optional(),
    confidence: z.number().optional(),
    observed_at: z.string().optional(),
  });

  app.post<{ Params: { project_slug: string }; Body: z.infer<typeof observationBody> }>(
    "/v1/learning/:project_slug/observations",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const parsed = observationBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      const storage = await resolveStorageProjectId(db, body.scope_type, project.id);
      if (storage.error) return reply.code(500).send({ ok: false, error: storage.error });
      await insertObservation(db, {
        observation_id: body.observation_id,
        scope_type: body.scope_type,
        project_id: storage.id,
        source_type: body.source_type,
        flow_type: body.flow_type ?? null,
        platform: body.platform ?? null,
        observation_type: body.observation_type,
        entity_ref: body.entity_ref ?? null,
        payload_json: body.payload_json ?? {},
        confidence: body.confidence ?? null,
        observed_at: body.observed_at ?? null,
      });
      return { ok: true };
    }
  );

  app.get<{ Params: { project_slug: string }; Querystring: { source_type?: string; limit?: string } }>(
    "/v1/learning/:project_slug/observations",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
      const rows = await listObservations(db, project.id, {
        limit: Number.isFinite(limit) ? limit : 200,
        source_type: req.query.source_type,
      });
      return { ok: true, observations: rows };
    }
  );

  // ── Hypotheses ────────────────────────────────────────────────────────
  const hypothesisBody = z.object({
    hypothesis_id: z.string(),
    scope_type: z.enum(["project", "global"]),
    title: z.string(),
    statement: z.string(),
    rationale: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().optional(),
    owner: z.string().optional(),
    expires_at: z.string().optional(),
  });

  app.post<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/hypotheses",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const parsed = hypothesisBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      const storage = await resolveStorageProjectId(db, body.scope_type, project.id);
      if (storage.error) return reply.code(500).send({ ok: false, error: storage.error });
      await insertHypothesis(db, {
        hypothesis_id: body.hypothesis_id,
        scope_type: body.scope_type,
        project_id: storage.id,
        title: body.title,
        statement: body.statement,
        rationale: body.rationale ?? null,
        status: body.status,
        priority: body.priority,
        owner: body.owner ?? null,
        expires_at: body.expires_at ?? null,
      });
      return { ok: true };
    }
  );

  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/hypotheses",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const rows = await listHypotheses(db, project.id);
      return { ok: true, hypotheses: rows };
    }
  );

  // ── Hypothesis trials ─────────────────────────────────────────────────
  const trialBody = z.object({
    trial_id: z.string(),
    scope_type: z.enum(["project", "global"]),
    hypothesis_id: z.string().optional(),
    experiment_type: z.string(),
    design_json: z.record(z.unknown()).optional(),
    start_at: z.string().optional(),
    end_at: z.string().optional(),
    status: z.string().optional(),
    success_metric: z.string().optional(),
    result_summary: z.string().optional(),
    result_payload_json: z.record(z.unknown()).optional(),
  });

  app.post<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/hypothesis-trials",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const parsed = trialBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      const storage = await resolveStorageProjectId(db, body.scope_type, project.id);
      if (storage.error) return reply.code(500).send({ ok: false, error: storage.error });
      await insertHypothesisTrial(db, {
        trial_id: body.trial_id,
        hypothesis_id: body.hypothesis_id ?? null,
        scope_type: body.scope_type,
        project_id: storage.id,
        experiment_type: body.experiment_type,
        design_json: body.design_json,
        start_at: body.start_at ?? null,
        end_at: body.end_at ?? null,
        status: body.status,
        success_metric: body.success_metric ?? null,
        result_summary: body.result_summary ?? null,
        result_payload_json: body.result_payload_json,
      });
      return { ok: true };
    }
  );

  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/hypothesis-trials",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const rows = await listHypothesisTrials(db, project.id);
      return { ok: true, trials: rows };
    }
  );

  // ── Insights ───────────────────────────────────────────────────────────
  const insightBody = z.object({
    insight_id: z.string(),
    scope_type: z.enum(["project", "global"]),
    title: z.string(),
    body: z.string(),
    derived_from_observation_ids: z.array(z.string()).optional(),
    confidence: z.number().optional(),
    status: z.string().optional(),
  });

  app.post<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/insights",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const parsed = insightBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }
      const body = parsed.data;
      const storage = await resolveStorageProjectId(db, body.scope_type, project.id);
      if (storage.error) return reply.code(500).send({ ok: false, error: storage.error });
      await insertInsight(db, {
        insight_id: body.insight_id,
        scope_type: body.scope_type,
        project_id: storage.id,
        title: body.title,
        body: body.body,
        derived_from_observation_ids: body.derived_from_observation_ids,
        confidence: body.confidence ?? null,
        status: body.status,
      });
      return { ok: true };
    }
  );

  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/insights",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const rows = await listInsights(db, project.id);
      return { ok: true, insights: rows };
    }
  );

  // ── Editorial analysis (Loop B) ─────────────────────────────────────
  app.post<{ Params: { project_slug: string }; Body: { window_days?: number; auto_create_rules?: boolean } }>(
    "/v1/learning/:project_slug/editorial-analysis",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const windowDays = (body.window_days as number) ?? 30;
      const autoCreate = body.auto_create_rules !== false;
      const persistEngineering = body.persist_engineering_insight !== false;
      const llmNotes =
        typeof body.llm_notes_synthesis === "boolean"
          ? body.llm_notes_synthesis
          : undefined;

      const result = await analyzeEditorialPatterns(
        db,
        config,
        project.id,
        project.slug,
        windowDays,
        autoCreate,
        persistEngineering,
        llmNotes
      );
      return { ok: true, ...result };
    }
  );

  const llmApprovalReviewBody = z.object({
    limit: z.number().int().min(1).max(50).optional(),
    task_ids: z.array(z.string()).optional(),
    skip_if_reviewed_within_days: z.number().int().min(0).max(365).optional(),
    force_rereview: z.boolean().optional(),
    mint_pending_hints_below_score: z.number().min(0).max(1).nullable().optional(),
  });

  // ── LLM review: approved content only (vision + text) ─────────────────
  app.post<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/llm-review-approved",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      if (!config.OPENAI_API_KEY?.trim()) {
        return reply.code(400).send({ ok: false, error: "OPENAI_API_KEY not configured" });
      }
      const parsed = llmApprovalReviewBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }
      const b = parsed.data;
      const { results, model } = await runLlmApprovalReviewsForProject(db, config, project.id, project.slug, {
        limit: b.limit,
        task_ids: b.task_ids,
        skip_if_reviewed_within_days: b.skip_if_reviewed_within_days,
        force_rereview: b.force_rereview,
        mint_pending_hints_below_score: b.mint_pending_hints_below_score ?? null,
      });
      return { ok: true, model, results };
    }
  );

  app.get<{
    Params: { project_slug: string };
    Querystring: { limit?: string };
  }>("/v1/learning/:project_slug/llm-approval-reviews", async (req, reply) => {
    const project = await getProjectBySlug(db, req.params.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const lim = req.query.limit ? parseInt(req.query.limit, 10) : 40;
    const reviews = await listLlmApprovalReviews(db, project.id, Number.isFinite(lim) ? lim : 40);
    return { ok: true, reviews };
  });

  // ── Performance JSON ingest (Loop C input) ─────────────────────────────
  app.post<{ Params: { project_slug: string }; Body: { metrics: PerformanceIngestionInput[]; window?: string } }>(
    "/v1/learning/:project_slug/performance/ingest",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const metrics = (body.metrics as PerformanceIngestionInput[]) ?? [];
      if (!Array.isArray(metrics) || metrics.length === 0) {
        return reply.code(400).send({ ok: false, error: "metrics array required" });
      }

      const metricWindow = (body.window as "early" | "stabilized") ?? "stabilized";
      const result = await ingestPerformanceMetrics(db, project.id, metrics, metricWindow);
      return { ok: true, ...result };
    }
  );

  // ── Performance CSV upload (social exports) ──────────────────────────
  app.post<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/performance/csv",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      let buffer: Buffer | null = null;
      let filename = "upload.csv";
      let mapping: CsvPerformanceColumnMap = {};
      let metricWindow: "early" | "stabilized" = "stabilized";

      if (typeof req.parts !== "function") {
        return reply.code(400).send({ ok: false, error: "multipart form required" });
      }

      for await (const part of req.parts()) {
        if (part.type === "file") {
          filename = part.filename ?? "upload.csv";
          buffer = await part.toBuffer();
        } else if (part.type === "field") {
          if (part.fieldname === "mapping") {
            try {
              mapping = JSON.parse(String(part.value)) as CsvPerformanceColumnMap;
            } catch {
              mapping = {};
            }
          } else if (part.fieldname === "window" && String(part.value) === "early") {
            metricWindow = "early";
          }
        }
      }

      if (!buffer?.length) {
        return reply.code(400).send({ ok: false, error: "missing file field (form field name: file)" });
      }

      const text = buffer.toString("utf8");
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      const rows = parseCsvToRecords(text);
      const metrics: PerformanceIngestionInput[] = [];
      let skipped = 0;
      for (const row of rows) {
        const m = mapCsvRowToPerformanceInput(row, mapping);
        if (m) metrics.push(m);
        else skipped++;
      }

      const batchId = await insertPerformanceIngestionBatch(db, {
        project_id: project.id,
        source_filename: filename,
        file_hash: fileHash,
        row_count: metrics.length,
        mapping_json: mapping as Record<string, unknown>,
      });

      const result = await ingestPerformanceMetrics(db, project.id, metrics, metricWindow, batchId);

      const obsId = `csv_${batchId.replace(/-/g, "")}`;
      await insertObservation(db, {
        observation_id: obsId.length > 120 ? obsId.slice(0, 120) : obsId,
        scope_type: "project",
        project_id: project.id,
        source_type: "performance",
        flow_type: null,
        platform: null,
        observation_type: "social_metrics_csv_ingest",
        entity_ref: batchId,
        payload_json: {
          filename,
          file_hash: fileHash,
          csv_rows: rows.length,
          ingested: result.ingested,
          skipped,
          errors: result.errors.slice(0, 30),
        },
        confidence: 1,
        observed_at: new Date().toISOString(),
      }).catch(() => {});

      return {
        ok: true,
        batch_id: batchId,
        csv_rows: rows.length,
        skipped,
        ...result,
      };
    }
  );

  // ── Market performance analysis (Loop C) ─────────────────────────────
  app.post<{ Params: { project_slug: string }; Body: { window_days?: number; auto_create_rules?: boolean } }>(
    "/v1/learning/:project_slug/market-analysis",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const windowDays = (body.window_days as number) ?? 60;
      const autoCreate = body.auto_create_rules !== false;

      const result = await analyzeMarketPerformance(db, project.id, project.slug, windowDays, autoCreate);
      return { ok: true, ...result };
    }
  );
}
