import type { FastifyInstance } from "fastify";
import replyFrom from "@fastify/reply-from";
import type { AppConfig } from "../config.js";
import { isCoreHttpPath } from "../domain/core-http-paths.js";

export async function registerReviewProxyRoutes(
  app: FastifyInstance,
  opts: { config: AppConfig; reviewUpstream: string }
): Promise<void> {
  const { config, reviewUpstream } = opts;

  await app.register(replyFrom, { base: reviewUpstream });

  app.setNotFoundHandler(async (request, reply) => {
    const pathNoQuery = request.url.split("?")[0] ?? request.url;
    if (!config.CAF_REVIEW_ENABLED) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
    if (isCoreHttpPath(pathNoQuery)) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
    return reply.from(request.raw.url ?? request.url, {
      rewriteRequestHeaders: (_req, headers) => {
        const h = { ...headers };
        h.host = `127.0.0.1:${config.CAF_REVIEW_PORT}`;
        return h;
      },
    });
  });
}
