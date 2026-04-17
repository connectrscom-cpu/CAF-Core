import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export type PublicationStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
export type PublicationContentFormat = "carousel" | "video" | "unknown";

export interface PublicationPlacementRow {
  id: string;
  project_id: string;
  task_id: string;
  content_format: PublicationContentFormat;
  platform: string;
  status: PublicationStatus;
  scheduled_at: string | null;
  published_at: string | null;
  caption_snapshot: string | null;
  title_snapshot: string | null;
  media_urls_json: unknown;
  video_url_snapshot: string | null;
  platform_post_id: string | null;
  posted_url: string | null;
  publish_error: string | null;
  external_ref: string | null;
  result_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ListPublicationsOpts {
  task_id?: string | null;
  status?: PublicationStatus | null;
  /** Only `scheduled` rows whose `scheduled_at` is null or <= now(). */
  due_only?: boolean;
  /** Only `scheduled` rows with a future `scheduled_at` (upcoming queue for operators). */
  upcoming_only?: boolean;
  platform?: string | null;
  limit?: number;
  offset?: number;
}

export async function listPublicationPlacements(
  db: Pool,
  projectId: string,
  opts: ListPublicationsOpts = {}
): Promise<PublicationPlacementRow[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const clauses: string[] = ["project_id = $1"];
  const params: unknown[] = [projectId];
  let i = 2;
  if (opts.task_id?.trim()) {
    clauses.push(`task_id = $${i++}`);
    params.push(opts.task_id.trim());
  }
  if (opts.due_only) {
    clauses.push(`status = 'scheduled'`);
    clauses.push(`(scheduled_at IS NULL OR scheduled_at <= now())`);
  } else if (opts.upcoming_only) {
    clauses.push(`status = 'scheduled'`);
    clauses.push(`scheduled_at IS NOT NULL`);
    clauses.push(`scheduled_at > now()`);
  } else if (opts.status) {
    clauses.push(`status = $${i++}`);
    params.push(opts.status);
  }
  if (opts.platform?.trim()) {
    clauses.push(`platform = $${i++}`);
    params.push(opts.platform.trim());
  }
  params.push(limit, offset);
  const orderBy = opts.due_only
    ? "ORDER BY scheduled_at ASC NULLS FIRST, created_at ASC"
    : opts.upcoming_only
      ? "ORDER BY scheduled_at ASC NULLS LAST, created_at ASC"
      : "ORDER BY scheduled_at NULLS LAST, created_at DESC";
  return q<PublicationPlacementRow>(
    db,
    `SELECT id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
            caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
            platform_post_id, posted_url, publish_error, external_ref, result_json,
            created_at, updated_at
     FROM caf_core.publication_placements
     WHERE ${clauses.join(" AND ")}
     ${orderBy}
     LIMIT $${i} OFFSET $${i + 1}`,
    params
  );
}

export async function getPublicationPlacement(
  db: Pool,
  projectId: string,
  id: string
): Promise<PublicationPlacementRow | null> {
  return qOne<PublicationPlacementRow>(
    db,
    `SELECT id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
            caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
            platform_post_id, posted_url, publish_error, external_ref, result_json,
            created_at, updated_at
     FROM caf_core.publication_placements
     WHERE project_id = $1 AND id = $2::uuid`,
    [projectId, id]
  );
}

export interface InsertPublicationPlacementInput {
  project_id: string;
  task_id: string;
  content_format: PublicationContentFormat;
  platform: string;
  status: PublicationStatus;
  scheduled_at?: string | null;
  caption_snapshot?: string | null;
  title_snapshot?: string | null;
  media_urls_json?: unknown;
  video_url_snapshot?: string | null;
}

export async function insertPublicationPlacement(
  db: Pool,
  row: InsertPublicationPlacementInput
): Promise<PublicationPlacementRow | null> {
  const mediaJson = JSON.stringify(row.media_urls_json ?? []);
  return qOne<PublicationPlacementRow>(
    db,
    `INSERT INTO caf_core.publication_placements (
       project_id, task_id, content_format, platform, status, scheduled_at,
       caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     RETURNING id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
               caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
               platform_post_id, posted_url, publish_error, external_ref, result_json,
               created_at, updated_at`,
    [
      row.project_id,
      row.task_id.trim(),
      row.content_format,
      row.platform.trim(),
      row.status,
      row.scheduled_at ?? null,
      row.caption_snapshot ?? null,
      row.title_snapshot ?? null,
      mediaJson,
      row.video_url_snapshot ?? null,
    ]
  );
}

export interface PatchPublicationPlacementInput {
  status?: PublicationStatus;
  scheduled_at?: string | null;
  caption_snapshot?: string | null;
  title_snapshot?: string | null;
  media_urls_json?: unknown;
  video_url_snapshot?: string | null;
  platform?: string;
}

export async function updatePublicationPlacement(
  db: Pool,
  projectId: string,
  id: string,
  patch: PatchPublicationPlacementInput
): Promise<PublicationPlacementRow | null> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  let n = 1;

  const add = (col: string, val: unknown) => {
    sets.push(`${col} = $${n++}`);
    params.push(val);
  };

  if (patch.status !== undefined) add("status", patch.status);
  if (patch.scheduled_at !== undefined) add("scheduled_at", patch.scheduled_at);
  if (patch.caption_snapshot !== undefined) add("caption_snapshot", patch.caption_snapshot);
  if (patch.title_snapshot !== undefined) add("title_snapshot", patch.title_snapshot);
  if (patch.media_urls_json !== undefined) add("media_urls_json", JSON.stringify(patch.media_urls_json));
  if (patch.video_url_snapshot !== undefined) add("video_url_snapshot", patch.video_url_snapshot);
  if (patch.platform !== undefined) add("platform", patch.platform.trim());

  if (sets.length === 1) {
    return getPublicationPlacement(db, projectId, id);
  }

  params.push(projectId, id);
  return qOne<PublicationPlacementRow>(
    db,
    `UPDATE caf_core.publication_placements SET ${sets.join(", ")}
     WHERE project_id = $${n++}::uuid AND id = $${n}::uuid
     RETURNING id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
               caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
               platform_post_id, posted_url, publish_error, external_ref, result_json,
               created_at, updated_at`,
    params
  );
}

export interface CompletePublicationInput {
  post_success: boolean;
  platform_post_id?: string | null;
  posted_url?: string | null;
  publish_error?: string | null;
  external_ref?: string | null;
  result_json?: Record<string, unknown>;
}

export async function completePublicationPlacement(
  db: Pool,
  projectId: string,
  id: string,
  body: CompletePublicationInput
): Promise<PublicationPlacementRow | null> {
  const success = body.post_success === true;
  const status: PublicationStatus = success ? "published" : "failed";
  const publishedAt = success ? new Date().toISOString() : null;
  const result = { ...(body.result_json ?? {}) };

  return qOne<PublicationPlacementRow>(
    db,
    `UPDATE caf_core.publication_placements SET
       status = $3,
       published_at = COALESCE($4::timestamptz, published_at),
       platform_post_id = COALESCE($5, platform_post_id),
       posted_url = COALESCE($6, posted_url),
       publish_error = COALESCE($7, publish_error),
       external_ref = COALESCE($8, external_ref),
       result_json = result_json || $9::jsonb,
       updated_at = now()
     WHERE project_id = $1::uuid AND id = $2::uuid
     RETURNING id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
               caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
               platform_post_id, posted_url, publish_error, external_ref, result_json,
               created_at, updated_at`,
    [
      projectId,
      id,
      status,
      publishedAt,
      body.platform_post_id ?? null,
      body.posted_url ?? null,
      body.publish_error ?? null,
      body.external_ref ?? null,
      JSON.stringify(result),
    ]
  );
}

/**
 * Claim a placement for execution: scheduled (optionally draft) → publishing.
 * Avoids double-runs: only updates if current row matches eligibility.
 */
export async function startPublicationPlacement(
  db: Pool,
  projectId: string,
  id: string,
  opts: { allow_not_yet_due?: boolean; allow_from_draft?: boolean } = {}
): Promise<PublicationPlacementRow | null> {
  const allowNotYetDue = opts.allow_not_yet_due === true;
  const allowDraft = opts.allow_from_draft === true;
  return qOne<PublicationPlacementRow>(
    db,
    `UPDATE caf_core.publication_placements SET status = 'publishing', updated_at = now()
     WHERE project_id = $1::uuid AND id = $2::uuid
       AND (
         (
           status = 'scheduled'
           AND (
             $3::boolean
             OR scheduled_at IS NULL
             OR scheduled_at <= now()
           )
         )
         OR ($4::boolean AND status = 'draft')
       )
     RETURNING id, project_id, task_id, content_format, platform, status, scheduled_at, published_at,
               caption_snapshot, title_snapshot, media_urls_json, video_url_snapshot,
               platform_post_id, posted_url, publish_error, external_ref, result_json,
               created_at, updated_at`,
    [projectId, id, allowNotYetDue, allowDraft]
  );
}

/** Append one successful publish to `generation_payload.publication_results` on the job. */
export async function appendPublicationResultToJob(
  db: Pool,
  projectId: string,
  taskId: string,
  entry: {
    placement_id: string;
    platform: string;
    posted_url: string | null;
    platform_post_id: string | null;
    published_at: string;
  }
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET
       generation_payload = jsonb_set(
         COALESCE(generation_payload, '{}'::jsonb),
         '{publication_results}',
         COALESCE(generation_payload->'publication_results', '[]'::jsonb) || $1::jsonb,
         true
       ),
       updated_at = now()
     WHERE project_id = $2::uuid AND task_id = $3`,
    [JSON.stringify([entry]), projectId, taskId.trim()]
  );
}

export async function deletePublicationPlacementsByTaskIds(
  db: Pool,
  projectId: string,
  taskIds: string[]
): Promise<number> {
  const ids = [...new Set(taskIds.map((t) => t.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const r = await db.query(
    `DELETE FROM caf_core.publication_placements WHERE project_id = $1 AND task_id = ANY($2::text[])`,
    [projectId, ids]
  );
  return r.rowCount ?? 0;
}

/** Removes one row. Allowed only for non-terminal / non-in-flight publish states (not publishing, not published). */
export async function deletePublicationPlacement(
  db: Pool,
  projectId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: "not_found" | "not_deletable"; status?: PublicationStatus }> {
  const row = await getPublicationPlacement(db, projectId, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "publishing" || row.status === "published") {
    return { ok: false, error: "not_deletable", status: row.status };
  }
  const r = await db.query(
    `DELETE FROM caf_core.publication_placements WHERE project_id = $1::uuid AND id = $2::uuid`,
    [projectId, id]
  );
  if ((r.rowCount ?? 0) < 1) return { ok: false, error: "not_found" };
  return { ok: true };
}
