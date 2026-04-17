import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runPendingMigrations } from "./db/run-migrations.js";
import { registerV1Routes } from "./routes/v1.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerProjectConfigRoutes } from "./routes/project-config.js";
import { registerSignalPackRoutes } from "./routes/signal-packs.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerFlowEngineRoutes } from "./routes/flow-engine.js";
import { registerPipelineRoutes } from "./routes/pipeline.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerPublicationRoutes } from "./routes/publications.js";
import { registerProjectIntegrationsRoutes } from "./routes/project-integrations.js";
import { registerRendererTemplateRoutes, isRendererTemplatesPublicPath } from "./routes/renderer-templates.js";
import {
  warnIfRendererBaseUrlIsCafCore,
  warnIfVideoAssemblyIsStandaloneRenderer,
} from "./services/renderer-url-guard.js";
import { ensureSupabaseAssetFolderPrefixes } from "./services/supabase-storage.js";
import { startEditorialAnalysisCron } from "./services/editorial-analysis-cron.js";

async function main() {
  const config = loadConfig();
  const db = createPool(config);

  if (config.CAF_RUN_MIGRATIONS_ON_START) {
    await runPendingMigrations(db, {
      log: (line) => console.log(`[caf-core] ${line}`),
    });
  }

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.get("/robots.txt", async (_request, reply) => {
    return reply
      .type("text/plain; charset=utf-8")
      .send("User-agent: *\nDisallow: /\n");
  });

  registerRendererTemplateRoutes(app, config.CAROUSEL_TEMPLATES_DIR);

  if (config.CAF_CORE_REQUIRE_AUTH && config.CAF_CORE_API_TOKEN) {
    app.addHook("preHandler", async (request, reply) => {
      const pathNoQuery = request.url.split("?")[0] ?? request.url;
      if (pathNoQuery === "/health" || pathNoQuery === "/health/rendering") return;
      if (request.url === "/robots.txt" || request.url.startsWith("/robots.txt?")) return;
      if (request.method === "GET" && isRendererTemplatesPublicPath(request.url)) return;
      const token =
        (request.headers["x-caf-core-token"] as string | undefined) ||
        (request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice(7)
          : undefined);
      if (token !== config.CAF_CORE_API_TOKEN) {
        return reply.code(401).send({ ok: false, error: "unauthorized" });
      }
    });
  }

  registerV1Routes(app, { db, config });
  registerAdminRoutes(app, { db, config });
  registerProjectConfigRoutes(app, { db });
  registerSignalPackRoutes(app, { db, config });
  registerRunRoutes(app, { db, config });
  registerFlowEngineRoutes(app, { db });
  registerPipelineRoutes(app, { db, config });
  registerLearningRoutes(app, { db, config });
  registerPublicationRoutes(app, { db, config });
  registerProjectIntegrationsRoutes(app, { db });

  const stopEditorialCron = startEditorialAnalysisCron(app.log, { db, config });

  app.addHook("onClose", async () => {
    stopEditorialCron?.();
    await db.end();
  });

  await warnIfRendererBaseUrlIsCafCore(config.RENDERER_BASE_URL, (msg) => app.log.warn(msg));
  await warnIfVideoAssemblyIsStandaloneRenderer(config.VIDEO_ASSEMBLY_BASE_URL, (msg) =>
    app.log.warn(msg)
  );
  await ensureSupabaseAssetFolderPrefixes(config).catch((err) => {
    app.log.warn({ err }, "ensureSupabaseAssetFolderPrefixes failed (non-fatal)");
  });
  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
