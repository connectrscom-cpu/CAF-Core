/**
 * Learning routes — editorial analysis, market performance, and learning rules.
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { getProjectBySlug } from "../repositories/core.js";
import { listLearningRules, applyLearningRule } from "../repositories/learning.js";
import { analyzeEditorialPatterns } from "../services/editorial-learning.js";
import { ingestPerformanceMetrics, analyzeMarketPerformance, type PerformanceIngestionInput } from "../services/market-learning.js";

interface Deps { db: Pool; config: AppConfig }

export function registerLearningRoutes(app: FastifyInstance, { db }: Deps) {

  // ── Learning rules ────────────────────────────────────────────────────
  app.get<{ Params: { project_slug: string } }>(
    "/v1/learning/:project_slug/rules",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const rules = await listLearningRules(db, project.id);
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

  // ── Editorial analysis (Loop B) ──────────────────────────────────────
  app.post<{ Params: { project_slug: string }; Body: { window_days?: number; auto_create_rules?: boolean } }>(
    "/v1/learning/:project_slug/editorial-analysis",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const windowDays = (body.window_days as number) ?? 30;
      const autoCreate = body.auto_create_rules !== false;

      const result = await analyzeEditorialPatterns(db, project.id, project.slug, windowDays, autoCreate);
      return { ok: true, ...result };
    }
  );

  // ── Performance ingestion (Loop C input) ─────────────────────────────
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
