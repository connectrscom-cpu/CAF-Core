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
      rewriteRequestHeaders: (req, headers) => {
        const h = { ...headers };
        const incomingHost =
          (typeof req.headers["x-forwarded-host"] === "string" && req.headers["x-forwarded-host"]) ||
          (typeof req.headers.host === "string" && req.headers.host) ||
          "";
        const incomingProto =
          (typeof req.headers["x-forwarded-proto"] === "string" && req.headers["x-forwarded-proto"]) ||
          (config.NODE_ENV === "production" ? "https" : "http");
        // Keep public host for Review middleware redirects (login, etc.).
        if (incomingHost && !incomingHost.includes("127.0.0.1")) {
          h["x-forwarded-host"] = incomingHost.split(",")[0]!.trim();
          h["x-forwarded-proto"] = incomingProto.split(",")[0]!.trim();
        } else if (config.CAF_PUBLIC_URL) {
          try {
            const u = new URL(config.CAF_PUBLIC_URL);
            h["x-forwarded-host"] = u.host;
            h["x-forwarded-proto"] = u.protocol.replace(":", "") || "https";
          } catch {
            /* ignore bad CAF_PUBLIC_URL */
          }
        }
        h.host = `127.0.0.1:${config.CAF_REVIEW_PORT}`;
        // Multipart uploads through reply-from fail when Expect: 100-continue is forwarded.
        delete h.expect;
        delete h.Expect;
        return h;
      },
    });
  });
}
