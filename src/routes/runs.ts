import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { z } from "zod";
import { trimRunDisplayName } from "../lib/run-display-name.js";
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
import { getSignalPackById } from "../repositories/signal-packs.js";
import { replanRun, startRun } from "../services/run-orchestrator.js";
import { materializeRunCandidates } from "../services/run-candidates-materialize.js";
import {
  generateRunDraftPackages,
  processJobByTaskId,
  processRunJobs,
  renderRunGeneratedJobs,
} from "../services/job-pipeline.js";
import { getRunOutputReview, upsertRunOutputReview } from "../repositories/run-output-reviews.js";
import { buildRunExportData, renderRunExportMarkdown } from "../services/run-export.js";

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
    name: z.string().max(200).optional(),
    /** Required: pick an existing signal pack (e.g. from Processing or legacy XLSX ingest). */
    signal_pack_id: z.string().uuid({ message: "signal_pack_id must be a UUID of an existing signal pack" }),
    source_window: z.string().optional(),
    metadata_json: z.record(z.unknown()).optional(),
  });

  app.post("/v1/runs/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = createRunSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_request",
        details: {
          ...(params.success ? {} : { params: params.error.flatten() }),
          ...(body.success ? {} : { body: body.error.flatten() }),
        },
      });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, body.data.signal_pack_id);
    if (!pack || pack.project_id !== project.id) {
      return reply.code(400).send({ ok: false, error: "invalid_signal_pack", message: "Signal pack not found for this project." });
    }

    const runId = body.data.run_id ?? `RUN_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;

    const label = trimRunDisplayName(body.data.name);
    const run = await createRun(db, {
      run_id: runId,
      project_id: project.id,
      source_window: body.data.source_window ?? null,
      signal_pack_id: body.data.signal_pack_id,
      metadata_json: {
        ...(body.data.metadata_json ?? {}),
        ...(label ? { display_name: label } : {}),
      },
    });

    return { ok: true, run };
  });

  // ── Run output review (holistic; editorial analysis ingests this) ────
  app.get("/v1/runs/:project_slug/:run_id/output-review", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run || run.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "run_not_found" });
    }
    const review = await getRunOutputReview(db, project.id, run.run_id);
    return { ok: true, review };
  });

  // ── Run export (human-friendly Markdown or raw JSON) ─────────────────
  app.get("/v1/runs/:project_slug/:run_id/export", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z
      .object({
        format: z.enum(["md", "json"]).optional(),
      })
      .safeParse(request.query);

    const format = query.data?.format ?? "md";
    const project = await ensureProject(db, params.data.project_slug);
    const runIdText = params.data.run_id.trim();
    const data = await buildRunExportData(db, { project_id: project.id, project_slug: params.data.project_slug, run_id: runIdText });
    if (!data) return reply.code(404).send({ ok: false, error: "run_not_found" });

    const filenameBase = `caf_run_${params.data.project_slug}_${runIdText}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
    if (format === "json") {
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filenameBase}.json"`);
      return { ok: true, export: data };
    }

    const md = renderRunExportMarkdown(data);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filenameBase}.md"`);
    return reply.send(md);
  });

  const outputReviewPutSchema = z.object({
    body: z.string(),
    validator: z.string().optional(),
  });

  app.put("/v1/runs/:project_slug/:run_id/output-review", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    const body = outputReviewPutSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run || run.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "run_not_found" });
    }
    try {
      const review = await upsertRunOutputReview(db, {
        project_id: project.id,
        run_id: run.run_id,
        body: body.data.body,
        validator: body.data.validator ?? null,
      });
      return { ok: true, review, deleted: review == null };
    } catch {
      return reply.code(500).send({ ok: false, error: "save_failed" });
    }
  });

  // ── Patch run (e.g. attach signal_pack_id before start) ─────────────
  const patchRunSchema = z.object({
    signal_pack_id: z.string().uuid().optional().nullable(),
    source_window: z.string().optional().nullable(),
    metadata_json: z.record(z.unknown()).optional(),
    /** Sets `metadata_json.display_name`. Use `null` or `""` to clear the label. */
    name: z.union([z.string().max(200), z.null()]).optional(),
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
    let display_name: string | null | undefined;
    if (body.data.name !== undefined) {
      if (body.data.name === null) display_name = null;
      else {
        const t = body.data.name.trim();
        display_name = t === "" ? null : t;
      }
    }
    const updated = await patchRun(db, run.id, {
      signal_pack_id: body.data.signal_pack_id,
      source_window: body.data.source_window,
      metadata_json: body.data.metadata_json,
      display_name,
    });
    return { ok: true, run: updated };
  });

  const materializeCandidatesSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("manual"), idea_ids: z.array(z.string()).min(1) }),
    z.object({ mode: z.literal("llm"), max_ideas: z.number().int().min(1).max(100).optional() }),
    z.object({ mode: z.literal("from_pack_ideas_all") }),
    z.object({ mode: z.literal("from_pack_overall") }),
  ]);

  /**
   * Materialize `runs.candidates_json` from the run's signal pack (`ideas_json` or legacy `overall_candidates_json`).
   * Required before Start (orchestrator no longer reads the pack directly for planner rows).
   */
  app.post("/v1/runs/:project_slug/:run_id/candidates", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    const body = materializeCandidatesSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_request",
        details: {
          ...(params.success ? {} : { params: params.error.flatten() }),
          ...(body.success ? {} : { body: body.error.flatten() }),
        },
      });
    }
    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run || run.project_id !== project.id) {
      return reply.code(404).send({ ok: false, error: "run_not_found" });
    }
    if (run.status !== "CREATED") {
      return reply.code(400).send({
        ok: false,
        error: "bad_request",
        message: "Candidates can only be set while the run is in CREATED status.",
      });
    }
    if (!run.signal_pack_id) {
      return reply.code(400).send({ ok: false, error: "bad_request", message: "Run has no signal_pack_id." });
    }
    const pack = await getSignalPackById(db, run.signal_pack_id);
    if (!pack || pack.project_id !== project.id) {
      return reply.code(400).send({ ok: false, error: "bad_request", message: "Signal pack not found for this run." });
    }
    try {
      const out = await materializeRunCandidates(db, config, project.id, run, pack, body.data);
      const fresh = await getRunById(db, run.id);
      return {
        ok: true,
        planner_rows: out.planner_rows,
        candidates_provenance: out.candidates_provenance,
        run: fresh,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "materialize_failed", message: msg });
    }
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
        message.includes("No enabled flow types") ||
        message.includes("candidates_json") ||
        message.includes("Materialize");
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
      void generateRunDraftPackages(db, config, runUuid)
        .then((processResult) => {
          log.info(
            { run_id: runIdText, processed: processResult.processed, errors: processResult.errors },
            "start-and-process: draft packages finished"
          );
        })
        .catch((err) => {
          log.error({ err, run_id: runIdText }, "start-and-process: draft packages failed");
        });

      return reply.code(202).send({
        ok: true,
        accepted: true,
        start: startResult,
        message:
          "Run started; draft package generation continues in the background (LLM → QC → diagnostics). Jobs stop at GENERATED (Package ready). Use Render to start media later.",
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
    void generateRunDraftPackages(db, config, runUuid)
      .then((result) => {
        log.info(
          { run_id: runIdText, processed: result.processed, errors: result.errors },
          "process run: draft packages finished"
        );
      })
      .catch((err) => {
        log.error({ err, run_id: runIdText }, "process run: draft packages failed");
      });

    return reply.code(202).send({
      ok: true,
      accepted: true,
      run_id: runIdText,
      message:
        "Draft package generation started in the background (LLM → QC → diagnostics). Jobs will stop at GENERATED (Package ready). Use /render to start rendering manually.",
    });
  });

  // ── Render generated jobs (manual render step) ───────────────────────
  app.post("/v1/runs/:project_slug/:run_id/render", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), run_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const project = await ensureProject(db, params.data.project_slug);
    let run = await getRunByRunId(db, project.id, params.data.run_id);
    if (!run) run = await getRunById(db, params.data.run_id);
    if (!run) return reply.code(404).send({ ok: false, error: "run_not_found" });

    const log = request.server.log;
    const runUuid = run.id;
    const runIdText = run.run_id;

    // Mark the run as in the render phase for operator visibility.
    await updateRunStatus(db, runUuid, "RENDERING");

    void renderRunGeneratedJobs(db, config, runUuid)
      .then((result) => {
        log.info(
          { run_id: runIdText, rendered: result.rendered, errors: result.errors },
          "render run: finished"
        );
      })
      .catch((err) => {
        log.error({ err, run_id: runIdText }, "render run: failed");
      });

    return reply.code(202).send({
      ok: true,
      accepted: true,
      run_id: runIdText,
      message:
        "Render started in the background for GENERATED jobs. Refresh Jobs to watch assets appear; large runs can take many minutes.",
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
