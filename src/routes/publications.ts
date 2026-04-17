/**
 * Publication placements — Review workbench schedules posts; n8n (or other executors) report outcomes.
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getProjectBySlug } from "../repositories/core.js";
import {
  appendPublicationResultToJob,
  completePublicationPlacement,
  deletePublicationPlacement,
  getPublicationPlacement,
  insertPublicationPlacement,
  listPublicationPlacements,
  startPublicationPlacement,
  updatePublicationPlacement,
  type PublicationContentFormat,
  type PublicationStatus,
} from "../repositories/publications.js";
import { buildPublicationN8nPayload } from "../services/publication-n8n-payload.js";
import { dryRunPublishPlacement } from "../services/publish-executors/dry-run.js";
import { publishPlacementToMeta } from "../services/meta-graph-publish.js";
import type { AppConfig } from "../config.js";

interface Deps {
  db: Pool;
  config: AppConfig;
}

const contentFormatSchema = z.enum(["carousel", "video", "unknown"]);
const statusSchema = z.enum(["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);

const createBodySchema = z.object({
  task_id: z.string().min(1),
  platform: z.string().min(1),
  content_format: contentFormatSchema.optional(),
  status: statusSchema.optional(),
  scheduled_at: z.string().nullable().optional(),
  caption_snapshot: z.string().nullable().optional(),
  title_snapshot: z.string().nullable().optional(),
  media_urls_json: z.array(z.string()).optional(),
  video_url_snapshot: z.string().nullable().optional(),
});

const patchBodySchema = z.object({
  status: statusSchema.optional(),
  scheduled_at: z.string().nullable().optional(),
  caption_snapshot: z.string().nullable().optional(),
  title_snapshot: z.string().nullable().optional(),
  media_urls_json: z.array(z.string()).optional(),
  video_url_snapshot: z.string().nullable().optional(),
  platform: z.string().optional(),
});

const completeBodySchema = z.object({
  post_success: z.boolean(),
  platform_post_id: z.string().nullable().optional(),
  posted_url: z.string().nullable().optional(),
  publish_error: z.string().nullable().optional(),
  external_ref: z.string().nullable().optional(),
  result_json: z.record(z.unknown()).optional(),
});

const startBodySchema = z.object({
  allow_not_yet_due: z.boolean().optional(),
  allow_from_draft: z.boolean().optional(),
});

function rowToJson(row: Awaited<ReturnType<typeof getPublicationPlacement>>) {
  if (!row) return null;
  return {
    id: row.id,
    task_id: row.task_id,
    content_format: row.content_format,
    platform: row.platform,
    status: row.status,
    scheduled_at: row.scheduled_at,
    published_at: row.published_at,
    caption_snapshot: row.caption_snapshot,
    title_snapshot: row.title_snapshot,
    media_urls_json: row.media_urls_json,
    video_url_snapshot: row.video_url_snapshot,
    platform_post_id: row.platform_post_id,
    posted_url: row.posted_url,
    publish_error: row.publish_error,
    external_ref: row.external_ref,
    result_json: row.result_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerPublicationRoutes(app: FastifyInstance, { db, config }: Deps) {
  app.get<{ Params: { project_slug: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/publications/:project_slug",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const task_id = req.query.task_id?.trim() || undefined;
      const status = req.query.status as PublicationStatus | undefined;
      const due_only = req.query.due_only === "1" || req.query.due_only === "true";
      const platform = req.query.platform?.trim() || undefined;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

      const rows = await listPublicationPlacements(db, project.id, {
        task_id: task_id ?? null,
        status:
          due_only ? undefined : status && statusSchema.safeParse(status).success ? status : undefined,
        due_only,
        platform: platform ?? null,
        limit: Number.isFinite(limit) ? limit : 100,
        offset: Number.isFinite(offset) ? offset : 0,
      });

      return {
        ok: true,
        placements: rows.map((r) => rowToJson(r)!),
        due_only,
      };
    }
  );

  app.get<{ Params: { project_slug: string; id: string } }>(
    "/v1/publications/:project_slug/:id/n8n-payload",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const row = await getPublicationPlacement(db, project.id, req.params.id);
      if (!row) return reply.code(404).send({ ok: false, error: "not found" });
      return { ok: true, payload: buildPublicationN8nPayload(row, project.slug) };
    }
  );

  app.post<{
    Params: { project_slug: string; id: string };
    Body: z.infer<typeof startBodySchema>;
  }>("/v1/publications/:project_slug/:id/start", async (req, reply) => {
    const project = await getProjectBySlug(db, req.params.project_slug);
    if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

    const parsed = startBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }

    const row = await startPublicationPlacement(db, project.id, req.params.id, {
      allow_not_yet_due: parsed.data.allow_not_yet_due,
      allow_from_draft: parsed.data.allow_from_draft,
    });
    if (!row) {
      const current = await getPublicationPlacement(db, project.id, req.params.id);
      const serverTimeUtc = new Date().toISOString();
      const scheduledAt = current?.scheduled_at ?? null;
      const scheduledLabel = scheduledAt ? new Date(scheduledAt).toISOString() : "none";
      const status = current?.status ?? "unknown";

      let hint = "";
      if (current) {
        if (status === "scheduled" && scheduledAt && new Date(scheduledAt) > new Date()) {
          hint = ` Not due yet: scheduled_at (UTC) is ${scheduledLabel}; server now (UTC) is ${serverTimeUtc}. Use allow_not_yet_due=true to start early, or wait until that time.`;
        } else if (status === "publishing") {
          hint = ` Placement is already in status "publishing" (likely claimed). server_time_utc=${serverTimeUtc}.`;
        } else if (status === "published") {
          hint = ` Placement is already published. server_time_utc=${serverTimeUtc}.`;
        } else if (status === "draft" && !parsed.data.allow_from_draft) {
          hint = ` Placement is "draft"; pass allow_from_draft=true to start. server_time_utc=${serverTimeUtc}.`;
        } else if (status === "failed" || status === "cancelled") {
          hint = ` Placement status is "${status}" (not startable). server_time_utc=${serverTimeUtc}.`;
        } else {
          hint = ` Current status="${status}", scheduled_at (UTC)=${scheduledLabel}, server_time_utc=${serverTimeUtc}.`;
        }
      } else {
        hint = ` No placement row found for this id (UTC now ${serverTimeUtc}).`;
      }

      return reply.code(409).send({
        ok: false,
        error: "cannot_start",
        message:
          "Placement not in a startable state, scheduled time not reached, or already claimed. Use allow_not_yet_due / allow_from_draft if appropriate." +
          hint,
        status,
        scheduled_at: scheduledAt,
        server_time_utc: serverTimeUtc,
      });
    }

    if (config.CAF_PUBLISH_EXECUTOR === "dry_run") {
      const result = dryRunPublishPlacement(row);
      const completed = await completePublicationPlacement(db, project.id, row.id, {
        post_success: true,
        platform_post_id: result.platform_post_id,
        posted_url: result.posted_url,
        result_json: result.result_json,
        external_ref: "caf_core_dry_run",
      });
      if (completed) {
        await appendPublicationResultToJob(db, project.id, completed.task_id, {
          placement_id: completed.id,
          platform: completed.platform,
          posted_url: completed.posted_url,
          platform_post_id: completed.platform_post_id,
          published_at: completed.published_at ?? new Date().toISOString(),
        }).catch(() => {});
      }
      return {
        ok: true,
        placement: rowToJson(completed ?? row),
        payload: buildPublicationN8nPayload(completed ?? row, project.slug),
        executor: "dry_run",
      };
    }

    if (config.CAF_PUBLISH_EXECUTOR === "meta") {
      const graphVersion = config.META_GRAPH_API_VERSION?.trim() || "v21.0";
      const pub = await publishPlacementToMeta(db, row, project.id, graphVersion, {
        pageAccessTokenFromEnv: config.CAF_META_PAGE_ACCESS_TOKEN,
      });
      if (!pub.ok) {
        const failed = await completePublicationPlacement(db, project.id, row.id, {
          post_success: false,
          publish_error: pub.error,
          result_json: { executor: "meta", error: pub.error },
          external_ref: "caf_core_meta_failed",
        });
        return reply.code(502).send({
          ok: false,
          error: "meta_publish_failed",
          message: pub.error,
          placement: rowToJson(failed ?? row),
          executor: "meta",
        });
      }
      const completed = await completePublicationPlacement(db, project.id, row.id, {
        post_success: true,
        platform_post_id: pub.platform_post_id,
        posted_url: pub.posted_url,
        result_json: pub.result_json,
        external_ref: "caf_core_meta",
      });
      if (completed) {
        await appendPublicationResultToJob(db, project.id, completed.task_id, {
          placement_id: completed.id,
          platform: completed.platform,
          posted_url: completed.posted_url,
          platform_post_id: completed.platform_post_id,
          published_at: completed.published_at ?? new Date().toISOString(),
        }).catch(() => {});
      }
      return {
        ok: true,
        placement: rowToJson(completed ?? row),
        payload: buildPublicationN8nPayload(completed ?? row, project.slug),
        executor: "meta",
      };
    }

    return {
      ok: true,
      placement: rowToJson(row),
      payload: buildPublicationN8nPayload(row, project.slug),
      executor: "external",
    };
  });

  app.post<{ Params: { project_slug: string; id: string }; Body: z.infer<typeof completeBodySchema> }>(
    "/v1/publications/:project_slug/:id/complete",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const parsed = completeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }

      const existing = await getPublicationPlacement(db, project.id, req.params.id);
      if (!existing) return reply.code(404).send({ ok: false, error: "not found" });

      const row = await completePublicationPlacement(db, project.id, req.params.id, parsed.data);
      if (parsed.data.post_success === true && row) {
        await appendPublicationResultToJob(db, project.id, row.task_id, {
          placement_id: row.id,
          platform: row.platform,
          posted_url: row.posted_url,
          platform_post_id: row.platform_post_id,
          published_at: row.published_at ?? new Date().toISOString(),
        }).catch(() => {});
      }

      return { ok: true, placement: rowToJson(row) };
    }
  );

  app.get<{ Params: { project_slug: string; id: string } }>(
    "/v1/publications/:project_slug/:id",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });
      const row = await getPublicationPlacement(db, project.id, req.params.id);
      if (!row) return reply.code(404).send({ ok: false, error: "not found" });
      return { ok: true, placement: rowToJson(row) };
    }
  );

  app.post<{ Params: { project_slug: string }; Body: z.infer<typeof createBodySchema> }>(
    "/v1/publications/:project_slug",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const parsed = createBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }

      const b = parsed.data;
      const fmt = (b.content_format ?? "unknown") as PublicationContentFormat;
      let status: PublicationStatus = b.status ?? "scheduled";
      if (!b.status && !b.scheduled_at) status = "draft";

      const row = await insertPublicationPlacement(db, {
        project_id: project.id,
        task_id: b.task_id,
        content_format: fmt,
        platform: b.platform,
        status,
        scheduled_at: b.scheduled_at ?? null,
        caption_snapshot: b.caption_snapshot ?? null,
        title_snapshot: b.title_snapshot ?? null,
        media_urls_json: b.media_urls_json ?? [],
        video_url_snapshot: b.video_url_snapshot ?? null,
      });

      return { ok: true, placement: rowToJson(row) };
    }
  );

  app.patch<{ Params: { project_slug: string; id: string }; Body: z.infer<typeof patchBodySchema> }>(
    "/v1/publications/:project_slug/:id",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const parsed = patchBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
      }

      const existing = await getPublicationPlacement(db, project.id, req.params.id);
      if (!existing) return reply.code(404).send({ ok: false, error: "not found" });

      const row = await updatePublicationPlacement(db, project.id, req.params.id, parsed.data);
      return { ok: true, placement: rowToJson(row) };
    }
  );

  app.delete<{ Params: { project_slug: string; id: string } }>(
    "/v1/publications/:project_slug/:id",
    async (req, reply) => {
      const project = await getProjectBySlug(db, req.params.project_slug);
      if (!project) return reply.code(404).send({ ok: false, error: "project not found" });

      const result = await deletePublicationPlacement(db, project.id, req.params.id);
      if (!result.ok) {
        if (result.error === "not_found") {
          return reply.code(404).send({ ok: false, error: "not_found" });
        }
        return reply.code(409).send({
          ok: false,
          error: "not_deletable",
          message: `Cannot delete placement in status "${result.status}" (only draft, scheduled, failed, or cancelled).`,
          status: result.status,
        });
      }
      return { ok: true, deleted: true };
    }
  );
}
