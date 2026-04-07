/**
 * Job Pipeline — processes content_jobs through lifecycle stages.
 *
 * PLANNED → GENERATING → (GENERATED) → QC → diagnostic → RENDERING → IN_REVIEW / APPROVED / BLOCKED / …
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
import {
  carouselSlideCount,
  buildSlideRenderContext,
  slidesFromGeneratedOutput,
  pickCarouselTemplateForRender,
} from "./carousel-render-pack.js";
import { runHeygenForContentJob } from "./heygen-renderer.js";
import { ensureVideoScriptInPayload } from "./video-script-generator.js";
import { ensureVideoPromptInPayload } from "./video-prompt-generator.js";
import { runScenePipeline } from "./scene-pipeline.js";
import { warmupRenderer } from "./renderer-warmup.js";
import { isOfflinePipelineFlow } from "./offline-flow-types.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";

export interface PipelineConfig {
  rendererBaseUrl: string;
  videoAssemblyBaseUrl: string;
  carouselRendererSlideTimeoutMs: number;
}

export function getPipelineConfig(config: AppConfig): PipelineConfig {
  return {
    rendererBaseUrl: config.RENDERER_BASE_URL.replace(/\/$/, ""),
    videoAssemblyBaseUrl: config.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, ""),
    carouselRendererSlideTimeoutMs: config.CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS,
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
};

async function reloadJobRow(db: Pool, jobId: string): Promise<JobRow | null> {
  return qOne<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload
     FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
}

async function processOneJob(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  pipeConfig: PipelineConfig
): Promise<void> {
  if (isOfflinePipelineFlow(job.flow_type)) {
    return;
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

  const qcResult = await runQcForJob(db, job.id);

  if (!qcResult.qc_passed && qcResult.recommended_route === "BLOCKED") {
    await updateJobStatus(db, job.id, "BLOCKED");
    return;
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
    return;
  }

  await runDiagnosticAudit(db, job.id);

  // generation_payload in `job` is stale after generateForJob — carousel/video read slides/scripts from DB.
  const jobForMedia = (await reloadJobRow(db, job.id)) ?? job;

  if (isCarouselFlow(job.flow_type)) {
    await processCarouselJob(db, config, pipeConfig, jobForMedia, run, qcResult.recommended_route);
  } else if (isVideoFlow(job.flow_type)) {
    await processVideoJob(db, config, pipeConfig, jobForMedia, run, qcResult.recommended_route);
  } else {
    await advanceToInReview(db, job, run, qcResult.recommended_route);
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
  await processOneJob(db, config, job, run, pipeConfig);
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
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('PLANNED', 'GENERATING')
     ORDER BY created_at`,
    [run.project_id, run.run_id]
  );

  /** Carousel PNG loop can block a long time; run video/other flows first so one stuck carousel does not starve the run. */
  const isCar = (j: JobRow) => isCarouselFlow(j.flow_type) && !isOfflinePipelineFlow(j.flow_type);
  jobs.sort((a, b) => Number(isCar(a)) - Number(isCar(b)));

  const pipeConfig = getPipelineConfig(config);
  let processed = 0;
  const errors: string[] = [];

  const hasCarousel = jobs.some((j) => isCarouselFlow(j.flow_type) && !isOfflinePipelineFlow(j.flow_type));
  if (hasCarousel) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  for (const job of jobs) {
    if (isOfflinePipelineFlow(job.flow_type)) {
      continue;
    }
    try {
      await processOneJob(db, config, job, run, pipeConfig);
      await incrementRunJobsCompleted(db, runUuid);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${job.task_id}: ${msg}`);
      await updateJobStatus(db, job.id, "FAILED");
      await insertJobStateTransition(db, {
        task_id: job.task_id,
        project_id: run.project_id,
        from_state: job.status,
        to_state: "FAILED",
        triggered_by: "system",
        actor: "job-pipeline",
        metadata: { error: msg },
      });
    }
  }

  const pendingRows = await q<{ flow_type: string }>(
    db,
    `SELECT flow_type FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('PLANNED','GENERATING','RENDERING')`,
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
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobStatus(db, job.id, "FAILED");
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: projectId,
      from_state: job.status,
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

async function processCarouselJob(
  db: Pool,
  config: AppConfig,
  pipeConfig: PipelineConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
) {
  await updateJobStatus(db, job.id, "RENDERING");
  await updateJobRenderState(db, job.id, { provider: "carousel-renderer", status: "pending" });

  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "GENERATING",
      to_state: "RENDERING",
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const candidate = (job.generation_payload.candidate_data as Record<string, unknown>) ?? {};
  const baseRender = { ...candidate, ...gen, ...(typeof gen.render === "object" ? gen.render : {}) };
  const slides = slidesFromGeneratedOutput(gen);
  const n = carouselSlideCount(gen);
  const template = await pickCarouselTemplateForRender(pipeConfig.rendererBaseUrl, job.generation_payload);

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

      const ctx = buildSlideRenderContext(baseRender, slides.length ? slides : [{}], i);
      const body = {
        task_id: job.task_id,
        run_id: job.run_id,
        template,
        data: { render: ctx, task_id: job.task_id, run_id: job.run_id },
        slide_index: i,
      };

      const renderUrl = `${pipeConfig.rendererBaseUrl.replace(/\/$/, "")}/render-binary`;
      const response = await fetch(renderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(pipeConfig.carouselRendererSlideTimeoutMs),
      });

      if (!response.ok) {
        let errDetail = "";
        try {
          const ab = await readResponseBodyWithTimeout(
            response,
            Math.min(pipeConfig.carouselRendererSlideTimeoutMs, 30_000),
            `Renderer slide ${i} error body`
          );
          errDetail = new TextDecoder().decode(ab);
        } catch {
          errDetail = "(could not read error body)";
        }
        throw new Error(`Renderer slide ${i} returned ${response.status}: ${errDetail}`);
      }

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
      const objectPath = `assets/carousels/${safeRun}/${safeTask}/slide_${String(i).padStart(3, "0")}.png`;

      let publicUrl: string | null = null;
      try {
        const up = await uploadBuffer(config, objectPath, buf, "image/png");
        publicUrl = up.public_url;
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
        object_path: objectPath,
        public_url: publicUrl,
        provider: "carousel-renderer",
        metadata_json: { slide_index: i },
      });

      slideResults.push({ index: i, public_url: publicUrl, object_path: objectPath });
    }

    await updateJobRenderState(db, job.id, {
      provider: "carousel-renderer",
      status: "completed",
      slides: slideResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    const aborted =
      name === "AbortError" ||
      name === "TimeoutError" ||
      /aborted|timed out/i.test(msg);
    // Do not treat timeouts/aborts as "renderer unavailable" (skip) — fail the job so it is visible.
    if (!aborted && err instanceof TypeError && msg.includes("fetch")) {
      await updateJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "skipped",
        reason: "renderer_unavailable",
      });
    } else {
      await updateJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
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
  await updateJobStatus(db, job.id, "RENDERING");
  await updateJobRenderState(db, job.id, { provider: "video", status: "pending" });

  if (run) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "GENERATING",
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

  try {
    if (isScene) {
      await runScenePipeline(db, config, pipeConfig.videoAssemblyBaseUrl, job);
      await updateJobRenderState(db, job.id, { provider: "scene-pipeline", status: "completed" });
    } else if (config.HEYGEN_API_KEY?.trim()) {
      await ensureHeygenPayloadForFlowType(db, config, job.flow_type, job.id);

      const fresh = await qOne<JobRow>(
        db,
        `SELECT id, task_id, project_id, run_id, flow_type, platform, generation_payload FROM caf_core.content_jobs WHERE id = $1`,
        [job.id]
      );
      if (!fresh) throw new Error("job not found");
      await runHeygenForContentJob(db, config, {
        id: fresh.id,
        task_id: fresh.task_id,
        project_id: fresh.project_id,
        run_id: fresh.run_id,
        flow_type: fresh.flow_type,
        platform: fresh.platform,
        generation_payload: fresh.generation_payload,
      });
      await updateJobRenderState(db, job.id, { provider: "heygen", status: "completed" });
    } else {
      const vaUrl = `${pipeConfig.videoAssemblyBaseUrl.replace(/\/$/, "")}/full-pipeline`;
      const vaBody = {
        task_id: job.task_id,
        run_id: job.run_id,
        ...extractRenderPayload(job.generation_payload),
      };
      const response = await fetch(vaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vaBody),
      });

      if (!response.ok) {
        const text = await response.text();
        await updateJobRenderState(db, job.id, { provider: "video-assembly", status: "failed", error: text });
        throw new Error(`Video assembly returned ${response.status}: ${text}`);
      }

      const result = (await response.json()) as Record<string, unknown>;
      await tryInsertApiCallAudit(db, {
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: "video_assembly_full_pipeline",
        provider: "video_assembly",
        model: null,
        ok: true,
        requestJson: { endpoint: vaUrl, body: vaBody },
        responseJson: result,
      });
      await updateJobRenderState(db, job.id, { provider: "video-assembly", status: "completed", result });
    }
  } catch (err) {
    if (err instanceof TypeError && String(err.message).includes("fetch")) {
      await updateJobRenderState(db, job.id, {
        provider: "video-assembly",
        status: "skipped",
        reason: "video_assembly_unavailable",
      });
    } else {
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
