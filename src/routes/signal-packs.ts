import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import {
  insertSignalPack,
  getSignalPackById,
  listSignalPacks,
  updateSignalPackIdeasV2,
  updateSignalPackIdeasJson,
  updateSignalPackSelectedIdeaIds,
} from "../repositories/signal-packs.js";
import { createRun } from "../repositories/runs.js";
import { parseSignalPackExcel } from "../services/signal-pack-parser.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { trimRunDisplayName } from "../lib/run-display-name.js";
import { materializeRunCandidates } from "../services/run-candidates-materialize.js";
import { parseIdeasV2, parseSelectedIdeaIds } from "../domain/signal-pack-ideas-v2.js";

export function registerSignalPackRoutes(app: FastifyInstance, deps: { db: Pool; config: AppConfig }) {
  const { db, config } = deps;

  /**
   * POST /v1/signal-packs/upload
   *
   * Accepts a multipart file upload (.xlsx) and a project_slug field.
   * Optional `run_name` (or `display_name` / `name`) sets `runs.metadata_json.display_name`.
   * Parses the Excel into structured JSON, inserts a signal_pack row,
   * creates a run linked to it, and returns both IDs.
   */
  app.post("/v1/signal-packs/upload", async (request, reply) => {
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let fileName: string | null = null;
    let projectSlug: string | null = null;
    let sourceWindow: string | null = null;
    let notes: string | null = null;
    let runName: string | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        fileName = part.filename;
      } else {
        if (part.fieldname === "project_slug") projectSlug = part.value as string;
        else if (part.fieldname === "source_window") sourceWindow = part.value as string;
        else if (part.fieldname === "notes") notes = part.value as string;
        else if (part.fieldname === "run_name" || part.fieldname === "display_name" || part.fieldname === "name") {
          runName = part.value as string;
        }
      }
    }

    if (!fileBuffer || !projectSlug) {
      return reply.code(400).send({ ok: false, error: "Missing file or project_slug" });
    }

    const project = await ensureProject(db, projectSlug);

    const parsed = parseSignalPackExcel(fileBuffer);
    const { sheets_ingested, used_published_signal_pack_row, ...packForDb } = parsed;
    const runId = `RUN_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;

    const pack = await insertSignalPack(db, {
      ...packForDb,
      run_id: runId,
      project_id: project.id,
      source_window: sourceWindow,
      upload_filename: fileName,
      notes,
      ideas_json: [],
    });

    const displayName = trimRunDisplayName(runName);
    const run = await createRun(db, {
      run_id: runId,
      project_id: project.id,
      source_window: sourceWindow,
      signal_pack_id: pack.id,
      metadata_json: {
        upload_filename: fileName,
        total_candidates: parsed.overall_candidates_json.length,
        derived_globals: parsed.derived_globals_json,
        sheets_ingested,
        used_published_signal_pack_row: used_published_signal_pack_row ?? false,
        ...(displayName ? { display_name: displayName } : {}),
      },
    });

    const packRow = await getSignalPackById(db, pack.id);
    if (packRow) {
      const ideas = Array.isArray(packRow.ideas_json) ? packRow.ideas_json : [];
      const mode = ideas.length > 0 ? "from_pack_ideas_all" : "from_pack_overall";
      await materializeRunCandidates(db, config, project.id, run, packRow, { mode });
    }

    const fieldSizes = (v: unknown) =>
      v == null ? 0 : typeof v === "string" ? v.length : JSON.stringify(v).length;

    await tryInsertApiCallAudit(db, {
      projectId: project.id,
      runId: run.run_id,
      taskId: null,
      signalPackId: pack.id,
      step: "signal_pack_xlsx_ingest",
      provider: "internal",
      model: null,
      ok: true,
      requestJson: {
        upload_filename: fileName,
        source_window: sourceWindow,
        notes,
        sheets_ingested,
        workbook_sheets_total: sheets_ingested.length,
      },
      responseJson: {
        signal_pack_id: pack.id,
        run_id: run.run_id,
        overall_candidates_json: parsed.overall_candidates_json,
        ig_summary_json: parsed.ig_summary_json,
        tiktok_summary_json: parsed.tiktok_summary_json,
        reddit_summary_json: parsed.reddit_summary_json,
        fb_summary_json: parsed.fb_summary_json,
        html_summary_json: parsed.html_summary_json,
        derived_globals_json: parsed.derived_globals_json,
        _byte_hints: {
          overall_candidates: fieldSizes(parsed.overall_candidates_json),
          ig_summary: fieldSizes(parsed.ig_summary_json),
          tiktok_summary: fieldSizes(parsed.tiktok_summary_json),
        },
      },
    });

    return {
      ok: true,
      signal_pack_id: pack.id,
      run_id: run.run_id,
      run_uuid: run.id,
      run_status: run.status,
      total_candidates: parsed.overall_candidates_json.length,
      derived_globals: parsed.derived_globals_json,
      transparency: {
        sheets_ingested,
        overall_candidates_json: parsed.overall_candidates_json,
        ig_summary_json: parsed.ig_summary_json,
        tiktok_summary_json: parsed.tiktok_summary_json,
        reddit_summary_json: parsed.reddit_summary_json,
        fb_summary_json: parsed.fb_summary_json,
        html_summary_json: parsed.html_summary_json,
        derived_globals_json: parsed.derived_globals_json,
        used_published_signal_pack_row: used_published_signal_pack_row ?? false,
        message:
          "This payload is what was written to caf_core.signal_packs and will expand into planner candidates after Start (× enabled flow types). If the workbook has a Signal Pack tab, the curated overall_candidates_json cell is used instead of every row on Overall. Scene-router LLM seeds are added only at run start and are logged separately.",
      },
    };
  });

  /**
   * POST /v1/signal-packs/ingest
   *
   * Accepts JSON body directly (for programmatic ingestion without file upload).
   */
  const ingestSchema = z.object({
    project_slug: z.string(),
    run_id: z.string().optional(),
    source_window: z.string().optional(),
    overall_candidates_json: z.array(z.record(z.unknown())),
    ideas_json: z.array(z.record(z.unknown())).optional(),
    ig_summary_json: z.unknown().optional(),
    tiktok_summary_json: z.unknown().optional(),
    reddit_summary_json: z.unknown().optional(),
    fb_summary_json: z.unknown().optional(),
    html_summary_json: z.unknown().optional(),
    derived_globals_json: z.record(z.unknown()).optional(),
    notes: z.string().optional(),
    name: z.string().max(200).optional(),
  });

  app.post("/v1/signal-packs/ingest", async (request, reply) => {
    const parsed = ingestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const project = await ensureProject(db, body.project_slug);
    const runId = body.run_id ?? `RUN_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;

    const pack = await insertSignalPack(db, {
      run_id: runId,
      project_id: project.id,
      source_window: body.source_window ?? null,
      overall_candidates_json: body.overall_candidates_json,
      ideas_json: body.ideas_json ?? [],
      ig_summary_json: body.ig_summary_json,
      tiktok_summary_json: body.tiktok_summary_json,
      reddit_summary_json: body.reddit_summary_json,
      fb_summary_json: body.fb_summary_json,
      html_summary_json: body.html_summary_json,
      derived_globals_json: body.derived_globals_json ?? {},
      notes: body.notes ?? null,
    });

    const ingestLabel = trimRunDisplayName(body.name);
    const run = await createRun(db, {
      run_id: runId,
      project_id: project.id,
      source_window: body.source_window ?? null,
      signal_pack_id: pack.id,
      metadata_json: {
        total_candidates: body.overall_candidates_json.length,
        ...(ingestLabel ? { display_name: ingestLabel } : {}),
      },
    });

    const packRowIngest = await getSignalPackById(db, pack.id);
    if (packRowIngest) {
      const ideas = Array.isArray(packRowIngest.ideas_json) ? packRowIngest.ideas_json : [];
      const mode = ideas.length > 0 ? "from_pack_ideas_all" : "from_pack_overall";
      await materializeRunCandidates(db, config, project.id, run, packRowIngest, { mode });
    }

    await tryInsertApiCallAudit(db, {
      projectId: project.id,
      runId: run.run_id,
      taskId: null,
      signalPackId: pack.id,
      step: "signal_pack_json_ingest",
      provider: "internal",
      model: null,
      ok: true,
      requestJson: { source: "POST /v1/signal-packs/ingest", notes: body.notes ?? null },
      responseJson: {
        overall_candidates_json: body.overall_candidates_json,
        derived_globals: body.derived_globals_json ?? {},
      },
    });

    return {
      ok: true,
      signal_pack_id: pack.id,
      run_id: run.run_id,
      run_uuid: run.id,
      run_status: run.status,
      total_candidates: body.overall_candidates_json.length,
      transparency: {
        sheets_ingested: [],
        overall_candidates_json: body.overall_candidates_json,
        derived_globals_json: body.derived_globals_json ?? {},
        ig_summary_json: body.ig_summary_json ?? null,
        message: "JSON ingest — stored as signal_pack row; same shape as XLSX Overall sheet + optional summaries.",
      },
    };
  });

  // ── List & Get ───────────────────────────────────────────────────────
  app.get("/v1/signal-packs/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z
      .object({
        limit: z.coerce.number().int().default(50),
        offset: z.coerce.number().int().default(0),
        /** When set, omit bulky JSON — for run picker UIs. */
        summary: z.enum(["1", "true"]).optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const packs = await listSignalPacks(db, project.id, query.data?.limit ?? 50, query.data?.offset ?? 0);
    const slim = query.data.summary === "1" || query.data.summary === "true";
    if (slim) {
      return {
        ok: true,
        signal_packs: packs.map((p) => ({
          id: p.id,
          run_id: p.run_id,
          created_at: p.created_at,
          source_window: p.source_window,
          upload_filename: p.upload_filename,
          notes: p.notes,
          source_inputs_import_id: p.source_inputs_import_id ?? null,
          overall_candidates_count: Array.isArray(p.overall_candidates_json) ? p.overall_candidates_json.length : 0,
          ideas_count: Array.isArray(p.ideas_json) ? p.ideas_json.length : 0,
        })),
        count: packs.length,
      };
    }
    return { ok: true, signal_packs: packs, count: packs.length };
  });

  app.get("/v1/signal-packs/:project_slug/:id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const pack = await getSignalPackById(db, params.data.id);
    if (!pack) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, signal_pack: pack };
  });

  /**
   * POST /v1/signal-packs/:project_slug/:id/ideas
   *
   * Upserts rich idea objects on the pack (canonical: stored in `ideas_json`).
   */
  app.post("/v1/signal-packs/:project_slug/:id/ideas", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z.object({ ideas: z.unknown() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });

    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, params.data.id);
    if (!pack) return reply.code(404).send({ ok: false, error: "not_found" });
    if (pack.project_id !== project.id) return reply.code(403).send({ ok: false, error: "wrong_project" });

    const ideas = parseIdeasV2(body.data.ideas);
    const n = await updateSignalPackIdeasJson(db, pack.id, ideas);
    return { ok: true, updated: n, ideas_count: ideas.length };
  });

  /**
   * Backward-compatible alias for the earlier /ideas-v2 endpoint.
   * Writes to canonical `ideas_json` so there's a single truth going forward.
   */
  app.post("/v1/signal-packs/:project_slug/:id/ideas-v2", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z.object({ ideas: z.unknown() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });

    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, params.data.id);
    if (!pack) return reply.code(404).send({ ok: false, error: "not_found" });
    if (pack.project_id !== project.id) return reply.code(403).send({ ok: false, error: "wrong_project" });

    const ideas = parseIdeasV2(body.data.ideas);
    const n = await updateSignalPackIdeasJson(db, pack.id, ideas);
    // best-effort: keep the deprecated column in sync for now (non-blocking)
    await updateSignalPackIdeasV2(db, pack.id, ideas);
    return { ok: true, updated: n, ideas_count: ideas.length, note: "stored_in: ideas_json" };
  });

  /**
   * POST /v1/signal-packs/:project_slug/:id/select-ideas
   *
   * Sets the ordered selection of idea IDs on the pack (stage 4 output).
   * This selection is what should flow into run materialization and content jobs downstream.
   */
  app.post("/v1/signal-packs/:project_slug/:id/select-ideas", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z.object({ idea_ids: z.unknown() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });

    const project = await ensureProject(db, params.data.project_slug);
    const pack = await getSignalPackById(db, params.data.id);
    if (!pack) return reply.code(404).send({ ok: false, error: "not_found" });
    if (pack.project_id !== project.id) return reply.code(403).send({ ok: false, error: "wrong_project" });

    const selected = parseSelectedIdeaIds(body.data.idea_ids);
    const n = await updateSignalPackSelectedIdeaIds(db, pack.id, selected);
    return { ok: true, updated: n, selected_count: selected.length, selected_idea_ids: selected };
  });
}
