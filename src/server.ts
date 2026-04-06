import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { registerV1Routes } from "./routes/v1.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerProjectConfigRoutes } from "./routes/project-config.js";
import { registerSignalPackRoutes } from "./routes/signal-packs.js";
import { registerRunRoutes } from "./routes/runs.js";

async function main() {
  const config = loadConfig();
  const db = createPool(config);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  if (config.CAF_CORE_REQUIRE_AUTH && config.CAF_CORE_API_TOKEN) {
    app.addHook("preHandler", async (request, reply) => {
      if (request.url === "/health" || request.url.startsWith("/health?")) return;
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

  app.addHook("onClose", async () => {
    await db.end();
  });

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
