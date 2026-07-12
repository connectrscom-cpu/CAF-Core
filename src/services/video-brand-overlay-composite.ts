/**
 * Post-render ffmpeg compositing of brand logo + slide frame onto stored VIDEO assets.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { isVideoFlow } from "../decision_engine/flow-kind.js";
import { isReviewRetainStatusDuringTextOverlayReprint } from "../domain/mimic-text-overlay-reprint.js";
import { qOne } from "../db/queries.js";
import { getContentJobByTaskId } from "../repositories/jobs.js";
import { ensureProject } from "../repositories/core.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import { parseVideoAssemblyJson, pollVideoAssemblyJob } from "./video-assembly-client.js";
import { uploadBuffer, downloadBufferFromUrl } from "./supabase-storage.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export const VIDEO_BRAND_OVERLAY_PHASE = "video_brand_overlay";

export type VideoBrandOverlayOpts = {
  logoOverlay?: { url: string; position?: string };
  frameOverlay?: { url: string; asset_id?: string };
};

type VideoAssetRow = {
  id: string;
  public_url: string | null;
  bucket: string | null;
  object_path: string | null;
  metadata_json: Record<string, unknown> | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

async function mergeJobRenderState(db: Pool, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await qOne<{ render_state: unknown }>(
    db,
    `SELECT render_state FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  const prev =
    row?.render_state && typeof row.render_state === "object" && !Array.isArray(row.render_state)
      ? { ...(row.render_state as Record<string, unknown>) }
      : {};
  await db.query(`UPDATE caf_core.content_jobs SET render_state = $1::jsonb, updated_at = now() WHERE id = $2`, [
    JSON.stringify({ ...prev, ...patch }),
    jobId,
  ]);
}

async function listVideoAssetsForTask(db: Pool, projectId: string, taskId: string): Promise<VideoAssetRow[]> {
  const rows = await db.query<{
    id: string;
    asset_type: string | null;
    public_url: string | null;
    bucket: string | null;
    object_path: string | null;
    position: number;
    metadata_json: unknown;
  }>(
    `SELECT id, asset_type, public_url, bucket, object_path, position, metadata_json
     FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
       AND UPPER(COALESCE(asset_type, '')) = 'VIDEO'
     ORDER BY position DESC, created_at DESC`,
    [projectId, taskId]
  );
  return rows.rows.map((row) => ({
    id: row.id,
    public_url: row.public_url,
    bucket: row.bucket,
    object_path: row.object_path,
    metadata_json: asRecord(row.metadata_json),
  }));
}

function pickPrimaryVideoAsset(assets: VideoAssetRow[]): VideoAssetRow | null {
  return assets[0] ?? null;
}

function sourceVideoUrl(asset: VideoAssetRow): string | null {
  const meta = asset.metadata_json ?? {};
  const pre = typeof meta.pre_overlay_public_url === "string" ? meta.pre_overlay_public_url.trim() : "";
  if (pre && /^https?:\/\//i.test(pre)) return pre;
  const pub = typeof asset.public_url === "string" ? asset.public_url.trim() : "";
  return pub && /^https?:\/\//i.test(pub) ? pub : null;
}

export async function markVideoBrandOverlayStarted(db: Pool, jobId: string): Promise<void> {
  await mergeJobRenderState(db, jobId, {
    provider: "video-assembly",
    status: "pending",
    phase: VIDEO_BRAND_OVERLAY_PHASE,
    requested_at: new Date().toISOString(),
    error: null,
    completed_at: null,
    failed_at: null,
  });
}

export async function recordVideoBrandOverlayFailure(
  db: Pool,
  job: { id: string; task_id: string; project_id: string; status: string | null },
  message: string
): Promise<void> {
  const msg = String(message ?? "").trim() || "video brand overlay failed";
  const fromState = job.status ?? "IN_REVIEW";
  const retainInReview = isReviewRetainStatusDuringTextOverlayReprint(fromState);
  await mergeJobRenderState(db, job.id, {
    provider: "video-assembly",
    status: "failed",
    phase: VIDEO_BRAND_OVERLAY_PHASE,
    error: msg.slice(0, 500),
    failed_at: new Date().toISOString(),
  });
  if (retainInReview) return;
  await db.query(`UPDATE caf_core.content_jobs SET status = $1, updated_at = now() WHERE id = $2`, ["FAILED", job.id]);
  await insertJobStateTransition(db, {
    task_id: job.task_id,
    project_id: job.project_id,
    from_state: fromState,
    to_state: "FAILED",
    triggered_by: "system",
    actor: "video-brand-overlay",
    metadata: { error: msg.slice(0, 500) },
  });
}

async function pollCompositeJob(config: AppConfig, requestId: string): Promise<{ public_url?: string }> {
  const base = config.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, "");
  return pollVideoAssemblyJob(base, requestId, config.VIDEO_ASSEMBLY_MUX_POLL_MAX_MS);
}

export async function applyVideoBrandOverlays(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string,
  opts: VideoBrandOverlayOpts
): Promise<{ public_url: string | null; restored_original: boolean }> {
  const job = await getContentJobByTaskId(db, projectId, taskId.trim());
  if (!job) throw new Error("job_not_found");
  const flowType = String(job.flow_type ?? "");
  const runId = String(job.run_id ?? "");
  const jobId = String(job.id ?? "");
  if (!isVideoFlow(flowType)) throw new Error("video_brand_overlay_requires_video_job");

  const assets = await listVideoAssetsForTask(db, projectId, taskId.trim());
  const videoAsset = pickPrimaryVideoAsset(assets);
  if (!videoAsset) throw new Error("video_asset_not_found");

  const sourceUrl = sourceVideoUrl(videoAsset);
  if (!sourceUrl) throw new Error("video_asset_missing_public_url");

  const logoUrl = opts.logoOverlay?.url?.trim() ?? "";
  const frameUrl = opts.frameOverlay?.url?.trim() ?? "";
  const logoPosition = opts.logoOverlay?.position?.trim() || "br";

  const meta = { ...(videoAsset.metadata_json ?? {}) };
  if (!meta.pre_overlay_public_url) {
    meta.pre_overlay_public_url = sourceUrl;
    if (videoAsset.object_path) meta.pre_overlay_object_path = videoAsset.object_path;
  }

  let nextPublicUrl: string | null = null;
  let nextObjectPath: string | null = null;
  let restoredOriginal = false;

  if (!logoUrl && !frameUrl) {
    nextPublicUrl = typeof meta.pre_overlay_public_url === "string" ? meta.pre_overlay_public_url : sourceUrl;
    nextObjectPath =
      typeof meta.pre_overlay_object_path === "string" ? meta.pre_overlay_object_path : videoAsset.object_path;
    restoredOriginal = true;
  } else {
    const baseUrl = config.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, "");
    const endpoint = `${baseUrl}/composite-brand-overlays?async=1`;
    const body = {
      video_url: sourceUrl,
      ...(logoUrl ? { logo_url: logoUrl, logo_position: logoPosition } : {}),
      ...(frameUrl ? { frame_url: frameUrl } : {}),
      task_id: taskId.trim(),
      run_id: runId,
    };
    const startRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const startRaw = await startRes.text();
    const startJson = parseVideoAssemblyJson(startRaw, startRes.status, "video-assembly composite-brand-overlays", endpoint) as {
      request_id?: string;
    };
    if (!startRes.ok || !startJson.request_id) {
      throw new Error(`composite_start_failed (${startRes.status}): ${startRaw.slice(0, 600)}`);
    }
    const done = await pollCompositeJob(config, startJson.request_id);
    nextPublicUrl = done.public_url?.trim() || null;
    if (!nextPublicUrl) {
      throw new Error("composite_completed_without_public_url (set SUPABASE_* on video-assembly)");
    }
    const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    nextObjectPath = `videos/${safeRun}/${safeTask}/branded_${Date.now()}.mp4`;
  }

  const mergedMeta: Record<string, unknown> = {
    ...meta,
    brand_logo_applied: Boolean(logoUrl),
    brand_frame_applied: Boolean(frameUrl),
    brand_logo_position: logoUrl ? logoPosition : null,
    brand_frame_asset_id: opts.frameOverlay?.asset_id?.trim() || null,
    brand_overlay_applied_at: new Date().toISOString(),
  };

  if (!restoredOriginal && nextPublicUrl) {
    const buf = await downloadBufferFromUrl(config, nextPublicUrl);
    const safeTask = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const objectPath = nextObjectPath ?? `videos/${safeRun}/${safeTask}/branded_${Date.now()}.mp4`;
    const up = await uploadBuffer(config, objectPath, buf, "video/mp4");
    nextPublicUrl = up.public_url;
    nextObjectPath = up.object_path;
  }

  await db.query(
    `UPDATE caf_core.assets
     SET public_url = $2,
         object_path = COALESCE($3, object_path),
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [videoAsset.id, nextPublicUrl, nextObjectPath, JSON.stringify(mergedMeta)]
  );

  await mergeJobRenderState(db, jobId, {
    provider: "video-assembly",
    status: "completed",
    phase: VIDEO_BRAND_OVERLAY_PHASE,
    completed_at: new Date().toISOString(),
    error: null,
    brand_logo_applied: Boolean(logoUrl),
    brand_frame_applied: Boolean(frameUrl),
  });

  logPipelineEvent("info", "render", "brand overlays applied to video asset", {
    task_id: taskId,
    run_id: runId,
    job_id: jobId,
    data: {
      restored_original: restoredOriginal,
      logo: Boolean(logoUrl),
      frame: Boolean(frameUrl),
    },
  });

  return { public_url: nextPublicUrl, restored_original: restoredOriginal };
}

export async function scheduleVideoBrandOverlayReprint(
  db: Pool,
  config: AppConfig,
  projectSlug: string,
  taskId: string,
  opts: VideoBrandOverlayOpts,
  log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }
): Promise<
  | { ok: true; accepted: true; task_id: string; message: string }
  | { ok: false; error: string; message?: string }
> {
  const project = await ensureProject(db, projectSlug);
  const job = await getContentJobByTaskId(db, project.id, taskId.trim());
  if (!job) return { ok: false, error: "job_not_found" };
  if (!isVideoFlow(String(job.flow_type ?? ""))) {
    return { ok: false, error: "video_brand_overlay_requires_video_job" };
  }
  const jobId = String(job.id ?? "");
  if (!jobId) return { ok: false, error: "job_missing_id" };

  await markVideoBrandOverlayStarted(db, jobId);

  void applyVideoBrandOverlays(db, config, project.id, taskId.trim(), opts)
    .then(() => {
      log.info({ task_id: taskId }, "video brand overlay reprint completed");
    })
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, task_id: taskId }, "video brand overlay reprint failed");
      try {
        await recordVideoBrandOverlayFailure(
          db,
          {
            id: jobId,
            task_id: taskId.trim(),
            project_id: project.id,
            status: String(job.status ?? "IN_REVIEW"),
          },
          msg
        );
      } catch (markErr) {
        log.error({ err: markErr, task_id: taskId }, "failed to mark video brand overlay as FAILED");
      }
    });

  return {
    ok: true,
    accepted: true,
    task_id: taskId,
    message:
      "Video brand stamp started (ffmpeg composite on stored MP4). Refresh the preview in about a minute.",
  };
}
