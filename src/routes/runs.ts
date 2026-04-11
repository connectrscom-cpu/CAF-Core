import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import {
  createRun,
  deleteRunCascade,
  getRunById,
  getRunByRunId,
  listRuns,
  resetRunForReplan,
  updateRunStatus,
  patchRun,
} from "../repositories/runs.js";
import { replanRun, startRun } from "../services/run-orchestrator.js";
import { processRunJobs, processJobByTaskId } from "../services/job-pipeline.js";

export function registerRunRoutes(app: FastifyInstance, deps: { db: Pool; config: AppConfig }) {
  const { db, config } = deps;

  // ── List runs ────────────────────────────────────────────────────────
  app.get("/v1/runs/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({
      limit: z.coerce.number().int().default(50),
      offset: z.coerce.number().int().default(0),
    }).safeParse(request.query);
    const project = await ensureProject(db, params.data.project_slug);
    const runs = await listRuns(db, project.id, query.data?.limit ?? 50, query.data?.offset ?? 0);
    return { ok: true, runs, count: runs.length };
  });

  // ── Get run detail ───────────────────────────────────────────────────
  app.get("/v1/runs/:project_slug/:run_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);

    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "not_found" });

    return { ok: true, run };
  });

  // ── Create run manually ──────────────────────────────────────────────
  const createRunSchema = z.object({
    run_id: z.string().optional(),
    signal_pack_id: z.string().optional(),
    source_window: z.string().optional(),
    metadata_json: z.record(z.unknown()).optional(),
  });

  app.post("/v1/runs/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = createRunSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const runId = body.data.run_id ?? `RUN_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;

    const run = await createRun(db, {
      run_id: runId,
      project_id: project.id,
      source_window: body.data.source_window ?? null,
      signal_pack_id: body.data.signal_pack_id ?? null,
      metadata_json: body.data.metadata_json ?? {},
    });

    return { ok: true, run };
  });

  // ── Patch run (e.g. attach signal_pack_id before start) ─────────────
  const patchRunSchema = z.object({
    signal_pack_id: z.string().uuid().optional().nullable(),
    source_window: z.string().optional().nullable(),
    metadata_json: z.record(z.unknown()).optional(),
  });

  app.patch("/v1/runs/:project_slug/:run_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    const body = patchRunSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run || run.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "run_not_found" });
    }
    const updated = await patchRun(db, run.id, {
      signal_pack_id: body.data.signal_pack_id,
      source_window: body.data.source_window,
      metadata_json: body.data.metadata_json,
    });
    return { ok: true, run: updated };
  });

  // ── Start run (triggers orchestrator) ────────────────────────────────
  app.post("/v1/runs/:project_slug/:run_id/start", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    if (run.status === "PLANNING" || (run.status === "FAILED" && run.total_jobs === 0)) {
      await resetRunForReplan(db, run.id);
      const again = await getRunById(db, run.id);
      if (again) run = again;
    }

    try {
      const result = await startRun(db, config, run.id);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const badReq =
        message.includes("expected CREATED") ||
        message.includes("no signal pack") ||
        (message.includes("Signal pack") && message.includes("not found")) ||
        message.includes("No enabled flow types");
      return reply
        .code(badReq ? 400 : 500)
        .send({ ok: false, error: badReq ? "bad_request" : "run_start_failed", message });
    }
  });

  // ── Re-plan run (delete jobs, reset, decision engine again) ─────────
  app.post("/v1/runs/:project_slug/:run_id/replan", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    try {
      const result = await replanRun(db, config, run.id);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const code = message.includes("use Start") || message.includes("still planning") ? 400 : 500;
      return reply.code(code).send({ ok: false, error: "replan_failed", message });
    }
  });

  // ── Start run + process all planned jobs (one-shot full generation) ─
  app.post("/v1/runs/:project_slug/:run_id/start-and-process", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    try {
      const startResult = await startRun(db, config, run.id);
      const log = request.server.log;
      const runUuid = run.id;
      const runIdText = run.run_id;
      void processRunJobs(db, config, runUuid)
        .then((processResult) => {
          log.info(
            { run_id: runIdText, processed: processResult.processed, errors: processResult.errors },
            "start-and-process: pipeline finished"
          );
        })
        .catch((err) => {
          log.error({ err, run_id: runIdText }, "start-and-process: pipeline failed");
        });

      return reply.code(202).send({
        ok: true,
        accepted: true,
        start: startResult,
        message:
          "Run started; processing continues in the background (LLM + render can take many minutes for large runs). Check Jobs or Fly logs — do not rely on a single long HTTP response.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(500).send({ ok: false, error: "start_and_process_failed", message });
    }
  });

  // ── Delete run (cascade jobs + signal packs + run row) ────────────────
  app.delete("/v1/runs/:project_slug/:run_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run || run.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "run_not_found" });
    }

    try {
      const out = await deleteRunCascade(db, project.id, run.run_id);
      if (!out.run_deleted) {
        return reply.code(404).send({ ok: false, error: "run_not_found" });
      }
      return { ok: true, run_id: run.run_id, ...out };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(500).send({ ok: false, error: "run_delete_failed", message });
    }
  });

  // ── Cancel run ───────────────────────────────────────────────────────
  app.post("/v1/runs/:project_slug/:run_id/cancel", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    const updated = await updateRunStatus(db, run.id, "CANCELLED", {
      completed_at: new Date().toISOString(),
    });
    return { ok: true, run: updated };
  });

  // ── Process run jobs (advance through pipeline) ──────────────────────
  app.post("/v1/runs/:project_slug/:run_id/process", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    const log = request.server.log;
    const runUuid = run.id;
    const runIdText = run.run_id;
    void processRunJobs(db, config, runUuid)
      .then((result) => {
        log.info(
          { run_id: runIdText, processed: result.processed, errors: result.errors },
          "process run: pipeline finished"
        );
      })
      .catch((err) => {
        log.error({ err, run_id: runIdText }, "process run: pipeline failed");
      });

    return reply.code(202).send({
      ok: true,
      accepted: true,
      run_id: runIdText,
      message:
        "Processing started in the background. Large runs (many carousels/videos) often exceeded HTTP timeouts when this ran synchronously — refresh the Jobs table to watch progress. See Fly logs for processed count and errors when complete.",
    });
  });

  // ── Process single job ───────────────────────────────────────────────
  app.post("/v1/jobs/:project_slug/:task_id/process", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), task_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);

    try {
      const result = await processJobByTaskId(db, config, project.id, params.data.task_id);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.code(500).send({ ok: false, error: "process_failed", message });
    }
  });
}
