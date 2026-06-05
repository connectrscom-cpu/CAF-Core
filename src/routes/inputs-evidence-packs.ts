import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ensureProject } from "../repositories/core.js";
import { EVIDENCE_PACK_PLATFORMS, listEvidencePacks } from "../repositories/inputs-evidence-packs.js";
import {
  buildInputsEvidencePack,
  listEvidencePackRunOptions,
} from "../services/inputs-evidence-pack-build.js";

const slotSchema = z
  .object({
    instagram: z.string().uuid().optional(),
    tiktok: z.string().uuid().optional(),
    reddit: z.string().uuid().optional(),
    facebook: z.string().uuid().optional(),
    html: z.string().uuid().optional(),
  })
  .refine((s) => Object.values(s).some((v) => v), {
    message: "at_least_one_platform",
  });

export function registerInputsEvidencePackRoutes(app: FastifyInstance, deps: { db: Pool }) {
  const { db } = deps;

  app.get("/v1/inputs-sources/:project_slug/evidence-pack-run-options", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z
      .object({ limit_per_platform: z.coerce.number().int().min(1).max(50).default(20) })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const options = await listEvidencePackRunOptions(
      db,
      project.id,
      query.data.limit_per_platform
    );
    return { ok: true, platforms: EVIDENCE_PACK_PLATFORMS, options };
  });

  app.post("/v1/inputs-sources/:project_slug/evidence-packs", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const body = z
      .object({
        label: z.string().max(200).optional(),
        slots: slotSchema,
      })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: "bad_body", issues: body.error.issues });
    }

    const project = await ensureProject(db, params.data.project_slug);
    try {
      const result = await buildInputsEvidencePack(
        db,
        project.id,
        body.data.slots,
        body.data.label ?? null
      );
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ ok: false, error: "pack_build_failed", message: msg });
    }
  });

  app.get("/v1/inputs-sources/:project_slug/evidence-packs", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ ok: false, error: "bad_query" });

    const project = await ensureProject(db, params.data.project_slug);
    const packs = await listEvidencePacks(db, project.id, query.data.limit);
    return { ok: true, packs };
  });
}
