import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  INPUTS_SOURCE_TABS,
  deleteSourceRow,
  getScraperConfig,
  getScraperRun,
  listScraperRuns,
  listSourceRows,
  replaceSourceTabRows,
  upsertScraperConfig,
  upsertSourceRow,
} from "../repositories/inputs-sources.js";
import { syncSourcesFromWorkbookBuffer, buildSourcesWorkbookTemplateBuffer } from "../services/inputs-source-sync.js";
import { estimateInputsScraperRun } from "../services/inputs-scraper-cost-estimate.js";
import {
  abortInputsScraperRun,
  defaultScraperConfig,
  getProjectScraperConfig,
  startInputsScraperRun,
  SCRAPER_KEYS,
  type ScraperKey,
} from "../services/inputs-scraper-orchestrator.js";
import {
  DEFAULT_ACTOR_IDS,
  SCRAPER_CONFIG_FIELDS,
} from "../services/inputs-scraper-apify-config.js";
import { hasApifyToken } from "../services/apify-client.js";
import {
  apifyRunIdsFromScraperStats,
  recoverInputsScraperFromApify,
  type RecoverableScraperKey,
} from "../services/inputs-scraper-recover.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerInputsScraperRoutes(
  app: FastifyInstance,
  deps: { db: Pool; config: AppConfig }
) {
  const { db, config } = deps;

  app.get("/v1/inputs-sources/:project_slug/meta", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    await ensureProject(db, params.data.project_slug);
    return {
      ok: true,
      source_tabs: INPUTS_SOURCE_TABS,
      scraper_keys: SCRAPER_KEYS.filter((k) => k !== "all"),
      apify_configured: hasApifyToken(config.APIFY_API_TOKEN),
      default_config: defaultScraperConfig(),
      default_actor_ids: DEFAULT_ACTOR_IDS,
      config_fields: SCRAPER_CONFIG_FIELDS,
    };
  });

  app.get("/v1/inputs-sources/:project_slug/rows", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({ tab: z.string().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const rows = await listSourceRows(db, project.id, query.data.tab ?? null);
    return { ok: true, rows, count: rows.length };
  });

  app.put("/v1/inputs-sources/:project_slug/rows/:tab", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), tab: z.string() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const body = z
      .object({
        rows: z.array(
          z.object({
            row_index: z.number().int().min(0),
            enabled: z.boolean().default(true),
            payload_json: z.record(z.unknown()),
          })
        ),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    const n = await replaceSourceTabRows(db, project.id, params.data.tab, body.data.rows);
    return { ok: true, row_count: n };
  });

  app.patch("/v1/inputs-sources/:project_slug/rows/:row_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), row_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !UUID_RE.test(params.data.row_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const body = z
      .object({
        source_tab: z.string(),
        row_index: z.number().int().min(0),
        enabled: z.boolean(),
        payload_json: z.record(z.unknown()),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    await upsertSourceRow(db, project.id, body.data.source_tab, body.data.row_index, {
      enabled: body.data.enabled,
      payload_json: body.data.payload_json,
    });
    return { ok: true };
  });

  app.delete("/v1/inputs-sources/:project_slug/rows/:row_id", async (request, reply) => {
    const params = z
      .object({ project_slug: z.string(), row_id: z.string() })
      .safeParse(request.params);
    if (!params.success || !UUID_RE.test(params.data.row_id)) {
      return reply.code(400).send({ ok: false, error: "bad_params" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const n = await deleteSourceRow(db, project.id, params.data.row_id);
    if (n === 0) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true };
  });

  app.get("/v1/inputs-sources/:project_slug/scraper-config", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const cfg = await getProjectScraperConfig(db, project.id);
    return {
      ok: true,
      config: cfg,
      apify_configured: hasApifyToken(config.APIFY_API_TOKEN),
    };
  });

  app.put("/v1/inputs-sources/:project_slug/scraper-config", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z.object({ config: z.record(z.unknown()) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    await upsertScraperConfig(db, project.id, body.data.config);
    const row = await getScraperConfig(db, project.id);
    return { ok: true, updated_at: row?.updated_at ?? null };
  });

  app.get("/v1/inputs-sources/workbook-template", async (_request, reply) => {
    const buffer = buildSourcesWorkbookTemplateBuffer();
    return reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", 'attachment; filename="caf-research-sources-template.xlsx"')
      .send(buffer);
  });

  app.post("/v1/inputs-sources/:project_slug/sync-from-workbook", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    let fileBuffer: Buffer | null = null;

    if (contentType.includes("application/json")) {
      const body = z
        .object({
          data_base64: z.string().min(1),
          filename: z.string().optional(),
        })
        .safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });
      try {
        fileBuffer = Buffer.from(body.data.data_base64, "base64");
      } catch {
        return reply.code(400).send({ ok: false, error: "invalid_base64" });
      }
      if (!fileBuffer.length) {
        return reply.code(400).send({ ok: false, error: "missing_file" });
      }
    } else {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          fileBuffer = Buffer.concat(chunks);
        }
      }
      if (!fileBuffer) return reply.code(400).send({ ok: false, error: "missing_file" });
    }

    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await syncSourcesFromWorkbookBuffer(db, project.id, fileBuffer);
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "sync_failed", message: msg });
    }
  });

  app.get("/v1/inputs-sources/:project_slug/scraper-estimate", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z
      .object({
        scraper: z.enum(["instagram", "tiktok", "html", "facebook", "reddit", "all"]).default("all"),
        max_sources: z.coerce.number().int().min(0).max(500).optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const maxSources =
      query.data.max_sources != null && query.data.max_sources > 0 ? query.data.max_sources : null;
    const estimate = await estimateInputsScraperRun(
      db,
      project.id,
      query.data.scraper as ScraperKey,
      maxSources
    );
    return { ok: true, estimate };
  });

  app.post("/v1/inputs-sources/:project_slug/run-scraper", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z
      .object({
        scraper: z.enum(["instagram", "tiktok", "html", "facebook", "reddit", "linkedin", "all"]),
        max_sources: z.number().int().min(1).max(500).optional(),
        platforms: z
          .array(z.enum(["instagram", "tiktok", "html", "facebook", "reddit", "linkedin"]))
          .min(1)
          .max(6)
          .optional(),
        post_max_age_days: z.number().int().min(1).max(365).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await startInputsScraperRun(db, config, project.id, body.data.scraper, {
        maxSources: body.data.max_sources ?? null,
        platforms: body.data.platforms,
        postMaxAgeDays: body.data.post_max_age_days,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "scraper_failed", message: msg });
    }
  });

  app.post(
    "/v1/inputs-sources/:project_slug/scraper-runs/:run_id/abort",
    async (request, reply) => {
      const params = z
        .object({ project_slug: z.string(), run_id: z.string() })
        .safeParse(request.params);
      if (!params.success || !UUID_RE.test(params.data.run_id)) {
        return reply.code(400).send({ ok: false, error: "bad_params" });
      }

      const project = await ensureProject(db, params.data.project_slug);
      const result = await abortInputsScraperRun(
        db,
        config,
        project.id,
        params.data.run_id
      );
      if (!result.ok) {
        const code = result.error === "not_found" ? 404 : 409;
        return reply.code(code).send({ ok: false, error: result.error });
      }
      return { ok: true, apify_aborted: result.apify_aborted };
    }
  );

  app.get("/v1/inputs-sources/:project_slug/scraper-runs", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const runs = await listScraperRuns(db, project.id, query.data.limit);
    return { ok: true, runs };
  });

  const recoverBodySchema = z.object({
    scraper: z.enum(["instagram", "tiktok", "facebook", "reddit", "linkedin"]),
    apify_run_ids: z.array(z.string().min(1)).max(20).optional(),
    scraper_run_id: z.string().uuid().optional(),
  });

  app.post("/v1/inputs-sources/:project_slug/recover-apify-import", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = recoverBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    let runIds = body.data.apify_run_ids ?? [];
    if (body.data.scraper_run_id && runIds.length === 0) {
      const run = await getScraperRun(db, project.id, body.data.scraper_run_id);
      if (!run) return reply.code(404).send({ ok: false, error: "not_found" });
      runIds = apifyRunIdsFromScraperStats(
        run.stats_json,
        body.data.scraper as RecoverableScraperKey
      );
    }
    try {
      const result = await recoverInputsScraperFromApify(db, config, project.id, {
        scraperKey: body.data.scraper as RecoverableScraperKey,
        apifyRunIds: runIds,
        scraperRunId: body.data.scraper_run_id ?? null,
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "recover_failed", message: msg });
    }
  });

  app.post(
    "/v1/inputs-sources/:project_slug/scraper-runs/:run_id/recover",
    async (request, reply) => {
      const params = z
        .object({ project_slug: z.string(), run_id: z.string() })
        .safeParse(request.params);
      if (!params.success || !UUID_RE.test(params.data.run_id)) {
        return reply.code(400).send({ ok: false, error: "bad_params" });
      }
      const body = z
        .object({
          scraper: z.enum(["instagram", "tiktok", "facebook", "reddit", "linkedin"]).optional(),
          apify_run_ids: z.array(z.string().min(1)).max(20).optional(),
        })
        .safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

      const project = await ensureProject(db, params.data.project_slug);
      const run = await getScraperRun(db, project.id, params.data.run_id);
      if (!run) return reply.code(404).send({ ok: false, error: "not_found" });

      const scraperKey =
        body.data.scraper ??
        (run.scraper_key === "all"
          ? ("linkedin" as RecoverableScraperKey)
          : (run.scraper_key as RecoverableScraperKey));

      if (scraperKey === "all" as string) {
        return reply.code(400).send({ ok: false, error: "bad_body", message: "Specify scraper platform" });
      }

      const apifyRunIds =
        body.data.apify_run_ids?.length
          ? body.data.apify_run_ids
          : apifyRunIdsFromScraperStats(run.stats_json, scraperKey as RecoverableScraperKey);

      try {
        const result = await recoverInputsScraperFromApify(db, config, project.id, {
          scraperKey: scraperKey as RecoverableScraperKey,
          apifyRunIds,
          scraperRunId: params.data.run_id,
        });
        return { ok: true, ...result };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(400).send({ ok: false, error: "recover_failed", message: msg });
      }
    }
  );
}
