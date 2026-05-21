import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ensureProject } from "../repositories/core.js";
import {
  INPUTS_SOURCE_TABS,
  deleteSourceRow,
  getScraperConfig,
  listScraperRuns,
  listSourceRows,
  replaceSourceTabRows,
  upsertScraperConfig,
  upsertSourceRow,
} from "../repositories/inputs-sources.js";
import { syncSourcesFromWorkbookBuffer } from "../services/inputs-source-sync.js";
import {
  defaultScraperConfig,
  getProjectScraperConfig,
  runInputsScraper,
  SCRAPER_KEYS,
} from "../services/inputs-scraper-orchestrator.js";
import {
  DEFAULT_ACTOR_IDS,
  SCRAPER_CONFIG_FIELDS,
} from "../services/inputs-scraper-apify-config.js";
import { hasApifyToken } from "../services/apify-client.js";

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

  app.post("/v1/inputs-sources/:project_slug/sync-from-workbook", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      }
    }
    if (!fileBuffer) return reply.code(400).send({ ok: false, error: "missing_file" });

    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await syncSourcesFromWorkbookBuffer(db, project.id, fileBuffer);
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "sync_failed", message: msg });
    }
  });

  app.post("/v1/inputs-sources/:project_slug/run-scraper", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z
      .object({ scraper: z.enum(["instagram", "tiktok", "html", "facebook", "reddit", "all"]) })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: "bad_body" });

    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await runInputsScraper(db, config, project.id, body.data.scraper);
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ ok: false, error: "scraper_failed", message: msg });
    }
  });

  app.get("/v1/inputs-sources/:project_slug/scraper-runs", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const runs = await listScraperRuns(db, project.id, query.data.limit);
    return { ok: true, runs };
  });
}
