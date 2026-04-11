/**
 * Pipeline routes — generation, QC, and diagnostic endpoints for content_jobs.
 *
 * These expose the new services (LLM generation, QC runtime, diagnostic audits)
 * as HTTP endpoints that can be triggered by the admin UI, n8n, or the run process route.
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { generateForJob } from "../services/llm-generator.js";
import { runQcForJob } from "../services/qc-runtime.js";
import { runDiagnosticAudit } from "../services/diagnostic-runner.js";
import { processContentJobById, reprocessJobFromScratch } from "../services/job-pipeline.js";
import { executeRework } from "../services/rework-orchestrator.js";
import { q, qOne } from "../db/queries.js";
import { getProjectBySlug } from "../repositories/core.js";
import { insertJobStateTransition } from "../repositories/transitions.js";

interface Deps { db: Pool; config: AppConfig }

export function registerPipelineRoutes(app: FastifyInstance, { db, config }: Deps) {

  /**
   * POST /v1/pipeline/:project_slug/:task_id/generate
   * Trigger LLM generation for a single job.
   */
  app.post<{ Params: { project_slug: string; task_id: string }; Body: { model?: string } }>(
    "/v1/pipeline/:project_slug/:task_id/generate",
    async (req, reply) => {
      const apiKey = config.OPENAI_API_KEY;
      if (!apiKey) return reply.code(500).send({ ok: false, error: "OPENAI_API_KEY not configured" });

      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const job = await qOne<{ id: string; task_id: string; status: string }>(db,
        `SELECT id, task_id, status FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
        [project.id, req.params.task_id]);
      if (!job) return reply.code(404).send({ ok: false, error: "job not found" });

      const model = (req.body as Record<string, unknown>)?.model as string ?? config.OPENAI_MODEL;
      const result = await generateForJob(db, job.id, apiKey, model, {
        skipOutputSchemaValidation: config.CAF_SKIP_OUTPUT_SCHEMA_VALIDATION,
      });

      if (result.success) {
        await db.query(`UPDATE caf_core.content_jobs SET status = 'GENERATED', updated_at = now() WHERE id = $1`, [job.id]);
        await insertJobStateTransition(db, {
          task_id: job.task_id,
          project_id: project.id,
          from_state: job.status,
          to_state: "GENERATED",
          triggered_by: "system",
          actor: "llm-generator",
        });
      }

      return { ok: result.success, ...result };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/:task_id/qc
   * Run QC checks and risk policies on a job's generated output.
   */
  app.post<{ Params: { project_slug: string; task_id: string } }>(
    "/v1/pipeline/:project_slug/:task_id/qc",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const job = await qOne<{ id: string }>(db,
        `SELECT id FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
        [project.id, req.params.task_id]);
      if (!job) return reply.code(404).send({ ok: false, error: "job not found" });

      const result = await runQcForJob(db, job.id, config.CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC);
      return { ok: true, ...result };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/:task_id/diagnose
   * Run diagnostic audit on a job's generated output.
   */
  app.post<{ Params: { project_slug: string; task_id: string } }>(
    "/v1/pipeline/:project_slug/:task_id/diagnose",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const job = await qOne<{ id: string }>(db,
        `SELECT id FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
        [project.id, req.params.task_id]);
      if (!job) return reply.code(404).send({ ok: false, error: "job not found" });

      const result = await runDiagnosticAudit(db, job.id);
      return { ok: true, ...result };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/:task_id/full
   * Run the full pipeline for one job: generate → QC → diagnose → advance to rendering/review.
   */
  app.post<{ Params: { project_slug: string; task_id: string }; Body: { model?: string; skip_render?: boolean } }>(
    "/v1/pipeline/:project_slug/:task_id/full",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const job = await qOne<{ id: string; task_id: string; status: string; flow_type: string }>(db,
        `SELECT id, task_id, status, flow_type FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
        [project.id, req.params.task_id]);
      if (!job) return reply.code(404).send({ ok: false, error: "job not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const apiKey = config.OPENAI_API_KEY;
      const model = (body.model as string) ?? config.OPENAI_MODEL;

      // Step 1: Generate
      let genResult = null;
      if (apiKey && (job.status === "PLANNED" || job.status === "GENERATING")) {
        genResult = await generateForJob(db, job.id, apiKey, model, {
          skipOutputSchemaValidation: config.CAF_SKIP_OUTPUT_SCHEMA_VALIDATION,
        });
        if (genResult.success) {
          await db.query(`UPDATE caf_core.content_jobs SET status = 'GENERATED', updated_at = now() WHERE id = $1`, [job.id]);
          await insertJobStateTransition(db, {
            task_id: job.task_id, project_id: project.id,
            from_state: job.status, to_state: "GENERATED",
            triggered_by: "system", actor: "pipeline-full",
          });
        } else {
          await db.query(`UPDATE caf_core.content_jobs SET status = 'FAILED', updated_at = now() WHERE id = $1`, [job.id]);
          return { ok: false, stage: "generation", error: genResult.error, generation: genResult };
        }
      }

      // Step 2: QC
      const qcResult = await runQcForJob(db, job.id, config.CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC);

      // Step 3: Diagnostic
      const diagResult = await runDiagnosticAudit(db, job.id);

      // Step 4: Advance status based on QC
      let finalStatus = "IN_REVIEW";
      if (qcResult.recommended_route === "BLOCKED") {
        finalStatus = "BLOCKED";
      } else if (!qcResult.qc_passed) {
        finalStatus = "QC_FAILED";
      }

      await db.query(`UPDATE caf_core.content_jobs SET status = $1, updated_at = now() WHERE id = $2`,
        [finalStatus, job.id]);
      await insertJobStateTransition(db, {
        task_id: job.task_id, project_id: project.id,
        from_state: "GENERATED", to_state: finalStatus,
        triggered_by: "system", actor: "pipeline-full",
        metadata: { qc_passed: qcResult.qc_passed, risk_level: qcResult.risk_level },
      });

      return {
        ok: true,
        task_id: job.task_id,
        final_status: finalStatus,
        generation: genResult,
        qc: qcResult,
        diagnostic: diagResult,
      };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/batch
   * Run full pipeline for all PLANNED jobs in a project (or run_id subset).
   */
  app.post<{ Params: { project_slug: string }; Body: { run_id?: string; model?: string; limit?: number } }>(
    "/v1/pipeline/:project_slug/batch",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const runId = body.run_id as string | undefined;
      const limit = (body.limit as number) ?? 50;

      let jobsQuery = `SELECT id, task_id FROM caf_core.content_jobs
        WHERE project_id = $1 AND status IN ('PLANNED', 'GENERATING')`;
      const params: unknown[] = [project.id];

      if (runId) {
        jobsQuery += ` AND run_id = $2`;
        params.push(runId);
      }
      jobsQuery += ` ORDER BY created_at LIMIT ${limit}`;

      const jobs = await q<{ id: string; task_id: string }>(db, jobsQuery, params);

      const results: Array<{ task_id: string; ok: boolean; status?: string; error?: string }> = [];
      const apiKey = config.OPENAI_API_KEY;
      const model = (body.model as string) ?? config.OPENAI_MODEL;

      for (const job of jobs) {
        try {
          if (apiKey) {
            const genResult = await generateForJob(db, job.id, apiKey, model, {
              skipOutputSchemaValidation: config.CAF_SKIP_OUTPUT_SCHEMA_VALIDATION,
            });
            if (!genResult.success) {
              results.push({ task_id: job.task_id, ok: false, error: genResult.error });
              continue;
            }
            await db.query(`UPDATE caf_core.content_jobs SET status = 'GENERATED', updated_at = now() WHERE id = $1`, [job.id]);
          }

          await runQcForJob(db, job.id, config.CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC);
          await runDiagnosticAudit(db, job.id);

          await db.query(`UPDATE caf_core.content_jobs SET status = 'IN_REVIEW', updated_at = now() WHERE id = $1`, [job.id]);
          results.push({ task_id: job.task_id, ok: true, status: "IN_REVIEW" });
        } catch (err) {
          results.push({ task_id: job.task_id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return {
        ok: true,
        total: jobs.length,
        processed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/task/:task_id/reprocess
   * Run full job pipeline (LLM → QC → render) for one task.
   * Body: `{ "from_scratch": true }` clears generated output, QC, assets, and diagnostics first so LLM runs again.
   */
  app.post<{
    Params: { project_slug: string; task_id: string };
    Body: { from_scratch?: boolean };
  }>(
    "/v1/pipeline/:project_slug/task/:task_id/reprocess",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const job = await qOne<{ id: string }>(
        db,
        `SELECT id FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
        [project.id, req.params.task_id]
      );
      if (!job) return reply.code(404).send({ ok: false, error: "job not found" });

      const fromScratch = Boolean((req.body as Record<string, unknown> | undefined)?.from_scratch);

      try {
        if (fromScratch) {
          await reprocessJobFromScratch(db, config, project.id, req.params.task_id);
        } else {
          await processContentJobById(db, config, job.id);
        }
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const st = await qOne<{ status: string }>(
        db,
        `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
        [job.id]
      );
      return { ok: true, task_id: req.params.task_id, status: st?.status, from_scratch: fromScratch };
    }
  );

  /**
   * POST /v1/pipeline/:project_slug/task/:task_id/rework
   * NEEDS_EDIT → override-only (same job) or full/partial reset same task_id + job_draft + full pipeline.
   */
  app.post<{ Params: { project_slug: string; task_id: string } }>(
    "/v1/pipeline/:project_slug/task/:task_id/rework",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const taskId = req.params.task_id.trim();
      const exists = await qOne<{ one: number }>(
        db,
        `SELECT 1 AS one FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2 LIMIT 1`,
        [project.id, taskId]
      );
      if (!exists) return reply.code(404).send({ ok: false, error: "job not found" });

      void executeRework(db, config, project.id, taskId)
        .then((result) => {
          if (!result.ok) {
            req.log.warn({ taskId, error: result.error, mode: result.mode }, "pipeline rework background failed");
          }
        })
        .catch((err) => {
          req.log.error({ err, taskId }, "pipeline rework background threw");
        });

      return reply.code(202).send({
        ok: true,
        accepted: true,
        task_id: taskId,
        message:
          "Rework started in the background (LLM + QC + render can take several minutes). Poll job status or refresh the admin Jobs table.",
      });
    }
  );
}
