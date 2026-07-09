/**
 * Job Pipeline — processes content_jobs through lifecycle stages.
 *
 * PLANNED → GENERATING → (GENERATED) → QC → diagnostic → RENDERING → IN_REVIEW (or BLOCKED / …); APPROVED only via human review
 */
import type { Pool } from "pg";
import { resolveOutputSchemaValidationMode, type AppConfig } from "../config.js";
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
import { uploadBuffer, createSignedUrlForObjectKey } from "./supabase-storage.js";
import {
  insertAsset,
  deleteAssetsForTask,
  deleteCarouselSlideAssetsForTask,
  deleteCarouselSlideAssetsAtPositions,
  deleteMimicVisualPlateAssetsAtPositions,
  deleteMimicBackgroundAssetsAtPositions,
  listAssetsByTask,
} from "../repositories/assets.js";
import { getProjectById } from "../repositories/core.js";
import { resolveProjectInstagramHandle } from "../domain/instagram-handle.js";
import {
  getStrategyDefaults,
  listProjectBrandAssets,
  listProjectCarouselTemplates,
  resolveProductFlowHeygenMode,
} from "../repositories/project-config.js";
import { isProductVideoFlow } from "../domain/product-flow-types.js";
import {
  carouselSlideCount,
  carouselRenderBaseForPipeline,
  buildSlideRenderContext,
  slidesFromGeneratedOutput,
  mergeSlideCopyAtCarouselIndex,
  pickCarouselTemplateForRender,
  pickSlideByCarouselIndex,
  slideHeadlineBodyForRender,
  applySlideCopyToRenderContext,
  applySingleSlideBinaryRenderContext,
  slideHasRenderableContent,
  alignSlidesToMimicOutputCount,
  stripNonRenderableDeckFields,
  withInlinedBackgroundImage,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { runHeygenForContentJob } from "./heygen-renderer.js";
import { ensureVideoScriptInPayload } from "./video-script-generator.js";
import { ensureVideoPromptInPayload } from "./video-prompt-generator.js";
import { pollVideoAssemblyJob, runScenePipeline } from "./scene-pipeline.js";
import { warmupRenderer } from "./renderer-warmup.js";
import { warnIfRendererBaseUrlIsCafCore } from "./renderer-url-guard.js";
import {
  assertRenderNotPaused,
  beginRenderActivity,
  endRenderActivity,
  updateRenderActivity,
} from "./render-control.js";
import { RenderNotReadyError } from "../domain/render-not-ready-error.js";
import { isOfflinePipelineFlow } from "./offline-flow-types.js";
import { isCarouselFlow, isVideoFlow, isImageFlow } from "../decision_engine/flow-kind.js";
import {
  isTpGroundedCarouselRenderFlow,
  isTopPerformerMimicRenderableFlow,
  TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE,
} from "../domain/top-performer-mimic-flow-types.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { isWhyMimicExecution } from "../domain/why-mimic-execution.js";
import { parseBvsFromPayload } from "../domain/bvs-v1.js";
import { paletteFromBrandBibleSnapshot } from "../domain/brand-bible.js";
import {
  prepareMimicDraftPackage,
  ensureMimicReferenceBeforeCopyGeneration,
  ensureMimicTemplateBackgroundsBeforeCopy,
  backfillMimicArchiveReferenceItems,
} from "./mimic-draft-prep.js";
import { processImageMimicJob } from "./mimic-image-job.js";
import {
  classifyMimicMode,
  clampSlidePlansToOutputCount,
  extendSlidePlansForOutputCount,
  reconcileMimicPayloadAtRender,
} from "./mimic-mode-classifier.js";
import {
  assertMimicSlideBackgroundPresent,
  effectiveMimicSlideRenderMode,
  mimicCarouselNeedsBackgroundPlate,
  persistCarouselSlidePng,
  requireMimicSlideBackgroundPlate,
  persistMimicVisualPlateForSlide,
  renderMimicCarouselSlideFullBleed,
  slideOnImageCopyFromSlides,
  filterPromotionalSlidesFromMimicPayload,
  reconcileFullBleedSlidePlansAtRender,
  alignMimicSlidePlansToReferences,
  reconcileMimicPayloadToOutputSlideCount,
  expectedMimicCarouselOutputSlideCount,
  resolveMimicCarouselRenderSlideCount,
  targetMimicCarouselCopySlideCount,
  slideMimicRenderMode,
  mimicDeckUsesSlotDeduplication,
} from "./mimic-carousel-render.js";
import { templateBgAssetPositionsForSlideIndices } from "../domain/mimic-template-library.js";
import { loadMimicPromptOverrides } from "./mimic-prompt-overrides-loader.js";
import { ensureMimicEvidenceCarouselTemplate } from "./mimic-evidence-carousel-template.js";
import { MIMIC_FULL_BLEED_RENDER_TEMPLATE, MIMIC_LAYOUT_TEMPLATE_DEFAULT } from "./mimic-carousel-template-layout.js";
import {
  buildMimicDocAiRenderTextLayers,
  formatMimicTextBackingBackground,
  inferMimicCarouselTheme,
  mimicDocAiLayersCoverLlmCopy,
  mimicPayloadHasDocAiTextLayout,
  mimicSlideTypographyPatch,
  mimicSlideThemePatch,
} from "./mimic-slide-typography.js";
import { templateBgLlmSlideForDocAi } from "./mimic-template-bg-render.js";
import { normalizeMimicReferenceItems } from "./mimic-reference-resolver.js";
import { refreshMimicPayloadReferenceUrls } from "./mimic-reference-urls.js";
import { isNvidiaVisualGenAiReachable, mimicImageProviderAssetLabel } from "./mimic-image-provider.js";
import { loadProjectMimicRenderSettings } from "./mimic-project-config.js";
import type { MimicImageInputMode } from "../domain/mimic-render-settings.js";
import { isOpenAiPlaceholderModeForProject } from "./openai-generation-placeholder.js";
import { loadProjectOpenAiGenerationMode } from "./project-generation-config.js";
import { hasActiveProviderSession, isCarouselRenderComplete, pickRenderState } from "../domain/content-job-render-state.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { mergeCarouselTypographyIntoGeneratedOutputRender } from "../domain/carousel-render-typography.js";
import {
  isReviewRetainStatusDuringTextOverlayReprint,
  isTextOverlayReprintInProgress,
  MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
  pickRenderStateRecord,
} from "../domain/mimic-text-overlay-reprint.js";
import {
  applyMimicDocAiLayerPositionOverrides,
  isCopySlotEditorLayerPositionKey,
  mimicV1HasReviewerDocAiLayerPositions,
  pickMimicDocAiLayerPositionsForSlide,
  sanitizeTemplateBgDocAiOverridesForInspect,
} from "../domain/mimic-docai-layer-positions.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { estimateCarouselSlideFlyUsd } from "./render-cost-estimate.js";
import { flowKindForContentLog, insertRunContentOutcome } from "../repositories/run-content-outcomes.js";
import { HeygenPollTimeoutError } from "./heygen-renderer.js";
import { SoraPollTimeoutError } from "./sora-scene-clips.js";
import { pickLayoutQcFromPayload } from "../domain/mimic-composite-layout-qa.js";
import { runMimicPostRenderLayoutLoop } from "./mimic-post-render-layout-loop.js";
import {
  markCarouselRegenerateFinished,
  markCarouselRegenerateSlideProgress,
  markCarouselRegenerateStarted,
  pickCarouselRegenerateState,
} from "./mimic-carousel-regenerate-state.js";

export interface PipelineConfig {
  rendererBaseUrl: string;
  videoAssemblyBaseUrl: string;
  carouselRendererSlideTimeoutMs: number;
  carouselRendererSlideRetryAttempts: number;
  carouselRenderConcurrency: number;
  videoRenderConcurrency: number;
}

export function getPipelineConfig(config: AppConfig): PipelineConfig {
  return {
    rendererBaseUrl: config.RENDERER_BASE_URL.replace(/\/$/, ""),
    videoAssemblyBaseUrl: config.VIDEO_ASSEMBLY_BASE_URL.replace(/\/$/, ""),
    carouselRendererSlideTimeoutMs: config.CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS,
    carouselRendererSlideRetryAttempts: config.CAROUSEL_RENDERER_SLIDE_RETRY_ATTEMPTS,
    carouselRenderConcurrency: config.CAROUSEL_RENDER_CONCURRENCY,
    videoRenderConcurrency: config.VIDEO_RENDER_CONCURRENCY,
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
  /** Optional — used by render-only/manual phase. */
  recommended_route?: string | null;
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
  // HeyGen idempotency invariant (see `src/domain/content-job-render-state.ts`):
  // if a provider already holds a resume key we must NOT re-submit.
  if (hasActiveProviderSession(j.render_state)) return false;
  const { phase } = pickRenderState(j.render_state);
  /** Empty render_state, "starting", or explicit "failed" with no resume key — safe to re-enter. Avoid retrying mid-stream phases like "polling" / "sora_polling" / "submitted" that imply a HeyGen/Sora id should already exist. */
  if (phase === "" || phase === "starting" || phase === "failed") return true;
  return false;
}

/**
 * Carousel render finished (`render_state.status = completed`) but job status never left RENDERING
 * (worker died between render completion and layout QA / IN_REVIEW transition).
 */
function isCarouselRenderStuckAfterComplete(j: JobRow): boolean {
  if (j.status !== "RENDERING") return false;
  if (!isCarouselFlow(j.flow_type) || isOfflinePipelineFlow(j.flow_type)) return false;
  if (!isCarouselRenderComplete(j.render_state)) return false;
  if (pickCarouselRegenerateState(j.render_state)?.status === "in_progress") return false;
  if (isTextOverlayReprintInProgress(j.render_state)) return false;
  return true;
}

/**
 * Carousel RENDERING job is safe to re-enter for slide rendering. When render already completed we must
 * NOT re-render (double work + resets render_state); finalize to IN_REVIEW instead.
 */
function isCarouselRenderingSafelyRetryable(j: JobRow): boolean {
  if (j.status !== "RENDERING") return false;
  if (!isCarouselFlow(j.flow_type) || isOfflinePipelineFlow(j.flow_type)) return false;
  if (isCarouselRenderStuckAfterComplete(j)) return false;
  if (pickCarouselRegenerateState(j.render_state)?.status === "in_progress") return true;
  if (isTextOverlayReprintInProgress(j.render_state)) return true;
  const status = String(pickRenderState(j.render_state).raw.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "completed") return false;
  const { phase } = pickRenderState(j.render_state);
  if (status === "pending" || status === "failed" || status === "") return true;
  if (phase === "renderer_unavailable") return true;
  return true;
}

function isCarouselRenderingPipelineEligible(j: JobRow): boolean {
  return isCarouselRenderingSafelyRetryable(j) || isCarouselRenderStuckAfterComplete(j);
}

function isLayoutQcReviewBlock(gp: Record<string, unknown> | null | undefined): boolean {
  const layout = pickLayoutQcFromPayload(gp);
  return layout?.block_review === true;
}

/** Layout QA blocked review but carousel PNGs already exist — operator can open Review without re-billing Flux. */
export function isCarouselLayoutBlockedWithCompleteRender(job: {
  status: string;
  flow_type: string;
  render_state?: unknown;
  generation_payload?: unknown;
}): boolean {
  if (String(job.status ?? "").toUpperCase() !== "BLOCKED") return false;
  if (!isCarouselFlow(job.flow_type) || isOfflinePipelineFlow(job.flow_type)) return false;
  if (!isCarouselRenderComplete(job.render_state)) return false;
  return isLayoutQcReviewBlock(
    (job.generation_payload ?? null) as Record<string, unknown> | null | undefined
  );
}

type PreRenderStep =
  | { kind: "terminal" }
  | { kind: "render_carousel"; recommended_route: string | null }
  | { kind: "render_video"; recommended_route: string | null }
  | { kind: "render_image"; recommended_route: string | null };

type RenderTicket = {
  jobId: string;
  task_id: string;
  kind: "carousel" | "video" | "image";
  recommended_route: string | null;
};

async function persistJobPipelineFailure(
  db: Pool,
  job: {
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform?: string | null;
    generation_payload?: unknown;
  },
  msg: string,
  fromState: string
): Promise<void> {
  const trimmed = msg.trim().slice(0, 2000);
  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = jsonb_set(
           jsonb_set(COALESCE(generation_payload, '{}'::jsonb), '{generation_error}', to_jsonb($1::text), true),
           '{last_error}', to_jsonb($1::text), true
         ),
         updated_at = now()
     WHERE id = $2`,
    [trimmed, job.id]
  );
  logPipelineEvent("error", "other", trimmed, {
    run_id: job.run_id,
    task_id: job.task_id,
    flow_type: job.flow_type,
    data: { from_state: fromState },
  });
  await recordLifecycleOutcomeSafe(db, job, "FAILED", "failed", trimmed);
}

async function markJobFailedPipeline(
  db: Pool,
  run: RunRow,
  taskId: string,
  jobId: string,
  msg: string,
  errors: string[]
): Promise<void> {
  errors.push(`${taskId}: ${msg}`);
  const prior = await qOne<{
    status: string;
    flow_type: string;
    platform: string | null;
    run_id: string;
    generation_payload: unknown;
  }>(
    db,
    `SELECT status, flow_type, platform, run_id, generation_payload
     FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  const fromState = prior?.status ?? "GENERATING";
  await updateJobStatus(db, jobId, "FAILED");
  await insertJobStateTransition(db, {
    task_id: taskId,
    project_id: run.project_id,
    from_state: fromState,
    to_state: "FAILED",
    triggered_by: "system",
    actor: "job-pipeline",
    metadata: { error: msg },
  });
  if (prior) {
    await persistJobPipelineFailure(
      db,
      {
        id: jobId,
        task_id: taskId,
        project_id: run.project_id,
        run_id: prior.run_id,
        flow_type: prior.flow_type,
        platform: prior.platform,
        generation_payload: prior.generation_payload,
      },
      msg,
      fromState
    );
  }
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
  _pipeConfig: PipelineConfig,
  opts?: { stop_before_render?: boolean }
): Promise<PreRenderStep> {
  if (isOfflinePipelineFlow(job.flow_type)) {
    return { kind: "terminal" };
  }

  const openaiKey = config.OPENAI_API_KEY;
  const openaiModel = config.OPENAI_MODEL ?? "gpt-4o";
  const projectGenMode = await loadProjectOpenAiGenerationMode(db, job.project_id);
  const openAiPlaceholder = isOpenAiPlaceholderModeForProject(projectGenMode, config);

  if (job.status === "PLANNED") {
    await advanceToGenerating(db, job, run);
  }

  const payloadSnap = await qOne<{ generation_payload: Record<string, unknown> }>(
    db,
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const hasGenerated = Boolean(payloadSnap?.generation_payload?.generated_output);

  if ((openaiKey || openAiPlaceholder) && !hasGenerated) {
    if (isTopPerformerMimicRenderableFlow(job.flow_type) && config.MIMIC_IMAGE_ENABLED) {
      const preGenJob = await reloadJobRow(db, job.id);
      if (preGenJob) {
        await ensureMimicReferenceBeforeCopyGeneration(
          db,
          config,
          {
            id: preGenJob.id,
            task_id: preGenJob.task_id,
            project_id: preGenJob.project_id,
            flow_type: preGenJob.flow_type,
            generation_payload: (preGenJob.generation_payload ?? {}) as Record<string, unknown>,
          },
          run?.run_id ?? null
        );
        await ensureMimicTemplateBackgroundsBeforeCopy(
          db,
          config,
          {
            id: preGenJob.id,
            task_id: preGenJob.task_id,
            project_id: preGenJob.project_id,
            run_id: preGenJob.run_id,
            flow_type: preGenJob.flow_type,
            generation_payload: (preGenJob.generation_payload ?? {}) as Record<string, unknown>,
          },
          run?.run_id ?? null
        );
      }
    }

    const genResult = await generateForJob(db, job.id, openaiKey ?? "", openaiModel, {
      schemaValidationMode: resolveOutputSchemaValidationMode(config),
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
      await recordLifecycleOutcomeSafe(db, job, "GENERATED", "generated");
    }
  }

  if (isTopPerformerMimicRenderableFlow(job.flow_type)) {
    if (!config.MIMIC_IMAGE_ENABLED) {
      throw new Error(TOP_PERFORMER_MIMIC_RENDER_NOT_READY_MESSAGE);
    }
    const freshJob = await reloadJobRow(db, job.id);
    if (freshJob) {
      await prepareMimicDraftPackage(
        db,
        config,
        {
          id: freshJob.id,
          task_id: freshJob.task_id,
          project_id: freshJob.project_id,
          flow_type: freshJob.flow_type,
          generation_payload: (freshJob.generation_payload ?? {}) as Record<string, unknown>,
        },
        run?.run_id ?? null
      );
    }
  }

  const qcResult = await runQcForJob(db, job.id, config.CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC);

  if (!qcResult.qc_passed && qcResult.recommended_route === "BLOCKED") {
    await updateJobStatus(db, job.id, "BLOCKED");
    return { kind: "terminal" };
  }

  // Manual-render mode: do not advance to NEEDS_EDIT / IN_REVIEW / REJECTED yet.
  // GENERATED means "package ready", and render/review are explicitly initiated later.
  if (opts?.stop_before_render) {
    await runDiagnosticAudit(db, job.id);
    return { kind: "terminal" };
  }

  // If QC fails but the router wants HUMAN_REVIEW, skip media for non-carousel flows (often incomplete JSON).
  // Carousel jobs still run the renderer when possible so review queue rows get slide thumbnails in `assets`.
  if (!qcResult.qc_passed && qcResult.recommended_route === "HUMAN_REVIEW") {
    if (!isCarouselFlow(job.flow_type) && !isImageFlow(job.flow_type)) {
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
    /**
     * PARTIAL_NO_VIDEO rework: the reviewer asked to keep the existing rendered video and only
     * refresh captions / hashtags. The render state + asset_id + publish_media_urls_json were
     * preserved by `prepareContentJobForCaptionsOnlyRerun`, so skip the render submission entirely
     * and go straight to review. The flag is consumed (deleted) so subsequent passes don't
     * accidentally skip render.
     */
    const skipVideoRender = await qOne<{ skip: boolean | null }>(
      db,
      `SELECT (generation_payload->>'skip_video_render') = 'true' AS skip
       FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    if (skipVideoRender?.skip === true) {
      await db.query(
        `UPDATE caf_core.content_jobs
         SET generation_payload = generation_payload - 'skip_video_render', updated_at = now()
         WHERE id = $1`,
        [job.id]
      );
      await advanceToInReview(db, job, run, route);
      return { kind: "terminal" };
    }
    return { kind: "render_video", recommended_route: route };
  }
  if (isImageFlow(job.flow_type)) {
    if (opts?.stop_before_render) {
      return { kind: "terminal" };
    }
    const skipImageRender = await qOne<{ skip: boolean | null }>(
      db,
      `SELECT (generation_payload->>'skip_image_render') = 'true' AS skip
       FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    if (skipImageRender?.skip === true) {
      await db.query(
        `UPDATE caf_core.content_jobs
         SET generation_payload = generation_payload - 'skip_image_render', updated_at = now()
         WHERE id = $1`,
        [job.id]
      );
      await advanceToInReview(db, job, run, route);
      return { kind: "terminal" };
    }
    return { kind: "render_image", recommended_route: route };
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
  } else if (step.kind === "render_image") {
    await processImageMimicJob(db, config, jobForMedia as JobRow, run, step.recommended_route);
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
    const fromState = prior?.status ?? job.status;
    await updateJobStatus(db, jobId, "FAILED");
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: job.project_id,
      from_state: fromState,
      to_state: "FAILED",
      triggered_by: "system",
      actor: "job-pipeline",
      metadata: { error: msg },
    });
    await persistJobPipelineFailure(db, job, msg, fromState);
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
      isCarouselRenderingPipelineEligible(j) ||
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
          kind:
            step.kind === "render_carousel"
              ? "carousel"
              : step.kind === "render_image"
                ? "image"
                : "video",
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
  const imageTickets = renderTickets.filter((t) => t.kind === "image");
  const videoTickets = renderTickets.filter((t) => t.kind === "video");

  if (carouselTickets.length > 0) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  const runOneRender = async (t: RenderTicket) => {
    const jobRow = await reloadJobRow(db, t.jobId);
    if (!jobRow) throw new Error(`Job disappeared: ${t.task_id}`);
    if (t.kind === "carousel") {
      await processCarouselJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    } else if (t.kind === "image") {
      await processImageMimicJob(db, config, jobRow as JobRow, run, t.recommended_route);
    } else {
      await processVideoJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    }
  };

  async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    const limit = Math.max(1, Math.floor(concurrency));
    let idx = 0;
    const workers: Promise<void>[] = [];
    const work = async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        assertRenderNotPaused();
        await fn(items[i]!);
      }
    };
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      workers.push(work());
    }
    await Promise.all(workers);
  }

  const carouselLane = async () => {
    await runWithConcurrency(carouselTickets, pipeConfig.carouselRenderConcurrency, async (t) => {
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
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    });
  };

  const videoLane = async () => {
    await runWithConcurrency(videoTickets, pipeConfig.videoRenderConcurrency, async (t) => {
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
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    });
  };

  const imageLane = async () => {
    await runWithConcurrency(imageTickets, 1, async (t) => {
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
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    });
  };

  await carouselLane();
  await imageLane();
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

/**
 * Generate DraftPackages (LLM + QC + diagnostics) for every PLANNED/GENERATING job in the run,
 * then stop with the job in GENERATED ("package ready"). Rendering is manual.
 */
export async function generateRunDraftPackages(
  db: Pool,
  config: AppConfig,
  runUuid: string
): Promise<{ processed: number; errors: string[] }> {
  const run = await getRunById(db, runUuid);
  if (!run) throw new Error(`Run not found: ${runUuid}`);

  const jobs = await q<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload, render_state, recommended_route
       FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('PLANNED', 'GENERATING', 'GENERATED')
     ORDER BY created_at`,
    [run.project_id, run.run_id]
  );

  const pipeConfig = getPipelineConfig(config);
  let processed = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    if (isOfflinePipelineFlow(job.flow_type)) continue;
    try {
      await processJobUpToRender(db, config, job, run, pipeConfig, { stop_before_render: true });
      // In manual-render mode, we intentionally do not increment jobs_completed — the run is not "done".
      processed++;
    } catch (err) {
      if (err instanceof RenderNotReadyError) continue;
      const msg = err instanceof Error ? err.message : String(err);
      await markJobFailedPipeline(db, run, job.task_id, job.id, msg, errors);
    }
  }

  return { processed, errors };
}

/**
 * Render all GENERATED jobs for the run (and safely retry eligible RENDERING jobs).
 * This is the manual "Render" step after packages are ready.
 */
export async function renderRunGeneratedJobs(
  db: Pool,
  config: AppConfig,
  runUuid: string
): Promise<{ rendered: number; errors: string[] }> {
  const run = await getRunById(db, runUuid);
  if (!run) throw new Error(`Run not found: ${runUuid}`);

  const jobs = await q<JobRow>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload, render_state, recommended_route
       FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2 AND status IN ('GENERATED', 'RENDERING')
     ORDER BY created_at`,
    [run.project_id, run.run_id]
  );

  const eligible = jobs.filter(
    (j) =>
      j.status !== "RENDERING" ||
      isCarouselRenderingPipelineEligible(j) ||
      isVideoRenderingSafelyRetryable(j)
  );

  // Render carousels first for UX parity with the existing pipeline.
  const isCar = (j: JobRow) => isCarouselFlow(j.flow_type) && !isOfflinePipelineFlow(j.flow_type);
  eligible.sort((a, b) => Number(isCar(b)) - Number(isCar(a)));

  const pipeConfig = getPipelineConfig(config);
  const errors: string[] = [];
  let rendered = 0;

  const carouselTickets: RenderTicket[] = [];
  const imageTickets: RenderTicket[] = [];
  const videoTickets: RenderTicket[] = [];

  for (const job of eligible) {
    if (isOfflinePipelineFlow(job.flow_type)) continue;
    if (job.status === "RENDERING") {
      // Already in progress; let the renderer re-enter safely.
    }
    const route = String((job as any).recommended_route ?? "").trim() || "AUTO";
    if (isCarouselFlow(job.flow_type)) {
      carouselTickets.push({ jobId: job.id, task_id: job.task_id, kind: "carousel", recommended_route: route });
    } else if (isImageFlow(job.flow_type)) {
      imageTickets.push({ jobId: job.id, task_id: job.task_id, kind: "image", recommended_route: route });
    } else if (isVideoFlow(job.flow_type)) {
      videoTickets.push({ jobId: job.id, task_id: job.task_id, kind: "video", recommended_route: route });
    }
  }

  if (carouselTickets.length > 0) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  const runOneRender = async (t: RenderTicket) => {
    const jobRow = await reloadJobRow(db, t.jobId);
    if (!jobRow) throw new Error(`Job disappeared: ${t.task_id}`);
    if (t.kind === "carousel") {
      await processCarouselJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    } else if (t.kind === "image") {
      await processImageMimicJob(db, config, jobRow as JobRow, run, t.recommended_route);
    } else {
      await processVideoJob(db, config, pipeConfig, jobRow, run, t.recommended_route);
    }
  };

  async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    const limit = Math.max(1, Math.floor(concurrency));
    let idx = 0;
    const workers: Promise<void>[] = [];
    const work = async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        assertRenderNotPaused();
        await fn(items[i]!);
      }
    };
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      workers.push(work());
    }
    await Promise.all(workers);
  }

  const lane = async (tickets: RenderTicket[], conc: number) => {
    await runWithConcurrency(tickets, conc, async (t) => {
      try {
        await runOneRender(t);
        const refreshed = await qOne<{ status: string }>(
          db,
          `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
          [t.jobId]
        );
        if (refreshed?.status !== "RENDERING") {
          rendered++;
        }
      } catch (err) {
        if (err instanceof RenderNotReadyError) return;
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailedPipeline(db, run, t.task_id, t.jobId, msg, errors);
      }
    });
  };

  await lane(carouselTickets, pipeConfig.carouselRenderConcurrency);
  await lane(imageTickets, 1);
  await lane(videoTickets, pipeConfig.videoRenderConcurrency);

  return { rendered, errors };
}

async function mimicCarouselHasStoredPlatesForReprint(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<boolean> {
  const assets = await listAssetsByTask(db, projectId, taskId).catch(() => []);
  const hasBg = assets.some((a) => {
    const t = String(a.asset_type ?? "").toUpperCase();
    return t === "MIMIC_BACKGROUND" || t === "MIMIC_VISUAL_PLATE";
  });
  const hasCarousel = assets.some((a) => String(a.asset_type ?? "").toUpperCase() === "CAROUSEL_SLIDE");
  return hasBg && hasCarousel;
}

async function shouldResumeAsTextOverlayReprint(
  db: Pool,
  job: JobRow & { render_state?: unknown }
): Promise<boolean> {
  if (!isTpGroundedCarouselRenderFlow(job.flow_type)) return false;
  const rs = pickRenderStateRecord(job.render_state) ?? {};
  const phase = String(rs.phase ?? "").trim();
  const renderStatus = String(rs.status ?? "").trim().toLowerCase();
  const isReprintPending =
    phase === MIMIC_TEXT_OVERLAY_REPRINT_PHASE && renderStatus === "pending";
  if (!isReprintPending && job.status !== "RENDERING") return false;
  const provider = String(rs.provider ?? "").toLowerCase();
  if (
    !isReprintPending &&
    provider !== "carousel-renderer" &&
    provider !== "carousel_renderer"
  ) {
    return false;
  }
  return mimicCarouselHasStoredPlatesForReprint(db, job.project_id, job.task_id);
}

/** Mark a stuck/failed text-overlay reprint so the admin UI shows FAILED instead of silent RENDERING. */
export async function recordCarouselTextOverlayReprintFailure(
  db: Pool,
  job: Pick<JobRow, "id" | "task_id" | "project_id" | "status">,
  message: string
): Promise<void> {
  const msg = String(message ?? "").trim() || "text overlay reprint failed";
  const fromState = job.status ?? "RENDERING";
  const retainInReview = isReviewRetainStatusDuringTextOverlayReprint(fromState);
  await mergeJobRenderState(db, job.id, {
    provider: "carousel-renderer",
    status: "failed",
    phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
    error: msg.slice(0, 500),
    failed_at: new Date().toISOString(),
  });
  if (retainInReview) return;
  await updateJobStatus(db, job.id, "FAILED");
  await insertJobStateTransition(db, {
    task_id: job.task_id,
    project_id: job.project_id,
    from_state: fromState,
    to_state: "FAILED",
    triggered_by: "system",
    actor: "text-overlay-reprint",
    metadata: { error: msg.slice(0, 500) },
  });
}

/** Mark mimic text-overlay reprint as queued — job stays IN_REVIEW when already in review queue. */
export async function markCarouselTextOverlayReprintStarted(
  db: Pool,
  jobId: string,
  opts?: { slideIndices?: number[] }
): Promise<void> {
  const slide_indices =
    opts?.slideIndices && opts.slideIndices.length > 0 ? opts.slideIndices : "all";
  await mergeJobRenderState(db, jobId, {
    provider: "carousel-renderer",
    status: "pending",
    phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
    requested_at: new Date().toISOString(),
    slide_indices,
    error: null,
    completed_at: null,
    failed_at: null,
  });
}

export async function processJobByTaskId(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<{ status: string; skipped?: boolean }> {
  const job = await qOne<JobRow & { render_state?: unknown }>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload, render_state
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) throw new Error(`Job not found: ${taskId}`);

  if (isOfflinePipelineFlow(job.flow_type)) {
    return { status: job.status, skipped: true };
  }

  if (isCarouselLayoutBlockedWithCompleteRender(job)) {
    return unblockLayoutBlockedJobToReview(db, projectId, taskId);
  }

  const run = await getRunByRunId(db, projectId, job.run_id);
  const pipeConfig = getPipelineConfig(config);

  if (isCarouselFlow(job.flow_type)) {
    await warmupRenderer(pipeConfig.rendererBaseUrl).catch(() => {});
  }

  if (await shouldResumeAsTextOverlayReprint(db, job)) {
    try {
      await rerenderCarouselTextOverlay(db, config, job.id);
      const updated = await qOne<{ status: string }>(
        db,
        `SELECT status FROM caf_core.content_jobs WHERE id = $1`,
        [job.id]
      );
      return { status: updated?.status ?? "IN_REVIEW" };
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
      await recordCarouselTextOverlayReprintFailure(db, job, msg);
      throw err;
    }
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

/**
 * Subset of the full-rerun key list that keeps the existing publish URLs / video asset references
 * intact (only the LLM output + QC are wiped). Used by `prepareContentJobForCaptionsOnlyRerun` so the
 * reviewer can refresh caption + hashtags without re-billing HeyGen / Sora.
 */
const CAPTIONS_ONLY_RERUN_GENERATION_PAYLOAD_DROP_KEYS = [
  "generated_output",
  "qc_result",
  "draft_id",
] as const;

const REWORK_HISTORY_MAX_ENTRIES = 25;

export interface ReworkHistoryEntry {
  archived_at: string;
  kind:
    | "full_rerun_reset"
    | "before_override_rework"
    | "before_slide_partial_rework"
    | "captions_only_rerun_reset";
  draft_id?: unknown;
  generated_output?: unknown;
  qc_result?: unknown;
  slide_rework_indices?: number[];
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
    slide_rework_indices: entry.slide_rework_indices,
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
  const wasLayoutBlocked =
    String(job.status ?? "").toUpperCase() === "BLOCKED" && isLayoutQcReviewBlock(gp);
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
  delete gp.layout_qc;
  if (wasLayoutBlocked) {
    gp.layout_qc_skip_auto_reprint = true;
  } else {
    delete gp.layout_qc_skip_auto_reprint;
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

/**
 * Like `prepareContentJobForFullRerun` but for the PARTIAL_NO_VIDEO rework mode: clears ONLY the LLM
 * output + QC state so the LLM re-runs on next pass (refresh caption / hashtags grounded in signal
 * pack), while preserving `asset_id`, `render_state`, `render_provider / status / job_id`, and
 * `publish_media_urls_json` so the already-rendered video remains authoritative (no HeyGen / Sora
 * credits spent on rework). The pipeline short-circuits the render lane via
 * `generation_payload.skip_video_render = true`, which the caller is expected to set.
 */
export async function prepareContentJobForCaptionsOnlyRerun(
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
  if (!isVideoFlow(job.flow_type ?? "")) {
    return { ok: false, error: "partial_no_video_only_supports_video_flows" };
  }

  /** Diagnostic + auto-validation rows are per-generation — clear them so the next pass writes fresh ones. */
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
      kind: "captions_only_rerun_reset",
      draft_id: gp.draft_id ?? null,
      generated_output: gp.generated_output,
      qc_result: gp.qc_result ?? null,
    });
  }
  for (const k of CAPTIONS_ONLY_RERUN_GENERATION_PAYLOAD_DROP_KEYS) {
    delete gp[k];
  }

  /**
   * Only reset status + QC route + recommended_route. Render provider/status/job_id and asset_id
   * MUST survive so the existing video stays linked to this task.
   */
  await db.query(
    `UPDATE caf_core.content_jobs SET
      status = 'PLANNED',
      recommended_route = NULL,
      qc_status = NULL,
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
    actor: "captions-only-rerun-reset",
    metadata: { cleared_for_captions_only_pipeline: true },
  });

  return { ok: true };
}

/**
 * Move a layout-BLOCKED carousel (render already complete) into the human review queue without
 * re-running Flux or the layout auto-reprint loop.
 */
export async function unblockLayoutBlockedJobToReview(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<{ status: string }> {
  const job = await qOne<JobRow & { render_state?: unknown }>(
    db,
    `SELECT id, task_id, flow_type, status, project_id, run_id, platform, generation_payload, render_state, recommended_route
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId.trim()]
  );
  if (!job) throw new Error(`Job not found: ${taskId}`);
  if (!isCarouselLayoutBlockedWithCompleteRender(job)) {
    throw new Error("job_not_layout_blocked_with_complete_render");
  }
  const run = await getRunByRunId(db, projectId, job.run_id);
  const route = job.recommended_route ?? "HUMAN_REVIEW";
  await advanceToInReview(db, job, run, route);
  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = COALESCE(generation_payload, '{}'::jsonb)
       - 'layout_qc_skip_auto_reprint'
       - 'last_error'
       - 'generation_error',
         updated_at = now()
     WHERE id = $1`,
    [job.id]
  );
  return { status: "IN_REVIEW" };
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

/**
 * Prompt-led vs script-led HeyGen prep: one LLM path per flow name; legacy video flows still run both.
 *
 * Product flows (FLOW_PRODUCT_*) used to hit the final fallthrough branch and run *both* generators,
 * which produced a spoken_script and a video_prompt with independent narratives that were then glued
 * into a single /v3/video-agents blob — the root cause of "random spoken scripts that don't match
 * the video". We now consult the per-project `allowed_flow_types.heygen_mode` override (or the
 * baked-in default per FLOW_PRODUCT_* angle) and run exactly one generator.
 */
async function ensureHeygenPayloadForFlowType(
  db: Pool,
  config: AppConfig,
  flowType: string,
  jobId: string,
  projectId?: string
): Promise<void> {
  const ft = flowType ?? "";

  // FLOW_PRODUCT_*: resolve per-project or default heygen_mode before falling through.
  if (isProductVideoFlow(ft) && projectId) {
    const mode = await resolveProductFlowHeygenMode(db, projectId, ft);
    if (mode === "script_led") {
      const r = await ensureVideoScriptInPayload(db, config, jobId);
      if (!r.ok) throw new Error(r.error ?? "video script prep failed");
      return;
    }
    if (mode === "prompt_led") {
      const r = await ensureVideoPromptInPayload(db, config, jobId);
      if (!r.ok) throw new Error(r.error ?? "video prompt prep failed");
      return;
    }
    // If somehow unresolved (no project context, impossible here but defensive), fall through.
  }

  // Legacy flow names + Flow Engine: Video_Prompt_Generator (avatar mode via heygen_config)
  if (/no_avatar|heygen_no|HEYGEN_NO_AVATAR|NoAvatar/i.test(ft)) {
    const r = await ensureVideoPromptInPayload(db, config, jobId);
    if (!r.ok) throw new Error(r.error ?? "video prompt prep failed");
    return;
  }
  if (ft === "FLOW_VID_SCRIPT" || /video_script|script_generator/i.test(ft)) {
    const r = await ensureVideoScriptInPayload(db, config, jobId);
    if (!r.ok) throw new Error(r.error ?? "video script prep failed");
    return;
  }
  if (
    ft === "FLOW_VID_PROMPT" ||
    ft === "FLOW_VID_PROMPT_NO_AVATAR" ||
    /video_prompt|prompt_generator/i.test(ft)
  ) {
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
  job: { id: string; task_id: string; status: string; project_id: string; run_id: string; flow_type: string; platform?: string | null; generation_payload?: unknown },
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
    await recordLifecycleOutcomeSafe(db, job, "GENERATING", "generating");
  }
}

async function advanceToInReview(
  db: Pool,
  job: { id: string; task_id: string; project_id: string; run_id: string; flow_type: string; platform?: string | null; generation_payload?: unknown },
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
    await recordLifecycleOutcomeSafe(db, job, st, outcomeLabelForReviewStatus(st));
  }
}

function outcomeLabelForReviewStatus(status: string): string {
  if (status === "IN_REVIEW") return "in_review";
  if (status === "NEEDS_EDIT") return "needs_edit";
  if (status === "REJECTED") return "rejected";
  return status.toLowerCase();
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
  /Target closed|createTarget|Failed to open a new tab|Protocol error|Browser disconnected|Session closed|ECONNRESET|socket hang up|Navigation failed|setContent timed out|timed out after \d+ms/i;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract the Supabase object_path from a public storage URL so it can be signed. */
function extractObjectPathFromPublicUrl(config: AppConfig, url: string): string | null {
  if (!url.startsWith("http")) return url;
  const supabaseUrl = config.SUPABASE_URL;
  if (!supabaseUrl) return null;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${config.SUPABASE_ASSETS_BUCKET}/`;
  if (url.startsWith(publicPrefix)) return url.slice(publicPrefix.length);
  return null;
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

async function recordLifecycleOutcomeSafe(
  db: Pool,
  job: {
    project_id: string;
    run_id: string;
    task_id: string;
    flow_type: string;
    platform?: string | null;
    generation_payload?: unknown;
  },
  jobStatus: string,
  outcome: string,
  errorMessage?: string | null
): Promise<void> {
  const gp =
    job.generation_payload && typeof job.generation_payload === "object" && !Array.isArray(job.generation_payload)
      ? (job.generation_payload as Record<string, unknown>)
      : {};
  const candidateData =
    gp.candidate_data && typeof gp.candidate_data === "object" && !Array.isArray(gp.candidate_data)
      ? (gp.candidate_data as Record<string, unknown>)
      : {};
  await recordRunContentOutcomeSafe(db, {
    project_id: job.project_id,
    run_id: job.run_id,
    task_id: job.task_id,
    flow_type: job.flow_type,
    flow_kind: flowKindForContentLog(job.flow_type),
    outcome,
    job_status: jobStatus,
    slide_count: null,
    asset_count: await countAssetsForTask(db, job.project_id, job.task_id),
    summary: {
      platform: job.platform ?? candidateData.platform ?? null,
      idea_id: candidateData.idea_id ?? candidateData.id ?? null,
      content_idea: String(
        candidateData.content_idea ?? candidateData.title ?? candidateData.summary ?? ""
      ).slice(0, 280),
    },
    error_message: errorMessage?.trim() ? errorMessage.trim().slice(0, 500) : null,
  });
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
  maxRetries: number,
  logCtx?: {
    taskId?: string;
    runId?: string;
    template?: string;
    backgroundUrl?: string | null;
  }
): Promise<Response> {
  let lastErrMsg = `Renderer slide ${slideIndex} request failed`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    logPipelineEvent("info", "render", "Carousel render-binary attempt", {
      task_id: logCtx?.taskId,
      run_id: logCtx?.runId,
      data: {
        slide_index: slideIndex,
        template: logCtx?.template,
        renderer_endpoint: renderUrl,
        retry_attempt: attempt,
        max_retries: maxRetries,
        background_url: logCtx?.backgroundUrl ?? undefined,
        background_url_http: Boolean(logCtx?.backgroundUrl?.trim().startsWith("http")),
      },
    });
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
      logPipelineEvent("error", "render", lastErrMsg, {
        task_id: logCtx?.taskId,
        run_id: logCtx?.runId,
        data: {
          slide_index: slideIndex,
          template: logCtx?.template,
          renderer_endpoint: renderUrl,
          retry_attempt: attempt,
          max_retries: maxRetries,
          background_url: logCtx?.backgroundUrl ?? undefined,
          error_name: name || undefined,
        },
      });

      const transient =
        name === "AbortError" ||
        /aborted|timed out|timeout|fetch failed/i.test(msg) ||
        TRANSIENT_CAROUSEL_RENDERER_ERR.test(msg);

      if (transient && attempt < maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(lastErrMsg);
    }

    if (response.ok) {
      logPipelineEvent("info", "render", "Carousel render-binary succeeded", {
        task_id: logCtx?.taskId,
        run_id: logCtx?.runId,
        data: {
          slide_index: slideIndex,
          template: logCtx?.template,
          renderer_endpoint: renderUrl,
          retry_attempt: attempt,
          response_status: response.status,
        },
      });
      return response;
    }

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
    logPipelineEvent("error", "render", lastErrMsg, {
      task_id: logCtx?.taskId,
      run_id: logCtx?.runId,
      data: {
        slide_index: slideIndex,
        template: logCtx?.template,
        renderer_endpoint: renderUrl,
        retry_attempt: attempt,
        max_retries: maxRetries,
        response_status: response.status,
        background_url: logCtx?.backgroundUrl ?? undefined,
      },
    });
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

export type CarouselRenderOpts = {
  /** 1-based slide indices to re-render only (partial NEEDS_EDIT rework). */
  onlySlideIndices?: number[];
  /**
   * Recomposite HTML/CSS text on stored background plates only — never call Flux/Qwen/BFL.
   * Requires existing `MIMIC_BACKGROUND` or `MIMIC_VISUAL_PLATE` assets per slide.
   */
  textOverlayOnly?: boolean;
  /** In-memory slide copy overrides (mimic overlay lab) — merged before text layer build. */
  slideCopyOverrides?: Array<{ slide_index: number; llm_slide: Record<string, unknown> }>;
  /** Reviewer typography (`font_scale`, carousel_*_font_px) merged before render. */
  renderTypographyPatch?: Record<string, number>;
  /** Full-bleed mimic: semi-opaque white pad behind each text layer (reprint option). */
  textBacking?: boolean;
  /** CSS color for text highlight pad (#RRGGBB or rgba). */
  textBackingColor?: string;
  /** Optional brand logo composited onto each slide (reprint option). */
  logoOverlay?: { url: string; position?: string };
  /** Optional brand slide frame composited on top of each slide (reprint option). */
  frameOverlay?: { url: string; asset_id?: string };
  /** Per-call mimic visual similarity % override (regenerate route picker). */
  mimicVisualSimilarityPctOverride?: number;
  /** Per-call mimic image input mode override: reference_edit vs analysis_t2i (no reference). */
  mimicImageInputModeOverride?: MimicImageInputMode;
  /** Optional reviewer note appended to mimic image prompts (slide regenerate). */
  mimicRegenerationNote?: string;
  /** Skip post-render layout QA gate (internal reprint passes). */
  skipLayoutQa?: boolean;
};

async function finalizeCarouselJobAfterRender(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null,
  renderOpts?: CarouselRenderOpts
): Promise<void> {
  const priorStatus = job.status;
  const textOverlayOnly = Boolean(renderOpts?.textOverlayOnly);
  const keepInReview =
    textOverlayOnly &&
    (isReviewRetainStatusDuringTextOverlayReprint(priorStatus) || priorStatus === "RENDERING");

  const gpForLayout = (job.generation_payload ?? {}) as Record<string, unknown>;
  const skipLayoutAutoReprint = gpForLayout.layout_qc_skip_auto_reprint === true;

  let layoutBlocked = false;
  let layoutQcSummary: Record<string, unknown> | undefined;
  if (
    !keepInReview &&
    !renderOpts?.skipLayoutQa &&
    !skipLayoutAutoReprint &&
    !textOverlayOnly &&
    isTpGroundedCarouselRenderFlow(job.flow_type) &&
    config.MIMIC_LAYOUT_QA_ENABLED !== false
  ) {
    const layoutResult = await runMimicPostRenderLayoutLoop(db, config, job.id);
    layoutBlocked = layoutResult.blockReview;
    layoutQcSummary = {
      pass: layoutResult.pass,
      overall_score: layoutResult.layoutQc.overall_score,
      review_attention: layoutResult.layoutQc.review_attention,
      block_review: layoutResult.blockReview,
      iterations: layoutResult.reprintIterations,
    };
  }

  const finalStatus = layoutBlocked
    ? "BLOCKED"
    : keepInReview
      ? priorStatus
      : finalJobStatusAfterRender(recommendedRoute);
  if (!keepInReview || job.status !== finalStatus) {
    await updateJobStatus(db, job.id, finalStatus);
  }
  if (skipLayoutAutoReprint && !layoutBlocked && !keepInReview) {
    await db.query(
      `UPDATE caf_core.content_jobs
       SET generation_payload = COALESCE(generation_payload, '{}'::jsonb) - 'layout_qc_skip_auto_reprint',
           updated_at = now()
       WHERE id = $1`,
      [job.id]
    );
  }
  if (run && !keepInReview) {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: "RENDERING",
      to_state: finalStatus,
      triggered_by: "system",
      actor: layoutBlocked ? "layout-qc" : "job-pipeline",
      ...(layoutBlocked
        ? { metadata: { reason: "layout_qc_failed", layout_qc: layoutQcSummary } }
        : {}),
    });
  }
}

async function processCarouselJob(
  db: Pool,
  config: AppConfig,
  pipeConfig: PipelineConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null,
  renderOpts?: CarouselRenderOpts
) {
  assertRenderNotPaused();
  beginRenderActivity({
    task_id: job.task_id,
    run_id: job.run_id,
    flow_type: job.flow_type,
    kind: "carousel",
    phase: "starting",
  });
  try {
  const priorStatus = job.status;
  const textOverlayOnly = Boolean(renderOpts?.textOverlayOnly);
  const hasExplicitPartialRework =
    Boolean(renderOpts?.onlySlideIndices?.length) || Boolean(renderOpts?.textOverlayOnly);
  const freshForResume = await reloadJobRow(db, job.id);
  const resumeJob = freshForResume ?? job;
  if (
    !hasExplicitPartialRework &&
    isCarouselRenderStuckAfterComplete(resumeJob)
  ) {
    updateRenderActivity(job.task_id, { kind: "carousel", phase: "finalize_after_render" });
    await finalizeCarouselJobAfterRender(db, config, resumeJob, run, recommendedRoute, renderOpts);
    return;
  }

  const keepInReview =
    textOverlayOnly &&
    (isReviewRetainStatusDuringTextOverlayReprint(priorStatus) || priorStatus === "RENDERING");
  await warnIfRendererBaseUrlIsCafCore(pipeConfig.rendererBaseUrl, console.warn);
  if (!keepInReview) {
    await updateJobStatus(db, job.id, "RENDERING");
  }
  await mergeJobRenderState(db, job.id, {
    provider: "carousel-renderer",
    status: "pending",
    ...(textOverlayOnly ? { phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE } : {}),
  });

  if (run && !keepInReview && priorStatus !== "RENDERING") {
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: run.project_id,
      from_state: priorStatus,
      to_state: "RENDERING",
      triggered_by: "system",
      actor: "job-pipeline",
    });
  }

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  if (renderOpts?.renderTypographyPatch && Object.keys(renderOpts.renderTypographyPatch).length > 0) {
    mergeCarouselTypographyIntoGeneratedOutputRender(gen, renderOpts.renderTypographyPatch);
  }
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
  // Defensive: some signal-pack candidates are "thread" format even when the flow is a carousel.
  // Renderer templates assume carousel semantics; leaking "thread" here causes confusing downstream payloads.
  if (typeof baseRender.format !== "string" || baseRender.format.trim().toLowerCase() !== "carousel") {
    baseRender.format = "carousel";
  }
  baseRender = stripNonRenderableDeckFields(baseRender);
  baseRender = normalizeLlmParsedForSchemaValidation(job.flow_type, baseRender);
  const mimicForSlidePick = pickMimicPayload(job.generation_payload);
  const mimicSlideTarget =
    isTpGroundedCarouselRenderFlow(job.flow_type) && mimicForSlidePick
      ? targetMimicCarouselCopySlideCount(job.generation_payload as Record<string, unknown>, mimicForSlidePick)
      : null;
  const slides = slidesFromGeneratedOutput(
    baseRender,
    mimicSlideTarget != null ? { preferred_slide_count: mimicSlideTarget } : undefined
  );
  const usableSlides = slides.filter((s) => slideHasRenderableContent(s as Record<string, unknown>));

  let slidesForRender = usableSlides as Record<string, unknown>[];
  if (renderOpts?.slideCopyOverrides?.length) {
    slidesForRender = [...slidesForRender];
    for (const ov of renderOpts.slideCopyOverrides) {
      const idx = Math.max(1, Math.floor(ov.slide_index));
      slidesForRender = mergeSlideCopyAtCarouselIndex(slidesForRender, idx, ov.llm_slide);
    }
  }

  if (slidesForRender.length === 0) {
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

  const renderBase = carouselRenderBaseForPipeline(baseRender, slidesForRender);
  let n = carouselSlideCount(renderBase);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid carousel slide count (${String(n)}); check generated_output / structure_variables.slide_count.`);
  }

  const mimicPayloadRaw = pickMimicPayload(job.generation_payload);
  let mimicPayload = mimicPayloadRaw;
  if (
    (config.MIMIC_IMAGE_ENABLED || textOverlayOnly) &&
    isTpGroundedCarouselRenderFlow(job.flow_type) &&
    mimicPayloadRaw
  ) {
    mimicPayload = await refreshMimicPayloadReferenceUrls(config, mimicPayloadRaw);
    const gpForMimicReconcile = job.generation_payload as Record<string, unknown> | null | undefined;
    const templateBackgroundsPrepared = Boolean(
      gpForMimicReconcile &&
        typeof gpForMimicReconcile.template_backgrounds_prepared_at === "string" &&
        gpForMimicReconcile.template_backgrounds_prepared_at.trim()
    );
    const mimicBgAssets = await listAssetsByTask(db, job.project_id, job.task_id).catch(() => []);
    const hasStoredBackgroundPlates = mimicBgAssets.some(
      (a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND"
    );
    mimicPayload = reconcileMimicPayloadAtRender(job.flow_type, mimicPayload, {
      hasStoredBackgroundPlates,
      templateBackgroundsPrepared,
    });
    mimicPayload = {
      ...mimicPayload,
      reference_items: normalizeMimicReferenceItems(mimicPayload.reference_items),
    };
    mimicPayload = await backfillMimicArchiveReferenceItems(db, job, mimicPayload);

    if (mimicPayload.mode === "carousel_visual" || mimicPayload.mode === "template_bg") {
      const { mimic: filtered, removed_slide_indices } =
        filterPromotionalSlidesFromMimicPayload(mimicPayload);
      if (removed_slide_indices.length > 0) {
        logPipelineEvent("info", "render", "Filtered promotional slides from carousel_visual", {
          task_id: job.task_id,
          data: {
            original_reference_count: mimicPayload.reference_items.length,
            filtered_slide_count: filtered.reference_items.length,
            removed_indices: removed_slide_indices,
          },
        });
        mimicPayload = filtered;
      }
    }

    if (mimicPayload.mode === "template_bg" && mimicPayload.reference_items.length > 0) {
      const llmCount = usableSlides.length;
      const outputCount = resolveMimicCarouselRenderSlideCount({
        mimic: mimicPayload,
        plannedTarget: mimicSlideTarget,
        llmRenderableCount: llmCount,
      });
      if (mimicPayload.reference_items.length !== outputCount) {
        mimicPayload = reconcileMimicPayloadToOutputSlideCount(mimicPayload, outputCount);
        logPipelineEvent("info", "render", "Reconciled template_bg mimic to output slide count", {
          task_id: job.task_id,
          data: {
            reference_frames: mimicPayload.reference_items.length,
            output_slides: outputCount,
            llm_slides: llmCount,
            planned_target: mimicSlideTarget,
          },
        });
      }
      n = outputCount;
      slidesForRender = alignSlidesToMimicOutputCount(slides, slidesForRender, n);
    } else if (mimicPayload.mode === "carousel_visual" && mimicPayload.reference_items.length > 0) {
      const llmCount = usableSlides.length;
      const outputCount = resolveMimicCarouselRenderSlideCount({
        mimic: mimicPayload,
        plannedTarget: mimicSlideTarget,
        llmRenderableCount: llmCount,
      });
      mimicPayload = reconcileMimicPayloadToOutputSlideCount(mimicPayload, outputCount);
      n = outputCount;
      slidesForRender = alignSlidesToMimicOutputCount(slides, slidesForRender, n);
      if (llmCount > 0 && outputCount > llmCount) {
        logPipelineEvent("warn", "render", "Mimic render padded slide copy — LLM returned fewer slides than planned", {
          task_id: job.task_id,
          data: {
            output_slides: outputCount,
            llm_slides: llmCount,
            planned_target: mimicSlideTarget,
          },
        });
      }
    } else {
      n = Math.min(n, usableSlides.length);
    }

    mimicPayload = reconcileFullBleedSlidePlansAtRender(mimicPayload);
    mimicPayload = {
      ...mimicPayload,
      slide_plans: clampSlidePlansToOutputCount(
        extendSlidePlansForOutputCount(mimicPayload, n),
        n
      ),
    };
    mimicPayload = alignMimicSlidePlansToReferences(mimicPayload);
  }

  const projectPinnedTemplates = await listProjectCarouselTemplates(db, job.project_id).catch(() => []);
  const mimicJob =
    isTpGroundedCarouselRenderFlow(job.flow_type) && Boolean(mimicPayload);
  /** Text-only reprint must use mimic DocAI/HBS path even when image gen is disabled globally. */
  const isMimicCarousel =
    config.MIMIC_IMAGE_ENABLED &&
    mimicJob;
  const isMimicCarouselRender =
    mimicJob && (config.MIMIC_IMAGE_ENABLED || textOverlayOnly);
  const mimicVisualGenAiReachable =
    isMimicCarousel && config.MIMIC_IMAGE_PROVIDER === "nvidia"
      ? await isNvidiaVisualGenAiReachable(config)
      : true;
  const mimicProjectRender = isMimicCarouselRender
    ? await loadProjectMimicRenderSettings(db, job.project_id, config)
    : null;
  // TP-grounded carousel (manual mimic + visual-first ideas): art-only plates + HTML/DocAI text.
  // Never bake copy into image models — required for reprint-text-overlay and layer editor.
  const mimicCarouselTextViaFlux = false;
  if (
    isMimicCarousel &&
    !textOverlayOnly &&
    mimicProjectRender?.carouselTextViaFlux &&
    mimicPayload?.mode !== "template_bg"
  ) {
    logPipelineEvent("info", "render", "ignoring mimic_carousel_text_via_flux — text is HTML/DocAI overlay only", {
      run_id: job.run_id,
      task_id: job.task_id,
      flow_type: job.flow_type,
    });
  }
  const mimicBflModelOverride = mimicProjectRender?.bflModel ?? null;
  const mimicVisualSimilarityPct =
    (typeof renderOpts?.mimicVisualSimilarityPctOverride === "number"
      ? renderOpts.mimicVisualSimilarityPctOverride
      : undefined) ??
    mimicProjectRender?.visualSimilarityPct ??
    config.MIMIC_VISUAL_SIMILARITY_PCT;
  const mimicImageInputMode =
    renderOpts?.mimicImageInputModeOverride ??
    (mimicPayload && isWhyMimicExecution(job.flow_type, mimicPayload)
      ? "analysis_t2i"
      : mimicProjectRender?.imageInputMode ?? config.MIMIC_IMAGE_INPUT_MODE);
  const mimicRegenerationNote = renderOpts?.mimicRegenerationNote?.trim() || undefined;
  const mimicImageProviderLabel = () => mimicImageProviderAssetLabel(config, mimicBflModelOverride);
  let template = isMimicCarouselRender
    ? MIMIC_LAYOUT_TEMPLATE_DEFAULT
    : await pickCarouselTemplateForRender(pipeConfig.rendererBaseUrl, job.generation_payload, {
        allowedTemplates: projectPinnedTemplates,
        implicitPickSeed: job.task_id,
      });
  const mimicUsesDocAiTextLayout = Boolean(
    isMimicCarouselRender && mimicPayload && mimicPayloadHasDocAiTextLayout(mimicPayload)
  );
  const mimicTemplateBgJob = Boolean(isMimicCarouselRender && mimicPayload?.mode === "template_bg");
  const mimicV1ForLayout =
    job.generation_payload &&
    typeof job.generation_payload === "object" &&
    !Array.isArray(job.generation_payload)
      ? (job.generation_payload as Record<string, unknown>).mimic_v1
      : null;
  const hasReviewerSavedLayout = mimicV1HasReviewerDocAiLayerPositions(mimicV1ForLayout);
  const mimicUsesDocAiTextForRender = Boolean(
    mimicPayload && (mimicUsesDocAiTextLayout || mimicTemplateBgJob || hasReviewerSavedLayout)
  );
  if (isMimicCarouselRender && mimicPayload) {
    if (mimicTemplateBgJob) {
      const evidenceTemplate = await ensureMimicEvidenceCarouselTemplate(
        db,
        config,
        job.project_id,
        { id: job.id, task_id: job.task_id },
        mimicPayload,
        { projectPinnedTemplates }
      );
      template = evidenceTemplate.template_base;
    } else if (mimicUsesDocAiTextLayout) {
      // carousel_visual + Document AI geometry → shared absolute-layer template.
      template = MIMIC_FULL_BLEED_RENDER_TEMPLATE;
    } else {
      // carousel_visual without OCR blocks: shared HBS + coarse block vars at render time.
      template = MIMIC_FULL_BLEED_RENDER_TEMPLATE;
    }
  }
  const strategyRow = await getStrategyDefaults(db, job.project_id);
  const projectRow = await getProjectById(db, job.project_id);
  const projectDisplayName =
    (projectRow?.display_name?.trim() || projectRow?.slug?.trim() || "").trim() || null;
  const projectInstagramHandle = resolveProjectInstagramHandle({
    generationPayload: job.generation_payload as Record<string, unknown> | null,
    strategyInstagramHandle: strategyRow?.instagram_handle ?? null,
    projectSlug: projectRow?.slug ?? null,
  });
  const projectBrandAssets =
    isMimicCarouselRender && mimicPayload && config.MIMIC_USE_PROJECT_BRAND_PALETTE
      ? await listProjectBrandAssets(db, job.project_id).catch(() => [])
      : [];
  let useProjectBrandPalette = config.MIMIC_USE_PROJECT_BRAND_PALETTE;
  let mimicThemeBrandAssets = projectBrandAssets;
  const bvsForRender = parseBvsFromPayload(job.generation_payload as Record<string, unknown>);
  if (bvsForRender?.enabled && isMimicCarouselRender) {
    const bvsColors = paletteFromBrandBibleSnapshot(bvsForRender.bible_snapshot).filter((c) =>
      /^#[0-9a-fA-F]{6}$/i.test(c)
    );
    if (bvsColors.length > 0) {
      useProjectBrandPalette = true;
      mimicThemeBrandAssets = [
        {
          id: "bvs-synthetic-palette",
          project_id: job.project_id,
          kind: "palette",
          label: "Brand Visual System palette",
          sort_order: 0,
          public_url: null,
          storage_path: null,
          heygen_asset_id: null,
          heygen_synced_at: null,
          metadata_json: { colors: bvsColors },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }
  }

  // Persist chosen carousel template onto the job payload so downstream systems (review UI, editorial learning,
  // engineering prompts) can reliably resolve `carousel_template_name` by task_id. Without this, the resolver
  // falls back to "default" even when render used a different template.
  await db.query(
    `UPDATE caf_core.content_jobs SET
      generation_payload = (
        jsonb_set(
          jsonb_set(
            jsonb_set(COALESCE(generation_payload, '{}'::jsonb), '{template}', to_jsonb($1::text), true),
            '{render,html_template_name}', to_jsonb(($1::text || '.hbs')::text), true
          ),
          '{render,template_key}', to_jsonb($1::text), true
        ) #- '{carousel_template_exclude_for_next_render}'
      ),
      updated_at = now()
     WHERE id = $2`,
    [template, job.id]
  );

  await mergeJobRenderState(db, job.id, {
    provider: "carousel-renderer",
    status: "pending",
    phase: textOverlayOnly ? MIMIC_TEXT_OVERLAY_REPRINT_PHASE : "preparing_slides",
    slide_total: n,
    template,
    ...(textOverlayOnly ? { render_step: "preparing_slides" } : {}),
  });

  try {
    const mimicPromptOverrides = isMimicCarousel ? await loadMimicPromptOverrides(db) : null;

    if (
      isMimicCarousel &&
      !textOverlayOnly &&
      mimicPayload &&
      mimicCarouselNeedsBackgroundPlate(mimicPayload) &&
      !mimicCarouselTextViaFlux
    ) {
      for (let i = 1; i <= n; i++) {
        const preMode = effectiveMimicSlideRenderMode(mimicPayload, i, mimicVisualGenAiReachable, {
          generatedSlides: slidesForRender,
        });
        if (preMode === "hbs") {
          await requireMimicSlideBackgroundPlate(db, config, job, mimicPayload, i, {
            promptOverrides: mimicPromptOverrides,
            totalSlides: n,
            bflModelOverride: mimicBflModelOverride,
            visualSimilarityPct: mimicVisualSimilarityPct,
            imageInputMode: mimicImageInputMode,
            ...(mimicRegenerationNote ? { regenerationNote: mimicRegenerationNote } : {}),
          });
        }
      }
    }

    const partialIndices = (renderOpts?.onlySlideIndices ?? [])
      .map((i) => Math.floor(i))
      .filter((i) => Number.isFinite(i) && i >= 1 && i <= n);
    const uniquePartial = [...new Set(partialIndices)].sort((a, b) => a - b);
    const slideIndicesToRender =
      uniquePartial.length > 0 ? uniquePartial : Array.from({ length: n }, (_, j) => j + 1);

    if (uniquePartial.length > 0) {
      await deleteCarouselSlideAssetsAtPositions(db, job.project_id, job.task_id, uniquePartial);
    } else {
      await deleteCarouselSlideAssetsForTask(db, job.project_id, job.task_id);
    }

    const existingCarouselAssets =
      uniquePartial.length > 0
        ? await listAssetsByTask(db, job.project_id, job.task_id)
        : [];

    const slideResults: Array<{ index: number; public_url: string | null; object_path: string }> = [];
    for (const i of slideIndicesToRender) {
      if (uniquePartial.length > 0 && !textOverlayOnly) {
        await markCarouselRegenerateSlideProgress(db, job.id, i, "rendering");
      }
      assertRenderNotPaused();
      updateRenderActivity(job.task_id, {
        kind: "carousel",
        phase: `slide ${i}/${n}`,
        slide_index: i,
        slide_total: n,
      });
      await mergeJobRenderState(db, job.id, {
        provider: "carousel-renderer",
        status: "pending",
        phase: textOverlayOnly ? MIMIC_TEXT_OVERLAY_REPRINT_PHASE : "POST /render-binary",
        slide_index: i,
        slide_total: n,
        template,
        ...(textOverlayOnly ? { render_step: "POST /render-binary" } : {}),
      });

      const slideMode =
        isMimicCarouselRender && mimicPayload
          ? effectiveMimicSlideRenderMode(mimicPayload, i, mimicVisualGenAiReachable, {
              generatedSlides: slidesForRender,
            })
          : null;

      let slideRenderBase = renderBase;
      const mimicCompositesOnPlate =
        isMimicCarouselRender && mimicPayload && (slideMode === "hbs" || slideMode === "full_bleed");

      const mimicCompositesOnStoredPlate =
        isMimicCarouselRender &&
        mimicPayload &&
        (slideMode === "hbs" || (slideMode === "full_bleed" && textOverlayOnly));

      if (slideMode === "full_bleed" && mimicPayload && !mimicCarouselTextViaFlux && !textOverlayOnly) {
        const { buffer, mimeType } = await renderMimicCarouselSlideFullBleed(
          db,
          config,
          job,
          mimicPayload,
          i,
          {
            promptOverrides: mimicPromptOverrides,
            projectHandle: projectInstagramHandle,
            bflModelOverride: mimicBflModelOverride,
            visualSimilarityPct: mimicVisualSimilarityPct,
            imageInputMode: mimicImageInputMode,
            ...(mimicRegenerationNote ? { regenerationNote: mimicRegenerationNote } : {}),
          }
        );
        const plateUrl = await persistMimicVisualPlateForSlide(db, config, job, i, buffer, mimeType);
        slideRenderBase = { ...renderBase, background_image_url: plateUrl };
        const mimicTypo = mimicSlideTypographyPatch(mimicPayload, i, n, {
          skipIfReviewerSet: renderBase as Record<string, unknown>,
        });
        slideRenderBase = {
          ...slideRenderBase,
          ...mimicSlideThemePatch(mimicPayload, mimicThemeBrandAssets, { useProjectBrandPalette }),
          ...mimicTypo,
        };
      } else if (mimicCompositesOnStoredPlate && mimicPayload) {
        const needsBgPlate = mimicCarouselNeedsBackgroundPlate(mimicPayload) || textOverlayOnly;
        if (needsBgPlate) {
          const slideBg = await requireMimicSlideBackgroundPlate(db, config, job, mimicPayload, i, {
            bflModelOverride: mimicBflModelOverride,
            totalSlides: n,
            reuseStoredPlatesOnly: textOverlayOnly,
            visualSimilarityPct: mimicVisualSimilarityPct,
            imageInputMode: mimicImageInputMode,
            ...(mimicRegenerationNote ? { regenerationNote: mimicRegenerationNote } : {}),
          });
          slideRenderBase = { ...renderBase, background_image_url: slideBg };
        }
        if (!mimicCarouselTextViaFlux) {
          const mimicTypo = mimicSlideTypographyPatch(mimicPayload, i, n, {
            skipIfReviewerSet: renderBase as Record<string, unknown>,
          });
          slideRenderBase = {
            ...slideRenderBase,
            ...mimicSlideThemePatch(mimicPayload, mimicThemeBrandAssets, { useProjectBrandPalette }),
            ...mimicTypo,
          };
        }
      }

      const mimicStrictBgInline =
        !mimicCarouselTextViaFlux &&
        mimicCompositesOnPlate &&
        (slideMode === "full_bleed" ||
          (slideMode === "hbs" && mimicCarouselNeedsBackgroundPlate(mimicPayload!)));
      slideRenderBase = await withInlinedBackgroundImage(slideRenderBase, {
        config,
        strict: Boolean(mimicStrictBgInline),
      });
      if (mimicStrictBgInline) {
        assertMimicSlideBackgroundPresent(
          job.task_id,
          i,
          slideRenderBase,
          "Background plate URL missing after inline step — refusing plain-paper composite."
        );
        const inlinedBg =
          typeof slideRenderBase.background_image_url === "string"
            ? slideRenderBase.background_image_url.trim()
            : "";
        if (!inlinedBg.startsWith("data:")) {
          throw new Error(
            `Mimic background plate for ${job.task_id} slide ${i} must be inlined as data: URI before render`
          );
        }
      }

      if (mimicCarouselTextViaFlux && mimicPayload && slideMode && !textOverlayOnly) {
        const onImageCopy = slideOnImageCopyFromSlides(slidesForRender, i);
        const fluxStarted = Date.now();
        const rendered = await renderMimicCarouselSlideFullBleed(db, config, job, mimicPayload, i, {
          onImageCopy,
          promptOverrides: mimicPromptOverrides,
          projectHandle: projectInstagramHandle,
          bakeTextOnImage: false,
          bflModelOverride: mimicBflModelOverride,
          visualSimilarityPct: mimicVisualSimilarityPct,
          imageInputMode: mimicImageInputMode,
          ...(mimicRegenerationNote ? { regenerationNote: mimicRegenerationNote } : {}),
        });
        const fluxBuf = rendered.buffer;
        const fluxMime = rendered.mimeType;
        const fluxLatencyMs = Math.max(0, Date.now() - fluxStarted);
        await tryInsertApiCallAudit(db, {
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: `mimic_flux_carousel_slide_${i}`,
          provider: mimicImageProviderLabel(),
          model: null,
          ok: true,
          requestJson: {
            slide_index: i,
            slide_mode: slideMode,
            on_image_copy_chars: onImageCopy.length,
          },
          responseJson: { png_bytes: fluxBuf.length, latency_ms: fluxLatencyMs },
          latencyMs: fluxLatencyMs,
        });
        const stored = await persistCarouselSlidePng(
          db,
          config,
          job,
          i,
          fluxBuf,
          fluxMime,
          mimicImageProviderLabel()
        );
        slideResults.push({ index: i, public_url: stored.public_url, object_path: stored.object_path });
        continue;
      }

      let ctx = buildSlideRenderContext(slideRenderBase, slidesForRender, i, {
        instagramHandle: projectInstagramHandle,
        projectDisplayName,
      });
      if (mimicUsesDocAiTextForRender && mimicPayload && !mimicCarouselTextViaFlux) {
        const theme = inferMimicCarouselTheme(mimicPayload.visual_guideline);
        const rawLlmSlide = pickSlideByCarouselIndex(slidesForRender, i);
        const llmSlideForDocAi =
          mimicTemplateBgJob && n > 0
            ? templateBgLlmSlideForDocAi(i, n, rawLlmSlide)
            : rawLlmSlide;
        const slideUsesFullBleed = slideMimicRenderMode(mimicPayload, i) === "full_bleed";
        const mimicV1Raw =
          job.generation_payload &&
          typeof job.generation_payload === "object" &&
          !Array.isArray(job.generation_payload)
            ? (job.generation_payload as Record<string, unknown>).mimic_v1
            : null;
        const rawLayerPosOverrides =
          pickMimicDocAiLayerPositionsForSlide(mimicV1Raw, i) ??
          pickMimicDocAiLayerPositionsForSlide(mimicPayload, i);
        const layerPosOverrides =
          mimicTemplateBgJob && rawLayerPosOverrides?.length
            ? sanitizeTemplateBgDocAiOverridesForInspect(rawLayerPosOverrides)
            : rawLayerPosOverrides;
        const hasReviewerLayout = Boolean(layerPosOverrides?.length);
        const useTextBacking = Boolean(
          (textOverlayOnly || slideUsesFullBleed || mimicTemplateBgJob) &&
            renderOpts?.textBacking !== false
        );
        const textBackingColor =
          renderOpts?.textBackingColor ??
          (typeof baseRender.mimic_text_backing_color === "string"
            ? baseRender.mimic_text_backing_color
            : undefined);
        const resolvedTextBackingColor = useTextBacking
          ? formatMimicTextBackingBackground(textBackingColor)
          : undefined;
        let docAiLayers = buildMimicDocAiRenderTextLayers(
          mimicPayload,
          i,
          llmSlideForDocAi,
          {
            ink: theme.ink,
            body: theme.body,
          },
          {
            projectHandle: projectInstagramHandle,
            textBacking: useTextBacking,
            textBackingColor: resolvedTextBackingColor,
            avoidCenterSubject: Boolean(
              useTextBacking && (slideUsesFullBleed || mimicTemplateBgJob) && !hasReviewerLayout
            ),
            totalSlides: n,
          }
        );
        if (layerPosOverrides?.length) {
          const usesCopySlotEditorLayout = layerPosOverrides.some(
            (o) => isCopySlotEditorLayerPositionKey(o.layer_key) && !o.hidden
          );
          docAiLayers = applyMimicDocAiLayerPositionOverrides(
            usesCopySlotEditorLayout ? [] : docAiLayers,
            layerPosOverrides,
            {
              applySavedTextOnBaseLayers: !mimicTemplateBgJob,
            }
          );
          docAiLayers = docAiLayers.map((layer) => ({ ...layer, text_backing: useTextBacking }));
        }
        const useDocAiLayers =
          docAiLayers.length > 0 &&
          (hasReviewerLayout ||
            textOverlayOnly ||
            mimicTemplateBgJob ||
            mimicDocAiLayersCoverLlmCopy(docAiLayers, llmSlideForDocAi));
        if (useDocAiLayers) {
          const renderedWithCopy = docAiLayers.filter((layer) => String(layer.text ?? "").trim().length > 0);
          if (textOverlayOnly && renderedWithCopy.length === 0 && slideHasRenderableContent(llmSlideForDocAi)) {
            const copy = slideHeadlineBodyForRender(llmSlideForDocAi);
            logPipelineEvent(
              "info",
              "render",
              "DocAI layers empty on text reprint — falling back to slide headline/body",
              {
                task_id: job.task_id,
                data: { slide_index: i, headline_chars: copy.headline.length, body_chars: copy.body.length },
              }
            );
            ctx = applySlideCopyToRenderContext(ctx, i, copy);
          } else if (textOverlayOnly && renderedWithCopy.length === 0) {
            throw new Error(
              `Text overlay reprint produced empty on-slide copy for ${job.task_id} slide ${i} — save layout text before reprinting.`
            );
          } else {
            ctx = {
              ...ctx,
              mimic_render_text_layers: docAiLayers,
              mimic_use_docai_layers: true,
              ...(useTextBacking
                ? {
                    mimic_text_backing: true,
                    mimic_text_backing_color: resolvedTextBackingColor,
                    ...(hasReviewerLayout
                      ? {}
                      : {
                          mimic_avoid_center_subject: true,
                          // Constrain trait copy to side columns only for art-only
                          // full-bleed plates — template_bg keeps full-width text.
                          ...(slideUsesFullBleed ? { mimic_full_bleed_layout: true } : {}),
                        }),
                  }
                : {}),
            };
          }
        } else if (slideHasRenderableContent(llmSlideForDocAi)) {
          const copy = slideHeadlineBodyForRender(llmSlideForDocAi);
          logPipelineEvent(
            "warn",
            "render",
            docAiLayers.length > 0
              ? "DocAI overlay missed LLM copy — falling back to HBS copy stack"
              : "DocAI overlay returned no layers — falling back to HBS copy stack",
            {
              task_id: job.task_id,
              data: {
                slide_index: i,
                headline_chars: copy.headline.length,
                body_chars: copy.body.length,
                docai_layer_count: docAiLayers.length,
                text_overlay_only: textOverlayOnly,
              },
            }
          );
          ctx = applySlideCopyToRenderContext(ctx, i, copy);
        } else if (textOverlayOnly) {
          throw new Error(
            `Text overlay reprint produced no copy layers for ${job.task_id} slide ${i} (DocAI layout empty and no headline/body in job payload).`
          );
        }
      }
      if (renderOpts?.logoOverlay?.url?.trim()) {
        ctx = {
          ...ctx,
          logo_overlay: {
            url: renderOpts.logoOverlay.url.trim(),
            position: renderOpts.logoOverlay.position?.trim() || "br",
          },
        };
      }
      if (renderOpts?.frameOverlay?.url?.trim()) {
        ctx = {
          ...ctx,
          frame_overlay: {
            url: renderOpts.frameOverlay.url.trim(),
          },
        };
      }

      ctx = applySingleSlideBinaryRenderContext(ctx, i, n);

      const body = {
        task_id: job.task_id,
        run_id: job.run_id,
        template,
        data: { render: ctx, task_id: job.task_id, run_id: job.run_id },
        slide_index: i,
      };

      const renderUrl = `${pipeConfig.rendererBaseUrl.replace(/\/$/, "")}/render-binary`;
      const backgroundUrl =
        typeof slideRenderBase.background_image_url === "string"
          ? slideRenderBase.background_image_url.trim()
          : null;
      const slideStarted = Date.now();
      const response = await postCarouselRenderBinary(
        renderUrl,
        body,
        pipeConfig.carouselRendererSlideTimeoutMs,
        i,
        pipeConfig.carouselRendererSlideRetryAttempts,
        {
          taskId: job.task_id,
          runId: job.run_id,
          template,
          backgroundUrl,
        }
      );
      const latencyMs = Math.max(0, Date.now() - slideStarted);
      const slideCostUsd = estimateCarouselSlideFlyUsd(latencyMs, config.CAF_COST_FLY_CAROUSEL_RENDERER_USD_PER_HOUR);

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
        responseJson: { png_bytes: buf.length, latency_ms: latencyMs },
        latencyMs,
        estimatedCostUsd: slideCostUsd,
      });
      const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const objectPath = textOverlayOnly
        ? `carousels/${safeRun}/${safeTask}/slide_${String(i).padStart(3, "0")}_r${Date.now()}.png`
        : `carousels/${safeRun}/${safeTask}/slide_${String(i).padStart(3, "0")}.png`;

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
      if (uniquePartial.length > 0 && !textOverlayOnly) {
        await markCarouselRegenerateSlideProgress(db, job.id, i, "completed");
      }
    }

    await mergeJobRenderState(db, job.id, {
      provider: "carousel-renderer",
      status: "completed",
      slides: slideResults,
      ...(textOverlayOnly
        ? {
            phase: MIMIC_TEXT_OVERLAY_REPRINT_PHASE,
            completed_at: new Date().toISOString(),
            error: null,
          }
        : { phase: "completed", error: null }),
    });
    await db.query(
      `UPDATE caf_core.content_jobs
       SET generation_payload = COALESCE(generation_payload, '{}'::jsonb) - 'last_error' - 'generation_error',
           updated_at = now()
       WHERE id = $1`,
      [job.id]
    );

    const manifestSlides = slideResults.map((s) => ({
      index: s.index,
      object_path: s.object_path,
      public_url: s.public_url,
    }));
    if (uniquePartial.length > 0) {
      for (const a of existingCarouselAssets) {
        if ((a.asset_type ?? "").toUpperCase() !== "CAROUSEL_SLIDE") continue;
        const idx = a.position + 1;
        if (manifestSlides.some((s) => s.index === idx)) continue;
        manifestSlides.push({
          index: idx,
          object_path: a.object_path ?? "",
          public_url: a.public_url,
        });
      }
      manifestSlides.sort((a, b) => a.index - b.index);
    }

    // 5B render manifest (additive): stable “what we produced” snapshot for downstream audit/review/learning.
    await db.query(
      `UPDATE caf_core.content_jobs SET
         generation_payload = jsonb_set(
           COALESCE(generation_payload, '{}'::jsonb),
           '{render_manifest}',
           $1::jsonb,
           true
         ),
         updated_at = now()
       WHERE id = $2`,
      [
        JSON.stringify({
          render_type: mimicCarouselTextViaFlux ? "mimic_flux" : "template",
          asset_type: "carousel",
          template: mimicCarouselTextViaFlux ? null : template,
          renderer: mimicCarouselTextViaFlux ? mimicImageProviderLabel() : "carousel-renderer",
          slide_count: n,
          partial_rework: uniquePartial.length > 0 ? uniquePartial : undefined,
          slides: manifestSlides,
          finished_at: new Date().toISOString(),
        }),
        job.id,
      ]
    );

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
        slidesForRender,
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
        phase: textOverlayOnly ? MIMIC_TEXT_OVERLAY_REPRINT_PHASE : "renderer_unavailable",
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
        job_status: keepInReview ? priorStatus : "RENDERING",
        slide_count: n,
        asset_count: 0,
        summary: carouselOutcomeSummary(job, template, slidesForRender, []),
        error_message: isRendererUnavailableHttpError(msg)
          ? "renderer_unavailable (HTTP 5xx: 502/503/504)"
          : "renderer_unavailable (fetch failed)",
      });
      throw new RenderNotReadyError(msg);
    } else {
      if (textOverlayOnly) {
        await recordCarouselTextOverlayReprintFailure(
          db,
          {
            id: job.id,
            task_id: job.task_id,
            project_id: job.project_id,
            status: priorStatus,
          },
          msg
        );
        throw err;
      }
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
        summary: carouselOutcomeSummary(job, template, slidesForRender, []),
        error_message: msg,
      });
      throw err;
    }
  }

  await finalizeCarouselJobAfterRender(db, config, job, run, recommendedRoute, renderOpts);
  } finally {
    endRenderActivity(job.task_id);
  }
}

/**
 * Re-run carousel PNG renders after OVERRIDE_ONLY editorial merge (typography / font_scale in slides JSON).
 * Does not invoke the LLM — reads current `generation_payload.generated_output`.
 */
export async function rerenderCarouselAfterEditorialOverride(db: Pool, config: AppConfig, jobId: string): Promise<void> {
  const job = await reloadJobRow(db, jobId);
  if (!job || !isCarouselFlow(job.flow_type) || isOfflinePipelineFlow(job.flow_type)) return;
  const run = await getRunByRunId(db, job.project_id, job.run_id);
  const pipeConfig = getPipelineConfig(config);
  await processCarouselJob(db, config, pipeConfig, job, run, null);
}

/**
 * Re-render only selected carousel slides (1-based indices). Other slide assets are kept.
 * Used by partial NEEDS_EDIT rework for mimic / carousel flows.
 */
export async function rerenderCarouselSlidesAtIndices(
  db: Pool,
  config: AppConfig,
  jobId: string,
  slideIndices1Based: number[],
  renderOpts?: Pick<
    CarouselRenderOpts,
    | "textOverlayOnly"
    | "mimicVisualSimilarityPctOverride"
    | "mimicImageInputModeOverride"
    | "mimicRegenerationNote"
  >
): Promise<void> {
  const job = await reloadJobRow(db, jobId);
  if (!job || !isCarouselFlow(job.flow_type) || isOfflinePipelineFlow(job.flow_type)) {
    throw new Error("carousel_slide_rework_requires_carousel_job");
  }
  const indices = [...new Set(slideIndices1Based.map((i) => Math.floor(i)).filter((i) => i >= 1))].sort(
    (a, b) => a - b
  );
  if (indices.length === 0) throw new Error("slide_rework_indices_required");

  if (!renderOpts?.textOverlayOnly) {
    await markCarouselRegenerateStarted(db, jobId, indices);
    await deleteCarouselSlideAssetsAtPositions(db, job.project_id, job.task_id, indices);
    await deleteMimicVisualPlateAssetsAtPositions(db, job.project_id, job.task_id, indices);
    const mimicPayload = pickMimicPayload(job.generation_payload);
    const usesTemplateBgSlots =
      isTpGroundedCarouselRenderFlow(job.flow_type) &&
      mimicPayload?.mode === "template_bg" &&
      mimicDeckUsesSlotDeduplication(mimicPayload);
    const totalSlides =
      usesTemplateBgSlots && mimicPayload
        ? (targetMimicCarouselCopySlideCount(
            job.generation_payload as Record<string, unknown>,
            mimicPayload
          ) ?? Math.max(...indices, 1))
        : Math.max(...indices, 1);
    const bgAssetPositions = usesTemplateBgSlots
      ? templateBgAssetPositionsForSlideIndices(indices, totalSlides)
      : indices.map((i) => i - 1);
    await deleteMimicBackgroundAssetsAtPositions(
      db,
      job.project_id,
      job.task_id,
      bgAssetPositions
    );
  }

  const run = await getRunByRunId(db, job.project_id, job.run_id);
  const pipeConfig = getPipelineConfig(config);
  try {
    await processCarouselJob(db, config, pipeConfig, job, run, null, {
      onlySlideIndices: indices,
      textOverlayOnly: renderOpts?.textOverlayOnly,
      ...(typeof renderOpts?.mimicVisualSimilarityPctOverride === "number"
        ? { mimicVisualSimilarityPctOverride: renderOpts.mimicVisualSimilarityPctOverride }
        : {}),
      ...(renderOpts?.mimicImageInputModeOverride
        ? { mimicImageInputModeOverride: renderOpts.mimicImageInputModeOverride }
        : {}),
      ...(renderOpts?.mimicRegenerationNote?.trim()
        ? { mimicRegenerationNote: renderOpts.mimicRegenerationNote.trim() }
        : {}),
    });
    if (!renderOpts?.textOverlayOnly) {
      await markCarouselRegenerateFinished(db, jobId, true);
    }
  } catch (err) {
    if (!renderOpts?.textOverlayOnly) {
      const msg = err instanceof Error ? err.message : String(err);
      await markCarouselRegenerateFinished(db, jobId, false, msg);
    }
    throw err;
  }
}

/**
 * Re-run Puppeteer text compositing on stored mimic plates — same copy, no Flux/Qwen/BFL billing.
 * Use after changing overlay code (`mimic-slide-typography`, renderer contrast, `carousel_mimic_bg.hbs`).
 */
export async function persistCarouselRenderTypographyPatch(
  db: Pool,
  jobId: string,
  patch: Record<string, number>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const job = await reloadJobRow(db, jobId);
  if (!job) throw new Error("job_not_found");
  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  mergeCarouselTypographyIntoGeneratedOutputRender(gen, patch);
  await q(
    db,
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: gen }), jobId]
  );
}

export async function persistCarouselTextBackingColor(
  db: Pool,
  jobId: string,
  color: string
): Promise<void> {
  const normalized = formatMimicTextBackingBackground(color);
  const job = await reloadJobRow(db, jobId);
  if (!job) throw new Error("job_not_found");
  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const render =
    typeof gen.render === "object" && gen.render && !Array.isArray(gen.render)
      ? (gen.render as Record<string, unknown>)
      : {};
  gen.render = { ...render, mimic_text_backing_color: normalized };
  await q(
    db,
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: gen }), jobId]
  );
}

export async function rerenderCarouselTextOverlay(
  db: Pool,
  config: AppConfig,
  jobId: string,
  slideIndices1Based?: number[],
  renderExtras?: Pick<
    CarouselRenderOpts,
    "slideCopyOverrides" | "renderTypographyPatch" | "textBacking" | "textBackingColor" | "logoOverlay" | "frameOverlay"
  >
): Promise<void> {
  if (renderExtras?.renderTypographyPatch && Object.keys(renderExtras.renderTypographyPatch).length > 0) {
    await persistCarouselRenderTypographyPatch(db, jobId, renderExtras.renderTypographyPatch);
  }
  if (renderExtras?.textBackingColor?.trim()) {
    await persistCarouselTextBackingColor(db, jobId, renderExtras.textBackingColor);
  }
  const job = await reloadJobRow(db, jobId);
  if (!job || !isTpGroundedCarouselRenderFlow(job.flow_type) || isOfflinePipelineFlow(job.flow_type)) {
    throw new Error("carousel_text_overlay_reprint_requires_mimic_carousel_job");
  }
  const run = await getRunByRunId(db, job.project_id, job.run_id);
  const pipeConfig = getPipelineConfig(config);
  const indices =
    slideIndices1Based && slideIndices1Based.length > 0
      ? [...new Set(slideIndices1Based.map((i) => Math.floor(i)).filter((i) => i >= 1))].sort((a, b) => a - b)
      : undefined;
  await processCarouselJob(db, config, pipeConfig, job, run, null, {
    ...(indices && indices.length > 0 ? { onlySlideIndices: indices } : {}),
    textOverlayOnly: true,
    ...(renderExtras?.slideCopyOverrides?.length
      ? { slideCopyOverrides: renderExtras.slideCopyOverrides }
      : {}),
    ...(renderExtras?.renderTypographyPatch && Object.keys(renderExtras.renderTypographyPatch).length > 0
      ? { renderTypographyPatch: renderExtras.renderTypographyPatch }
      : {}),
    textBacking: renderExtras?.textBacking !== false,
    ...(renderExtras?.textBackingColor?.trim() ? { textBackingColor: renderExtras.textBackingColor } : {}),
    ...(renderExtras?.logoOverlay?.url?.trim() ? { logoOverlay: renderExtras.logoOverlay } : {}),
    ...(renderExtras?.frameOverlay?.url?.trim() ? { frameOverlay: renderExtras.frameOverlay } : {}),
  });
}

async function processVideoJob(
  db: Pool,
  config: AppConfig,
  pipeConfig: PipelineConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
) {
  assertRenderNotPaused();
  beginRenderActivity({
    task_id: job.task_id,
    run_id: job.run_id,
    flow_type: job.flow_type,
    kind: "video",
    phase: "starting",
  });
  try {
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

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
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
      await ensureHeygenPayloadForFlowType(db, config, job.flow_type, job.id, job.project_id);

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
    const genOut = pickGeneratedOutputOrEmpty(freshJob.generation_payload);
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
    const genSnap = pickGeneratedOutputOrEmpty(job.generation_payload);
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
  } finally {
    endRenderActivity(job.task_id);
  }
}

function extractRenderPayload(genPayload: Record<string, unknown>): Record<string, unknown> {
  const {
    signal_pack_id,
    candidate_data,
    prompt_version_id,
    prompt_id,
    prompt_version_label,
    variation_index,
    schema_version,
    prompt_binding,
    ...rest
  } = genPayload;
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

export { RenderNotReadyError } from "../domain/render-not-ready-error.js";
