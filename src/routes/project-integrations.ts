import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getProjectBySlug } from "../repositories/core.js";
import {
  deleteProjectIntegration,
  getProjectIntegration,
  listProjectIntegrations,
  markIntegrationTestResult,
  upsertProjectIntegration,
} from "../repositories/project-integrations.js";

interface Deps {
  db: Pool;
}

const platformSchema = z.string().min(1);

const upsertSchema = z.object({
  project_slug: z.string().min(1),
  platform: platformSchema,
  display_name: z.string().nullish(),
  is_enabled: z.boolean().optional(),
  account_ids_json: z.record(z.unknown()).optional(),
  credentials_json: z.record(z.unknown()).optional(),
  config_json: z.record(z.unknown()).optional(),
});

const deleteSchema = z.object({
  project_slug: z.string().min(1),
  platform: platformSchema,
});

const testSchema = z.object({
  project_slug: z.string().min(1),
  platform: platformSchema,
});

export function registerProjectIntegrationsRoutes(app: FastifyInstance, { db }: Deps) {
  app.get<{ Params: { project_slug: string } }>("/v1/projects/:project_slug/integrations", async (req, reply) => {
    const project = await getProjectBySlug(db, req.params.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const rows = await listProjectIntegrations(db, project.id);
    return { ok: true, integrations: rows };
  });

  app.get<{ Params: { project_slug: string; platform: string } }>(
    "/v1/projects/:project_slug/integrations/:platform",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const row = await getProjectIntegration(db, project.id, req.params.platform);
      if (!row) return reply.code(404).send({ ok: false, error: "not found" });
      return { ok: true, integration: row };
    }
  );

  app.post<{ Body: z.infer<typeof upsertSchema> }>("/v1/projects/integrations/upsert", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await getProjectBySlug(db, parsed.data.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const row = await upsertProjectIntegration(db, {
      project_id: project.id,
      platform: parsed.data.platform,
      display_name: parsed.data.display_name ?? null,
      is_enabled: parsed.data.is_enabled ?? true,
      account_ids_json: parsed.data.account_ids_json ?? {},
      credentials_json: parsed.data.credentials_json ?? {},
      config_json: parsed.data.config_json ?? {},
    });
    return { ok: true, integration: row };
  });

  app.post<{ Body: z.infer<typeof deleteSchema> }>("/v1/projects/integrations/delete", async (req, reply) => {
    const parsed = deleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await getProjectBySlug(db, parsed.data.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const res = await deleteProjectIntegration(db, project.id, parsed.data.platform);
    return { ok: true, ...res };
  });

  /**
   * Minimal “test” endpoint for now: verifies the integration row exists + enabled.
   * Real platform-specific tests (token introspection, permission checks) will live in connectors.
   */
  app.post<{ Body: z.infer<typeof testSchema> }>("/v1/projects/integrations/test", async (req, reply) => {
    const parsed = testSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await getProjectBySlug(db, parsed.data.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
    const row = await getProjectIntegration(db, project.id, parsed.data.platform);
    if (!row) return reply.code(404).send({ ok: false, error: "not found" });
    const ok = row.is_enabled === true;
    const updated = await markIntegrationTestResult(db, project.id, parsed.data.platform, {
      ok,
      error: ok ? null : "integration_disabled",
    });
    return { ok: true, test_ok: ok, integration: updated ?? row };
  });
}

