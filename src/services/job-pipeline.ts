/**
 * Job Pipeline — processes content_jobs through lifecycle stages.
 *
 * PLANNED → GENERATING → (GENERATED) → QC → diagnostic → RENDERING → IN_REVIEW (or BLOCKED / …); APPROVED only via human review
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { q, qOne } from "../db/queries.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import { incrementRunJobsCompleted, updateRunStatus, getRunById, getRunByRunId, type RunRow } from "../repositories/runs.js";
import { generateForJob } from "./llm-generator.js";
import { runQcForJob } from "./qc-runtime.js";
import { runDiagnosticAudit } from "./diagnostic-runner.js";
import {
  routeJobAfterQc,
  finalJobStatusAfterRender,
} from "./validation-router.js";
import { uploadBuffer } from "./supabase-storage.js";
import { insertAsset, deleteAssetsForTask } from "../repositories/assets.js";
import { getProjectById } from "../repositories/core.js";
import { getStrategyDefaults } from "../repositories/project-config.js";
import {
  carouselSlideCount,
  buildSlideRenderContext,
  slidesFromGeneratedOutput,
  pickCarouselTemplateForRender,
  slideHasRenderableContent,
  stripNonRenderableDeckFields,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { runHeygenForContentJob } from "./heygen-renderer.js";
import { ensureVideoScriptInPayload } from "./video-script-generator.js";
import { ensureVideoPromptInPayload } from "./video-prompt-generator.js";
import { pollVideoAssemblyJob, runScenePipeline } from "./scene-pipeline.js";
import { warmupRenderer } from "./renderer-warmup.js";
import { warnIfRendererBaseUrlIsCafCore } from "./renderer-url-guard.js";
import { isOfflinePipelineFlow } from "./offline-flow-types.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { insertRunContentOutcome } from "../repositories/run-content-outcomes.js";
import { HeygenPollTimeoutError } from "./heygen-renderer.js";
import { SoraPollTimeoutError } from "./sora-scene-clips.js";

export interface PipelineConfig {
  rendererBaseUrl: string;
  videoAssemblyBaseUrl: string;
  carouselRendererSlideTimeoutMs: number;
  carouselRendererSlideRetryAttempts: number;
}

export function getPipelineConfig(config: AppConfig): PipelineConfig {
  return {
    rendererBaseUrl: config.RENDERER_BASE_URL.replace(/\/$/, ""),
    videoAssemblyBaseUrl: config.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, ""),
    carouselRendererSlideTimeoutMs: config.CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS,
    carouselRendererSlideRetryAttempts: config.CAROUSEL_RENDERER_SLIDE_RETRY_ATTEMPTS,
  };
}

type JobRow = {
  id: string;
  task_id: string;
  flow_type: string;
  status: string;
  project_id: string;
  run_id: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
  /** Optional — only loaded by call sites that need to make resume/retry decisions (processRunJobs). */
  render_state?: Record<string, unknown> | null;
};

/**
 * Video RENDERING job is safe to re-enter from the run-level pre-render scan when no HeyGen `video_id`
 * or `session_id` was ever persisted (i.e. worker died mid-submit, render_state stuck at `phase: starting`
 * or empty). When a HeyGen id IS present we must NOT retry — the prior submission may still be in flight
 * and re-submitting double-bills HeyGen credits and creates orphaned videos.
 */
function isVideoRenderingSafelyRetryable(j: JobRow): boolean {
  if (j.status !== "RENDERING") return false;
  if (isCarouselFlow(j.flow_type)) return false;
  if (isOfflinePipelineFlow(j.flow_type)) return false;
  if (!isVideoFlow(j.flow_type)) return false;
  const rs =
    j.render_state && typeof j.render_state === "object" && !Array.isArray(j.render_state)
      ? (j.render_state as Record<string, unknown>)
      : {};
  const videoId = String(rs.video_id ?? "").trim();
  const sessionId = String(rs.session_id ?? "").trim();
  if (videoId || sessionId) return false;
  const phase = String(rs.phase ?? "").trim().toLowerCase();
  /** Empty render_state, "starting", or explicit "failed" with no resume key — safe to re-enter. Avoid retrying mid-stream phases like "polling" / "sora_polling" / "submitted" that imply a HeyGen/Sora id should already exist. */
  if (phase === "" || phase === "starting" || phase === "failed") return true;
  return false;
}

/** Video poll timeouts — job stays RENDERING; caller may retry. Do not mark FAILED. */
export class RenderNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderNotReadyError";
  }
}

type PreRenderStep =
  | { kind: "terminal" }
  | { kind: "render_carousel"; recommended_route: string | null }
  | { kind: "render_video"; recommended_route: string | null };

type RenderTicket = {
  jobId: string;
  task_id: string;
  kind: "carousel" | "video";
  recommended_route: string | null;
};

async function markJobFailedPipeline(
  db: Pool,
  run: RunRow,
  taskId: string,
  jobId: string,
  msg: string,
  errors: string[]
): Promise<void> {
  errors.push(`${taskId}: ${msg}`);
  const prior = await qOne<{ status: string }>(
    db,
    `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  await updateJobStatus(db, jobId, "FAILED");
  await insertJobStateTransition(db, {
    task_id: taskId,
    project_id: run.project_id,
    from_state: prior?.status ?? "GENERATING",
    to_state: "FAILED",
    triggered_by: "system",
    actor: "job-pipeline",
    metadata: { error: msg },
  });
}

async function reloadJobRow(db: Pool, jobId: string): Promise<JobRow | null> {
  return qOne<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload
     FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
}

async function processJobUpToRender(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  _pipeConfig: PipelineConfig
): Promise<PreRenderStep> {
  if (isOfflinePipelineFlow(job.flow_type)) {
    return { kind: "terminal" };
  }

  const openaiKey = config.OPENAI_API_KEY;
  const openaiModel = config.OPENAI_MODEL ?? "gpt-4o";

  if (job.status === "PLANNED") {
    await advanceToGenerating(db, job, run);
  }

  const payloadSnap = await qOne<{ generation_payload: Record<string, unknown> }>(
    db,
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const hasGenerated = Boolean(payloadSnap?.generation_payload?.generated_output);

  if (openaiKey && !hasGenerated) {
    const genResult = await generateForJob(db, job.id, openaiKey, openaiModel, {
      skipOutputSchemaValidation: config.CAF_SKIP_OUTPUT_SCHEMA_VALIDATION,
    });
    if (!genResult.success) {
      throw new Error(`LLM generation failed: ${genResult.error}`);
    }
    await updateJobStatus(db, job.id, "GENERATED");
    if (run) {
      await insertJobStateTransition(db, {
        task_id: job.task_id,
        project_id: run.project_id,
        from_state: "GENERATING",
        to_state: "GENERATED",
        triggered_by: "system",
        actor: "job-pipeline",
      });
    }
  }

  const qcResult = await runQcForJob(db, job.id, config.CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC);

  if (!qcResult.qc_passed && qcResult.recommended_route === "BLOCKED") {
    await updateJobStatus(db, job.id, "BLOCKED");
    return { kind: "terminal" };
  }

  // If QC fails but the router wants HUMAN_REVIEW, skip media for non-carousel flows (often incomplete JSON).
  // Carousel jobs still run the renderer when possible so review queue rows get slide thumbnails in `assets`.
  if (!qcResult.qc_passed && qcResult.recommended_route === "HUMAN_REVIEW") {
    if (!isCarouselFlow(job.flow_type)) {
      await advanceToInReview(db, job, run, qcResult.recommended_route);
      return { kind: "terminal" };
    }
  }

  const earlyStop = await routeJobAfterQc(db, job.id, qcResult.recommended_route);
  if (earlyStop !== "none") {
    if (run) {
      await insertJobStateTransition(db, {
        task_id: job.task_id,
        project_id: run.project_id,
        from_state: "GENERATED",
        to_state: earlyStop === "discard" ? "REJECTED" : "NEEDS_EDIT",
        triggered_by: "system",
        actor: "validation-router",
      });
    }
    return { kind: "terminal" };
  }

  await runDiagnosticAudit(db, job.id);

  const route = qcResult.recommended_route;
  if (isCarouselFlow(job.flow_type)) {
    return { kind: "render_carousel", recommended_route: route };
  }
  if (isVideoFlow(job.flow_type)) {
    return { kind: "render_video", recommended_route: route };
  }
  await advanceToInReview(db, job, run, route);
  return { kind: "terminal" };
}

async function processOneJob(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  pipeConfig: PipelineConfig
): Promise<void> {
  const step = await processJobUpToRender(db, config, job, run, pipeConfig);
  if (step.kind === "terminal") {
    return;
  }
  const jobForMedia = (await reloadJobRow(db, job.id)) ?? job;
  if (step.kind === "render_carousel") {
    await processCarouselJob(db, config, pipeConfig, jobForMedia, run, step.recommended_route);
  } else {
    await processVideoJob(db, config, pipeConfig, jobForMedia, run, step.recommended_route);
  }
}

/**
 * Run full pipeline for one job by primary key (used by rework orchestrator).
 */
export async function processContentJobById(
  db: Pool,
  config: AppConfig,
  jobId: string
): Promise<void> {
  const job = await qOne<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload
     FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const run = await getRunByRunId(db, job.project_id, job.run_id);
  const pipeConfig = getPipelineConfig(config);
  try {
    await processOneJob(db, config, job, run, pipeConfig);
  } catch (err) {
    // Same as `processJobByTaskId`: render/LLM failures must not leave the job stuck in RENDERING.
    if (err instanceof RenderNotReadyError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const prior = await qOne<{ status: string }>(db, `SELECT status FROM caf_core.content_jobs WHERE id = $1`, [jobId]);
    await updateJobStatus(db, jobId, "FAILED");
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: job.project_id,
      from_state: prior?.status ?? job.status,
      to_state: "FAILED",
      triggered_by: "system",
      actor: "job-pipeline",
      metadata: { error: msg },
    });
    throw err;
  }
}

export async function processRunJobs(
  db: Pool,
  config: AppConfig,
  runUuid: string
): Promise<{ processed: number; errors: string[] }> {
  const run = await getRunById(db, runUuid);
  if (!run) throw new Error(`Run not found: ${runUuid}`);

  const jobs = await q<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload, render_state
       FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('PLANNED', 'GENERATING', 'GENERATED', 'RENDERING')
     ORDER BY created_at`,
    [run.project_id, run.run_id]
  );

  /**
   * Include GENERATED: after LLM+QC the job stays GENERATED until the render lane runs; if the worker dies
   * between the pre-render loop and carouselLane (or the HTTP request is cut off), the next Process must
   * still see those rows. Retry carousel jobs left in RENDERING (mid-slide), and retry video jobs ONLY
   * when no HeyGen `video_id` / `session_id` was ever persisted (worker died before the long poll started).
   * Never retry video RENDERING jobs that already have a HeyGen id — that submission may still be in flight
   * and re-submitting double-bills HeyGen credits.
   */
  const jobsToRun = jobs.filter(
    (j) =>
      j.status !== "RENDERING" ||
      (isCarouselFlow(j.flow_type) && !isOfflinePipelineFlow(j.flow_type)) ||
      isVideoRenderingSafelyRetryable(j)
  );

  /** Carousels first in the pre-render pass so tickets queue as [carousel…, video…]; render phase runs all carousels, then all videos, one job at a time. */
  const isCar = (j: JobRow) => isCarouselFlow(j.flow_type) && !isOfflinePipelineFlow(j.flow_type);
  jobsToRun.sort((a, b) => Number(isCar(b)) - Number(isCar(a)));

  const pipeConfig = getPipelineConfig(config);
  let processed = 0;
  const errors: string[] = [];
  const renderTickets: RenderTicket[] = [];

  for (const job of jobsToRun) {
    if (isOfflinePipelineFlow(job.flow_type)) {
      continue;
    }
    try {
      const step = await processJobUpToRender(db, config, job, run, pipeConfig);
      if (step.kind === "terminal") {
        await incrementRunJobsCompleted(db, runUuid);
        processed++;
      } else {
        renderTickets.push({
          jobId: job.id,
          task_id: job.task_id,
          kind: step.kind === "render_carousel" ? "carousel" : "video",
          recommended_route: step.recommended_route,
        });
      }
    } catch (err) {
      if (err instanceof RenderNotReadyError) {
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await markJobFailedPipeline(db, run, job.task_id, job.id, msg, errors);
    }
  }

  const carouselTickets = renderTickets.filter((t) => t.kind === "carousel");
  const videoTickets = renderTickets.filter((t) => t.kind === "video");

  if (carouselTickets.length > 0) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  const runOneRender = async (t: RenderTicket) => {
    const jobRow = await reloadJobRow(db, t.jobId);
    if (!jobRow) throw new Error(`Job disappeared: ${t.task_id}`);
    if (t.kind === "carousel") {
      await processCarouselJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    } else {
      await processVideoJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    }
  };

  const carouselLane = async () => {
    for (const t of carouselTickets) {
      try {
        await runOneRender(t);
        const refreshed = await qOne<{ status: string }>(
          db,
          `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
          [t.jobId]
        );
        if (refreshed?.status !== "RENDERING") {
          await incrementRunJobsCompleted(db, runUuid);
          processed++;
        }
      } catch (err) {
        if (err instanceof RenderNotReadyError) {
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    }
  };

  const videoLane = async () => {
    for (const t of videoTickets) {
      try {
        await runOneRender(t);
        const refreshed = await qOne<{ status: string }>(
          db,
          `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
          [t.jobId]
        );
        if (refreshed?.status !== "RENDERING") {
          await incrementRunJobsCompleted(db, runUuid);
          processed++;
        }
      } catch (err) {
        if (err instanceof RenderNotReadyError) {
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    }
  };

  await carouselLane();
  await videoLane();

  const pendingRows = await q<{ flow_type: string }>(
    db,
    `SELECT flow_type FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('PLANNED','GENERATING','GENERATED','RENDERING')`,
    [run.project_id, run.run_id]
  );
  const pendingCount = pendingRows.filter((r) => !isOfflinePipelineFlow(r.flow_type)).length;

  if (pendingCount === 0) {
    await updateRunStatus(db, runUuid, "REVIEWING");
  }

  return { processed, errors };
}

export async function processJobByTaskId(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<{ status: string; skipped?: boolean }> {
  const job = await qOne<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) throw new Error(`Job not found: ${taskId}`);

  if (isOfflinePipelineFlow(job.flow_type)) {
    return { status: job.status, skipped: true };
  }

  const run = await getRunByRunId(db, projectId, job.run_id);
  const pipeConfig = getPipelineConfig(config);

  if (isCarouselFlow(job.flow_type)) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  try {
    await processOneJob(db, config, job, run, pipeConfig);
  } catch (err) {
    if (err instanceof RenderNotReadyError) {
      const updated = await qOne<{ status: string }>(
        db,
        `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
        [job.id]
      );
      return { status: updated?.status ?? "RENDERING" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const prior = await qOne<{ status: string }>(db, `SELECT status FROM caf_core.content_jobs WHERE id = $1`, [job.id]);
    await updateJobStatus(db, job.id, "FAILED");
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: projectId,
      from_state: prior?.status ?? job.status,
      to_state: "FAILED",
      triggered_by: "system",
      actor: "job-pipeline",
      metadata: { error: msg },
    });
    throw err;
  }

  const updated = await qOne<{ status: string }>(db, `SELECT status FROM caf_core.content_jobs WHERE id = $1`, [job.id]);
  return { status: updated?.status ?? "UNKNOWN" };
}

/** Keys removed from `generation_payload` so the next pipeline pass treats the job as never generated. */
const FULL_RERUN_GENERATION_PAYLOAD_DROP_KEYS = [
  "generated_output",
  "qc_result",
  "draft_id",
  "publish_media_urls_json",
  "publish_media_urls",
] as const;

const REWORK_HISTORY_MAX_ENTRIES = 25;

export interface ReworkHistoryEntry {
  archived_at: string;
  kind: "full_rerun_reset" | "before_override_rework";
  draft_id?: unknown;
  generated_output?: unknown;
  qc_result?: unknown;
}

export function appendReworkHistory(
  gp: Record<string, unknown>,
  entry: Omit<ReworkHistoryEntry, "archived_at"> & { archived_at?: string }
): void {
  const raw = gp.rework_history;
  const list: ReworkHistoryEntry[] = Array.isArray(raw) ? [...raw] : [];
  const next: ReworkHistoryEntry = {
    archived_at: entry.archived_at ?? new Date().toISOString(),
    kind: entry.kind,
    draft_id: entry.draft_id,
    generated_output: entry.generated_output,
    qc_result: entry.qc_result,
  };
  list.push(next);
  while (list.length > REWORK_HISTORY_MAX_ENTRIES) list.shift();
  gp.rework_history = list;
}

/**
 * Reset one job to a clean PLANNED state: drop generated output / QC from payload, clear render & scene state,
 * remove assets and machine audits. Does not delete editorial reviews or job_drafts (history).
 * Archives the previous `generated_output` (and related keys) into `generation_payload.rework_history`.
 */
export async function prepareContentJobForFullRerun(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = taskId.trim();
  if (!tid) return { ok: false, error: "task_id required" };

  const job = await qOne<{
    id: string;
    task_id: string;
    status: string | null;
    flow_type: string | null;
  }>(
    db,
    `SELECT id, task_id, status, flow_type FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, tid]
  );
  if (!job) return { ok: false, error: "job_not_found" };
  if (isOfflinePipelineFlow(job.flow_type ?? "")) {
    return { ok: false, error: "offline_flow_not_supported" };
  }

  await deleteAssetsForTask(db, projectId, tid);
  await db.query(`DELETE FROM caf_core.diagnostic_audits WHERE project_id = $1 AND task_id = $2`, [
    projectId,
    tid,
  ]);
  await db.query(`DELETE FROM caf_core.auto_validation_results WHERE project_id = $1 AND task_id = $2`, [
    projectId,
    tid,
  ]);

  const snap = await qOne<{ generation_payload: Record<string, unknown> }>(
    db,
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp: Record<string, unknown> = { ...(snap?.generation_payload ?? {}) };
  const hadVersion =
    gp.generated_output != null || gp.draft_id != null || gp.qc_result != null;
  if (hadVersion) {
    appendReworkHistory(gp, {
      kind: "full_rerun_reset",
      draft_id: gp.draft_id ?? null,
      generated_output: gp.generated_output,
      qc_result: gp.qc_result ?? null,
    });
  }
  for (const k of FULL_RERUN_GENERATION_PAYLOAD_DROP_KEYS) {
    delete gp[k];
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET
      status = 'PLANNED',
      recommended_route = NULL,
      qc_status = NULL,
      render_provider = NULL,
      render_status = NULL,
      render_job_id = NULL,
      asset_id = NULL,
      render_state = '{}'::jsonb,
      scene_bundle_state = '{}'::jsonb,
      generation_payload = $1::jsonb,
      updated_at = now()
    WHERE id = $2`,
    [JSON.stringify(gp), job.id]
  );

  await insertJobStateTransition(db, {
    task_id: job.task_id,
    project_id: projectId,
    from_state: job.status,
    to_state: "PLANNED",
    triggered_by: "system",
    actor: "full-job-rerun-reset",
    metadata: { cleared_for_full_pipeline: true },
  });

  return { ok: true };
}

/** Reset job (see `prepareContentJobForFullRerun`) then run the standard pipeline (LLM → QC → render / review). */
export async function reprocessJobFromScratch(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<{ status: string; skipped?: boolean }> {
  const prep = await prepareContentJobForFullRerun(db, projectId, taskId.trim());
  if (!prep.ok) throw new Error(prep.error);
  return processJobByTaskId(db, config, projectId, taskId.trim());
}

/** Prompt-led vs script-led HeyGen prep: one LLM path per flow name; legacy video flows still run both. */
async function ensureHeygenPayloadForFlowType(
  db: Pool,
  config: AppConfig,
  flowType: string,
  jobId: string
): Promise<void> {
  const ft = flowType ?? "";
  // Legacy flow names + Flow Engine: Video_Prompt_Generator (avatar mode via heygen_config)
  if (/no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)) {
    const r = await ensureVideoPromptInPayload(db, config, jobId);
    if (!r.ok) throw new Error(r.error ?? "video prompt prep failed");
    return;
  }
  if (/video_script|script_generator/i.test(ft)) {
    const r = await ensureVideoScriptInPayload(db, config, jobId);
    if (!r.ok) throw new Error(r.error ?? "video script prep failed");
    return;
  }
  if (/video_prompt|prompt_generator/i.test(ft)) {
    const r = await ensureVideoPromptInPayload(db, config, jobId);
    if (!r.ok) throw new Error(r.error ?? "video prompt prep failed");
    return;
  }
  const a = await ensureVideoScriptInPayload(db, config, jobId);
  const b = await ensureVideoPromptInPayload(db, config, jobId);
  if (!a.ok && !b.ok) {
    throw new Error(`Video prep failed — script: ${a.error ?? "unknown"}; prompt: ${b.error ?? "unknown"}`);
  }
}

async function advanceToGenerating(
  db: Pool,
  job: { id: string; task_id: string; status: string },
  run: RunRow | null
) {
  await updateJobStatus(db, job.id, "GENERATING");
  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: job.status,
      to_state: "GENERATING",
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }
}

async function advanceToInReview(
  db: Pool,
  job: { id: string; task_id: string },
  run: RunRow | null,
  recommendedRoute: string | null
) {
  const st = finalJobStatusAfterRender(recommendedRoute);
  await updateJobStatus(db, job.id, st);
  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "GENERATED",
      to_state: st,
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }
}

/**
 * A hung renderer can send headers then never finish the PNG body; AbortSignal on fetch alone may not
 * bound body consumption. This caps time on arrayBuffer() as well.
 */
async function readResponseBodyWithTimeout(
  response: Response,
  timeoutMs: number,
  label: string
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(
      () => reject(new Error(`${label}: reading PNG body timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    response
      .arrayBuffer()
      .then((ab) => {
        clearTimeout(to);
        resolve(ab);
      })
      .catch((e) => {
        clearTimeout(to);
        reject(e);
      });
  });
}

/** Puppeteer/Chromium on small Fly machines often throws these on cold tabs or memory pressure. */
const TRANSIENT_CAROUSEL_RENDERER_ERR =
  /Target closed|createTarget|Failed to open a new tab|Protocol error|Browser disconnected|Session closed|ECONNRESET|socket hang up|Navigation failed/i;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRendererUnavailableHttpError(msg: string): boolean {
  const m = String(msg ?? "");
  // job-pipeline wraps non-OK responses as: `Renderer slide ${i} returned ${status}: ...`
  return /Renderer slide \d+ returned (502|503|504):/i.test(m);
}

async function recordRunContentOutcomeSafe(
  db: Pool,
  row: Parameters<typeof insertRunContentOutcome>[1]
): Promise<void> {
  try {
    await insertRunContentOutcome(db, row);
  } catch (e) {
    console.warn("[job-pipeline] run_content_outcomes insert failed", e);
  }
}

/**
 * After we have usable slide rows, drop other deck-shaped fields so `pickBestSlideDeck` / `slide_count`
 * cannot pick empty stubs or inflate PNG count past real copy.
 */
function carouselRenderBaseForPipeline(
  baseRender: Record<string, unknown>,
  usableSlides: Record<string, unknown>[]
): Record<string, unknown> {
  const o: Record<string, unknown> = { ...baseRender, slides: usableSlides };
  delete o.slide_deck;
  delete o.variation;
  delete o.variations;
  delete o.carousel;
  delete o.items;
  const content = o.content;
  if (content && typeof content === "object" && !Array.isArray(content) && "carousel" in content) {
    const c = { ...(content as Record<string, unknown>) };
    delete c.carousel;
    if (Object.keys(c).length > 0) o.content = c;
    else delete o.content;
  }
  return o;
}

function carouselOutcomeSummary(job: JobRow, template: string, usableSlides: Record<string, unknown>[], objectPaths: string[]) {
  const slide_headlines = usableSlides.slice(0, 12).map((s) => {
    const rec = s as Record<string, unknown>;
    const h = rec.headline ?? rec.title ?? rec.slide_title ?? rec.heading;
    return String(h ?? "").slice(0, 160);
  });
  return {
    platform: job.platform,
    template,
    slide_headlines,
    object_paths_sample: objectPaths.slice(0, 6),
  };
}

function videoOutcomeSummary(job: JobRow, gen: Record<string, unknown>, provider: string) {
  const script = gen.video_script ?? gen.script;
  let script_preview = "";
  if (typeof script === "string") script_preview = script.slice(0, 520);
  else if (script && typeof script === "object") script_preview = JSON.stringify(script).slice(0, 520);
  return {
    platform: job.platform,
    flow_type: job.flow_type,
    provider,
    production_route: gen.production_route,
    script_preview,
  };
}

async function countAssetsForTask(db: Pool, projectId: string, taskId: string): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM caf_core.assets WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  const n = parseInt(row?.n ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * POST /render-binary with retries on transient 5xx (typical remote renderer flakiness).
 */
async function postCarouselRenderBinary(
  renderUrl: string,
  body: object,
  timeoutMs: number,
  slideIndex: number,
  maxRetries: number
): Promise<Response> {
  let lastErrMsg = `Renderer slide ${slideIndex} request failed`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(renderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const name = e instanceof Error ? e.name : "";
      lastErrMsg = `Renderer slide ${slideIndex} request failed: ${name ? `${name}: ` : ""}${msg}`;

      const transient =
        name === "AbortError" ||
        /aborted|timed out|timeout/i.test(msg) ||
        TRANSIENT_CAROUSEL_RENDERER_ERR.test(msg);

      if (transient && attempt < maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(lastErrMsg);
    }

    if (response.ok) return response;

    let errDetail = "";
    try {
      const ab = await readResponseBodyWithTimeout(
        response,
        Math.min(timeoutMs, 30_000),
        `Renderer slide ${slideIndex} error body`
      );
      errDetail = new TextDecoder().decode(ab);
    } catch {
      errDetail = "(could not read error body)";
    }

    lastErrMsg = `Renderer slide ${slideIndex} returned ${response.status}: ${errDetail}`;
    if (response.status === 404 && errDetail.includes("render-binary")) {
      lastErrMsg +=
        " Hint: RENDERER_BASE_URL must be the Puppeteer renderer or media-gateway (POST /render-binary), not CAF Core — Fastify returns this 404 when the route does not exist.";
    }

    const transient5xx =
      response.status >= 500 &&
      response.status < 600 &&
      (TRANSIENT_CAROUSEL_RENDERER_ERR.test(errDetail) || [502, 503, 504].includes(response.status));

    if (transient5xx && attempt < maxRetries) {
      await sleep(500 * 2 ** attempt);
      continue;
    }

    throw new Error(lastErrMsg);
  }
  throw new Error(lastErrMsg);
}

async function processCarouselJob(
  db: Pool,
  config: AppConfig,
  pipeConfig: PipelineConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
) {
  const priorStatus = job.status;
  await warnIfRendererBaseUrlIsCafCore(pipeConfig.rendererBaseUrl, console.warn);
  await updateJobStatus(db, job.id, "RENDERING");
  await updateJobRenderState(db, job.id, { provider: "carousel-renderer", status: "pending" });

  if (run && priorStatus !== "RENDERING") {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: priorStatus,
      to_state: "RENDERING",
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const candidate = (job.generation_payload.candidate_data as Record<string, unknown>) ?? {};
  const renderCoerced =
    typeof gen.render === "object" && gen.render && !Array.isArray(gen.render)
      ? (gen.render as Record<string, unknown>)
      : {};
  let baseRender: Record<string, unknown> = {
    ...candidate,
    ...gen,
    ...renderCoerced,
  };
  baseRender = stripNonRenderableDeckFields(baseRender);
  baseRender = normalizeLlmParsedForSchemaValidation(job.flow_type, baseRender);
  const slides = slidesFromGeneratedOutput(baseRender);
  const usableSlides = slides.filter((s) => slideHasRenderableContent(s as Record<string, unknown>));

  if (usableSlides.length === 0) {
    const errMsg =
      "Carousel render blocked: no slide headline/body after merging candidate_data and generated_output. Regenerate the job or fix the LLM JSON (carousel / slide_deck / slides with headline or body).";
    await updateJobRenderState(db, job.id, {
      provider: "carousel-renderer",
      status: "failed",
      phase: "validate_slides",
      error: "no_renderable_slides",
    });
    await recordRunContentOutcomeSafe(db, {
      project_id: job.project_id,
      run_id: job.run_id,
      task_id: job.task_id,
      flow_type: job.flow_type,
      flow_kind: "carousel",
      outcome: "failed",
      job_status: "FAILED",
      slide_count: 0,
      asset_count: 0,
      summary: {
        platform: job.platform,
        raw_slide_row_count: slides.length,
      },
      error_message: errMsg,
    });
    throw new Error(errMsg);
  }

  const renderBase = carouselRenderBaseForPipeline(baseRender, usableSlides);
  const n = carouselSlideCount(renderBase);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid carousel slide count (${String(n)}); check generated_output / structure_variables.slide_count.`);
  }
  const template = await pickCarouselTemplateForRender(pipeConfig.rendererBaseUrl, job.generation_payload);
  const strategyRow = await getStrategyDefaults(db, job.project_id);
  const projectInstagramHandle = strategyRow?.instagram_handle ?? null;
  const projectRow = await getProjectById(db, job.project_id);
  const projectDisplayName =
    (projectRow?.display_name?.trim() || projectRow?.slug?.trim() || "").trim() || null;

  // Persist chosen carousel template onto the job payload so downstream systems (review UI, editorial learning,
  // engineering prompts) can reliably resolve `carousel_template_name` by task_id. Without this, the resolver
  // falls back to "default" even when render used a different template.
  await db.query(
    `UPDATE caf_core.content_jobs SET
      generation_payload = jsonb_set(
        jsonb_set(
          jsonb_set(COALESCE(generation_payload, '{}'::jsonb), '{template}', to_jsonb($1::text), true),
          '{render,html_template_name}', to_jsonb(($1::text || '.hbs')::text), true
        ),
        '{render,template_key}', to_jsonb($1::text), true
      ),
      updated_at = now()
     WHERE id = $2`,
    [template, job.id]
  );

  await updateJobRenderState(db, job.id, {
    provider: "carousel-renderer",
    status: "pending",
    phase: "preparing_slides",
    slide_total: n,
    template,
  });

  try {
    await deleteAssetsForTask(db, job.project_id, job.task_id);

    const slideResults: Array<{ index: number; public_url: string | null; object_path: string }> = [];
    for (let i = 1; i <= n; i++) {
      await updateJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "pending",
        phase: "POST /render-binary",
        slide_index: i,
        slide_total: n,
        template,
      });

      const ctx = buildSlideRenderContext(renderBase, usableSlides, i, {
        instagramHandle: projectInstagramHandle,
        projectDisplayName,
      });
      const body = {
        task_id: job.task_id,
        run_id: job.run_id,
        template,
        data: { render: ctx, task_id: job.task_id, run_id: job.run_id },
        slide_index: i,
      };

      const renderUrl = `${pipeConfig.rendererBaseUrl.replace(/\/$/, "")}/render-binary`;
      const response = await postCarouselRenderBinary(
        renderUrl,
        body,
        pipeConfig.carouselRendererSlideTimeoutMs,
        i,
        pipeConfig.carouselRendererSlideRetryAttempts
      );

      const buf = Buffer.from(
        await readResponseBodyWithTimeout(
          response,
          pipeConfig.carouselRendererSlideTimeoutMs,
          `Renderer slide ${i} PNG`
        )
      );
      await tryInsertApiCallAudit(db, {
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: `carousel_renderer_slide_${i}`,
        provider: "carousel_renderer",
        model: null,
        ok: true,
        requestJson: { endpoint: renderUrl, body },
        responseJson: { png_bytes: buf.length },
      });
      const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const objectPath = `carousels/${safeRun}/${safeTask}/slide_${String(i).padStart(3, "0")}.png`;

      let publicUrl: string | null = null;
      let storedPath = objectPath;
      try {
        const up = await uploadBuffer(config, objectPath, buf, "image/png");
        publicUrl = up.public_url;
        storedPath = up.object_path;
      } catch {
        // Supabase optional
      }

      await insertAsset(db, {
        asset_id: `${job.task_id}__CAROUSEL_SLIDE_${i}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        task_id: job.task_id,
        project_id: job.project_id,
        asset_type: "CAROUSEL_SLIDE",
        position: i - 1,
        bucket: config.SUPABASE_ASSETS_BUCKET,
        object_path: storedPath,
        public_url: publicUrl,
        provider: "carousel-renderer",
        metadata_json: { slide_index: i },
      });

      slideResults.push({ index: i, public_url: publicUrl, object_path: storedPath });
    }

    await updateJobRenderState(db, job.id, {
      provider: "carousel-renderer",
      status: "completed",
      slides: slideResults,
    });

    const finalStatusOk = finalJobStatusAfterRender(recommendedRoute);
    await recordRunContentOutcomeSafe(db, {
      project_id: job.project_id,
      run_id: job.run_id,
      task_id: job.task_id,
      flow_type: job.flow_type,
      flow_kind: "carousel",
      outcome: "completed",
      job_status: finalStatusOk,
      slide_count: n,
      asset_count: slideResults.length,
      summary: carouselOutcomeSummary(
        job,
        template,
        usableSlides,
        slideResults.map((r) => r.object_path)
      ),
      error_message: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    const aborted =
      name === "AbortError" ||
      name === "TimeoutError" ||
      /aborted|timed out/i.test(msg);
    // Renderer flakiness should NOT advance to IN_REVIEW without assets.
    // Treat fetch failures and transient 5xx as "not ready": keep job in RENDERING so the next /process retries.
    // Timeouts/aborts are treated as real failures (visible) because they may indicate a hung tab/template bug.
    const rendererUnavailable =
      !aborted &&
      ((err instanceof TypeError && msg.includes("fetch")) || isRendererUnavailableHttpError(msg));
    if (rendererUnavailable) {
      await mergeJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "pending",
        phase: "renderer_unavailable",
        error: msg,
        note: "will_retry_on_next_process",
      });
      await recordRunContentOutcomeSafe(db, {
        project_id: job.project_id,
        run_id: job.run_id,
        task_id: job.task_id,
        flow_type: job.flow_type,
        flow_kind: "carousel",
        outcome: "pending",
        job_status: "RENDERING",
        slide_count: n,
        asset_count: 0,
        summary: carouselOutcomeSummary(job, template, usableSlides, []),
        error_message: isRendererUnavailableHttpError(msg)
          ? "renderer_unavailable (HTTP 5xx: 502/503/504)"
          : "renderer_unavailable (fetch failed)",
      });
      throw new RenderNotReadyError(msg);
    } else {
      await mergeJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      await recordRunContentOutcomeSafe(db, {
        project_id: job.project_id,
        run_id: job.run_id,
        task_id: job.task_id,
        flow_type: job.flow_type,
        flow_kind: "carousel",
        outcome: "failed",
        job_status: "FAILED",
        slide_count: n,
        asset_count: 0,
        summary: carouselOutcomeSummary(job, template, usableSlides, []),
        error_message: msg,
      });
      throw err;
    }
  }

  const finalStatus = finalJobStatusAfterRender(recommendedRoute);
  await updateJobStatus(db, job.id, finalStatus);
  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "RENDERING",
      to_state: finalStatus,
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }
}

async function processVideoJob(
  db: Pool,
  config: AppConfig,
  pipeConfig: PipelineConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
) {
  const priorStatus = job.status;
  await updateJobStatus(db, job.id, "RENDERING");
  // Shallow-merge so retries/reprocess keep provider-specific resume keys (e.g. HeyGen video_id).
  await mergeJobRenderState(db, job.id, { provider: "video", status: "pending" });

  if (run && priorStatus !== "RENDERING") {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: priorStatus,
      to_state: "RENDERING",
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const productionRoute = String(
    job.generation_payload.production_route ?? gen.production_route ?? ""
  ).toUpperCase();
  const isScene =
    productionRoute.includes("SCENE") ||
    Boolean(gen.scene_bundle) ||
    String(job.generation_payload.video_pipeline ?? "").toLowerCase() === "scene" ||
    /video_scene_generator|FLOW_SCENE_ASSEMBLY|scene_assembly/i.test(job.flow_type);

  const wantsHeygen = /heygen/i.test(job.flow_type) || productionRoute.includes("HEYGEN");

  let videoProvider: string = "pending";
  try {
    const startedAt = Date.now();
    if (isScene) {
      videoProvider = "scene-pipeline";
      await runScenePipeline(db, config, pipeConfig.videoAssemblyBaseUrl, job);
      await updateJobRenderState(db, job.id, { provider: "scene-pipeline", status: "completed" });
    } else if (config.HEYGEN_API_KEY?.trim()) {
      // Preserve any previously persisted HeyGen video_id so reprocess can resume by polling.
      await mergeJobRenderState(db, job.id, { provider: "heygen", status: "pending", phase: "starting" });
      await ensureHeygenPayloadForFlowType(db, config, job.flow_type, job.id);

      const fresh = await qOne<JobRow>(
        db,
        `SELECT id, task_id, project_id, run_id, flow_type, platform, generation_payload FROM caf_core.content_jobs WHERE id = $1`,
        [job.id]
      );
      if (!fresh) throw new Error("job not found");
      videoProvider = "heygen";
      await runHeygenForContentJob(
        db,
        config,
        {
          id: fresh.id,
          task_id: fresh.task_id,
          project_id: fresh.project_id,
          run_id: fresh.run_id,
          flow_type: fresh.flow_type,
          platform: fresh.platform,
          generation_payload: fresh.generation_payload,
        },
        {
          /**
           * Persist HeyGen resume keys into render_state BEFORE the long video poll so a worker
           * crash/restart between submit and HeygenPollTimeoutError doesn't lose the ids and force a
           * fresh (double-billed) submission. Used by processRunJobs to skip in-flight retries.
           */
          progress: {
            onSession: async (sid) => {
              await mergeJobRenderState(db, job.id, {
                provider: "heygen",
                status: "pending",
                phase: "submitted",
                session_id: sid,
              });
            },
            onVideoId: async (vid) => {
              await mergeJobRenderState(db, job.id, {
                provider: "heygen",
                status: "pending",
                phase: "polling",
                video_id: vid,
              });
            },
          },
        }
      );
      await mergeJobRenderState(db, job.id, { provider: "heygen", status: "completed" });
    } else {
      if (wantsHeygen) {
        throw new Error(
          `HEYGEN_API_KEY not set (required for HeyGen flows like ${job.flow_type}). ` +
            "Set HEYGEN_API_KEY, or change this flow to a non-HeyGen production route."
        );
      }
      videoProvider = "video-assembly";
      const base = pipeConfig.videoAssemblyBaseUrl.replace(/\/$/, "");
      const vaUrl = `${base}/full-pipeline?async=1`;
      const vaBody = {
        task_id: job.task_id,
        run_id: job.run_id,
        ...extractRenderPayload(job.generation_payload),
      };
      // Start async job quickly; poll bounded (same order-of-magnitude as mux, since full-pipeline may mux).
      const vaTimeoutMs = Math.max(30_000, Math.min(120_000, config.VIDEO_ASSEMBLY_MUX_POLL_MAX_MS));
      const response = await fetch(vaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vaBody),
        signal: AbortSignal.timeout(vaTimeoutMs),
      });

      if (!response.ok) {
        const text = await response.text();
        await updateJobRenderState(db, job.id, { provider: "video-assembly", status: "failed", error: text });
        throw new Error(`Video assembly returned ${response.status}: ${text}`);
      }

      const startedJson = (await response.json()) as { request_id?: string } & Record<string, unknown>;
      const requestId = String(startedJson.request_id ?? "").trim();
      if (!requestId) {
        await updateJobRenderState(db, job.id, { provider: "video-assembly", status: "failed", error: "missing request_id" });
        throw new Error("Video assembly async start failed: missing request_id");
      }
      const merged = await pollVideoAssemblyJob(base, requestId, config.VIDEO_ASSEMBLY_MUX_POLL_MAX_MS);

      const result: Record<string, unknown> = {
        request_id: requestId,
        public_url: merged.public_url ?? null,
        local_path: merged.local_path ?? null,
      };
      await tryInsertApiCallAudit(db, {
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: "video_assembly_full_pipeline",
        provider: "video_assembly",
        model: null,
        ok: true,
        requestJson: { endpoint: vaUrl, body: vaBody, timeout_ms: vaTimeoutMs },
        responseJson: result,
      });
      await updateJobRenderState(db, job.id, { provider: "video-assembly", status: "completed", result });
    }

    const durMs = Date.now() - startedAt;
    if (durMs >= 20_000) {
      console.info(
        `[job-pipeline] video render completed task_id=${job.task_id} provider=${videoProvider} duration_ms=${durMs}`
      );
    }

    const freshJob = (await reloadJobRow(db, job.id)) ?? job;
    const genOut =
      (freshJob.generation_payload.generated_output as Record<string, unknown>) ?? {};
    const assetCount = await countAssetsForTask(db, job.project_id, job.task_id);
    const finalVidOk = finalJobStatusAfterRender(recommendedRoute);
    await recordRunContentOutcomeSafe(db, {
      project_id: job.project_id,
      run_id: job.run_id,
      task_id: job.task_id,
      flow_type: job.flow_type,
      flow_kind: "video",
      outcome: "completed",
      job_status: finalVidOk,
      slide_count: null,
      asset_count: assetCount,
      summary: videoOutcomeSummary(freshJob, genOut, videoProvider),
      error_message: null,
    });
  } catch (err) {
    if (err instanceof HeygenPollTimeoutError) {
      await updateJobRenderState(db, job.id, {
        provider: "heygen",
        status: "pending",
        phase: "polling",
        video_id: err.videoId,
        note: "poll_timeout_not_failed",
        max_poll_ms: err.maxMs,
      });
      throw new RenderNotReadyError(err.message);
    }
    if (err instanceof SoraPollTimeoutError) {
      await updateJobRenderState(db, job.id, {
        provider: "video",
        status: "pending",
        phase: "sora_polling",
        scene_index: err.sceneIndex,
        video_id: err.videoId,
        last_status: err.lastStatus,
        last_progress: err.lastProgress,
        note: "poll_timeout_not_failed",
        max_poll_ms: err.maxMs,
      });
      throw new RenderNotReadyError(err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    const genSnap = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
    const finalVid = finalJobStatusAfterRender(recommendedRoute);
    if (err instanceof TypeError && String(err.message).includes("fetch")) {
      if (videoProvider === "pending") videoProvider = "video-assembly";
      await updateJobRenderState(db, job.id, {
        provider: "video-assembly",
        status: "skipped",
        reason: "video_assembly_unavailable",
      });
      await recordRunContentOutcomeSafe(db, {
        project_id: job.project_id,
        run_id: job.run_id,
        task_id: job.task_id,
        flow_type: job.flow_type,
        flow_kind: "video",
        outcome: "skipped",
        job_status: finalVid,
        slide_count: null,
        asset_count: 0,
        summary: videoOutcomeSummary(job, genSnap, videoProvider),
        error_message: "video_pipeline_unavailable (fetch failed)",
      });
    } else {
      await recordRunContentOutcomeSafe(db, {
        project_id: job.project_id,
        run_id: job.run_id,
        task_id: job.task_id,
        flow_type: job.flow_type,
        flow_kind: "video",
        outcome: "failed",
        job_status: "FAILED",
        slide_count: null,
        asset_count: 0,
        summary: videoOutcomeSummary(job, genSnap, videoProvider),
        error_message: msg,
      });
      throw err;
    }
  }

  const finalStatus = finalJobStatusAfterRender(recommendedRoute);
  await updateJobStatus(db, job.id, finalStatus);
  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "RENDERING",
      to_state: finalStatus,
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }
}

function extractRenderPayload(genPayload: Record<string, unknown>): Record<string, unknown> {
  const { signal_pack_id, candidate_data, prompt_version_id, prompt_id, prompt_version_label, variation_index, ...rest } =
    genPayload;
  return rest;
}

async function updateJobStatus(db: Pool, jobId: string, status: string) {
  await db.query(`UPDATE caf_core.content_jobs SET status = $1, updated_at = now() WHERE id = $2`, [status, jobId]);
}

async function updateJobRenderState(db: Pool, jobId: string, state: Record<string, unknown>) {
  await db.query(
    `UPDATE caf_core.content_jobs SET render_state = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(state), jobId]
  );
}

/** Shallow-merge into existing `render_state` (keeps slide_index / slide_total when recording failure). */
async function mergeJobRenderState(db: Pool, jobId: string, patch: Record<string, unknown>) {
  const row = await qOne<{ render_state: unknown }>(
    db,
    `SELECT render_state FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  const prev =
    row?.render_state && typeof row.render_state === "object" && !Array.isArray(row.render_state)
      ? { ...(row.render_state as Record<string, unknown>) }
      : {};
  await updateJobRenderState(db, jobId, { ...prev, ...patch });
}
