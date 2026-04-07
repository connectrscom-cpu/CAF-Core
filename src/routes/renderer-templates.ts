/**
 * Serves carousel .hbs sources for the Puppeteer renderer when CAF_TEMPLATE_API_URL points at CAF Core.
 * Contract matches services/renderer/server.js resolveTemplateRemote + GET /templates list.
 */
import type { FastifyInstance } from "fastify";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const NAME_RE = /^[a-zA-Z0-9_-]+\.hbs$/;

function safeTemplatePath(templatesDir: string, name: string): string | null {
  const base = path.basename(decodeURIComponent(name));
  if (!NAME_RE.test(base)) return null;
  const resolvedDir = path.resolve(templatesDir);
  const full = path.resolve(resolvedDir, base);
  if (!full.startsWith(resolvedDir + path.sep) && full !== resolvedDir) return null;
  return full;
}

export function registerRendererTemplateRoutes(app: FastifyInstance, templatesDir: string): void {
  app.get("/api/templates", async (_request, reply) => {
    try {
      const st = await stat(templatesDir).catch(() => null);
      if (!st?.isDirectory()) {
        return reply.code(503).send({ ok: false, error: "templates_dir_missing", dir: templatesDir });
      }
      const names = (await readdir(templatesDir))
        .filter((f) => f.endsWith(".hbs"))
        .sort();
      return { templates: names.map((name) => ({ name })) };
    } catch {
      return reply.code(500).send({ ok: false, error: "templates_list_failed" });
    }
  });

  app.get<{ Params: { name: string } }>("/api/templates/:name", async (request, reply) => {
    const full = safeTemplatePath(templatesDir, request.params.name);
    if (!full) {
      return reply.code(400).send({ ok: false, error: "invalid_template_name" });
    }
    try {
      const source = await readFile(full, "utf8");
      return { name: path.basename(full), source };
    } catch {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
  });
}

/** Allow renderer → Core template fetches without CAF_CORE_API_TOKEN. */
export function isRendererTemplatesPublicPath(url: string): boolean {
  const p = url.split("?")[0] ?? "";
  return p === "/api/templates" || p.startsWith("/api/templates/");
}
