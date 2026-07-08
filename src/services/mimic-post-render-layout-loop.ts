import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  applyLayoutQaPatchesToOverrides,
  shouldHardBlockReviewFromSlides,
  slideLayoutAutoFixWarranted,
  slidePassesLayoutQa,
  type MimicLayoutQcV1,
} from "../domain/mimic-composite-layout-qa.js";
import {
  applyMimicDocAiLayerPositionOverrides,
  mergeMimicDocAiLayerPositionOverrides,
  pickMimicDocAiLayerPositionsForSlide,
  pickMimicDocAiLayerPositionsFromMimicV1,
  type MimicDocAiLayerPositionLayer,
} from "../domain/mimic-docai-layer-positions.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { isTpGroundedCarouselRenderFlow } from "../domain/top-performer-mimic-flow-types.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { listAssetsByTask } from "../repositories/assets.js";
import { patchMimicDocAiLayerPositions } from "../repositories/jobs.js";
import { qOne } from "../db/queries.js";
import {
  slideHasRenderableContent,
  slideHeadlineBodyForRender,
  slidesFromGeneratedOutput,
  stripNonRenderableDeckFields,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { resolveMimicCarouselRenderSlideCount, slideMimicRenderMode } from "./mimic-carousel-render.js";
import {
  analyzeSlideCompositeLayout,
  collectLayoutPatchesForSlide,
  loadSlidePngBuffer,
  logLayoutQcSummary,
  summarizeLayoutQc,
} from "./mimic-composite-layout-qa.js";
import {
  buildMimicDocAiRenderTextLayers,
  formatMimicTextBackingBackground,
  inferMimicCarouselTheme,
  mimicDocAiLayersCoverLlmCopy,
} from "./mimic-slide-typography.js";
import { templateBgLlmSlideForDocAi } from "./mimic-template-bg-render.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export type MimicPostRenderLayoutLoopResult = {
  pass: boolean;
  blockReview: boolean;
  layoutQc: MimicLayoutQcV1;
  reprintIterations: number;
};

type JobRow = {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  flow_type: string;
  status: string;
  generation_payload: Record<string, unknown>;
};

async function reloadJob(db: Pool, jobId: string): Promise<JobRow | null> {
  return qOne<JobRow>(
    db,
    `SELECT id, task_id, project_id, run_id, flow_type, status, generation_payload
     FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
}

function resolveOutputSlideCount(job: JobRow): number {
  const mimic = pickMimicPayload(job.generation_payload);
  if (!mimic) return 0;
  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const slides = slidesFromGeneratedOutput(
    stripNonRenderableDeckFields(
      normalizeLlmParsedForSchemaValidation(job.flow_type, { ...gen })
    )
  );
  const usable = slides.filter((s) => slideHasRenderableContent(s as Record<string, unknown>));
  return resolveMimicCarouselRenderSlideCount({
    mimic,
    plannedTarget: null,
    llmRenderableCount: usable.length,
  });
}

function resolveSlideDocAiLayers(
  job: JobRow,
  slideIndex1Based: number,
  slideCount: number
): MimicDocAiLayerPositionLayer[] {
  const mimic = pickMimicPayload(job.generation_payload);
  if (!mimic) return [];
  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const baseRender = stripNonRenderableDeckFields(
    normalizeLlmParsedForSchemaValidation(job.flow_type, { ...gen })
  );
  const slides = slidesFromGeneratedOutput(baseRender);
  const llmSlideRaw = slides[slideIndex1Based - 1] as Record<string, unknown> | undefined;
  if (!llmSlideRaw) return [];
  const mimicTemplateBg = mimic.mode === "template_bg";
  const llmSlide = mimicTemplateBg
    ? templateBgLlmSlideForDocAi(slideIndex1Based, slideCount, llmSlideRaw)
    : llmSlideRaw;
  const theme = inferMimicCarouselTheme(mimic.visual_guideline);
  const slideUsesFullBleed = slideMimicRenderMode(mimic, slideIndex1Based) === "full_bleed";
  const layerPosOverrides = pickMimicDocAiLayerPositionsForSlide(
    job.generation_payload.mimic_v1,
    slideIndex1Based
  );
  const useTextBacking = slideUsesFullBleed || mimicTemplateBg;
  const textBackingColor = formatMimicTextBackingBackground(
    typeof baseRender.mimic_text_backing_color === "string" ? baseRender.mimic_text_backing_color : undefined
  );
  let layers = buildMimicDocAiRenderTextLayers(mimic, slideIndex1Based, llmSlide, theme, {
    textBacking: useTextBacking,
    textBackingColor,
    avoidCenterSubject: !layerPosOverrides?.length,
    totalSlides: slideCount,
  });
  if (layerPosOverrides?.length) {
    layers = applyMimicDocAiLayerPositionOverrides(layers, layerPosOverrides, {
      applySavedTextOnBaseLayers: !mimicTemplateBg,
    });
  }
  if (!mimicDocAiLayersCoverLlmCopy(layers, llmSlide) && layers.every((l) => !String(l.text ?? "").trim())) {
    return [];
  }
  return layers;
}

async function persistLayoutQc(db: Pool, jobId: string, layoutQc: MimicLayoutQcV1): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = jsonb_set(
           COALESCE(generation_payload, '{}'::jsonb),
           '{layout_qc}',
           $1::jsonb,
           true
         ),
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(layoutQc), jobId]
  );
}

async function analyzeJobSlides(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  slideCount: number,
  minPassScore: number
) {
  const assets = await listAssetsByTask(db, job.project_id, job.task_id);
  const slideAssets = assets
    .filter((a) => (a.asset_type ?? "").toUpperCase() === "CAROUSEL_SLIDE")
    .sort((a, b) => a.position - b.position);

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const slides = slidesFromGeneratedOutput(
    stripNonRenderableDeckFields(
      normalizeLlmParsedForSchemaValidation(job.flow_type, { ...gen })
    )
  );

  const results = [];
  for (let i = 1; i <= slideCount; i++) {
    const layers = resolveSlideDocAiLayers(job, i, slideCount);
    if (layers.length === 0) {
      results.push({
        slide_index: i,
        score: 1,
        pass: true,
        badges: ["pass"],
        findings: [],
      });
      continue;
    }
    const asset = slideAssets.find((a) => a.position === i - 1);
    const pngBuffer = await loadSlidePngBuffer(config, asset?.public_url);
    const llmSlide = slides[i - 1] as Record<string, unknown> | undefined;
    const copy = llmSlide ? slideHeadlineBodyForRender(llmSlide) : {};
    results.push(
      await analyzeSlideCompositeLayout({
        slideIndex1Based: i,
        pngBuffer,
        layers,
        expectedCopy: copy,
        minPassScore,
        checkContrast: Boolean(pngBuffer),
      })
    );
  }
  return results;
}

async function applyPatchesAndReprint(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  slideCount: number,
  slideResults: Awaited<ReturnType<typeof analyzeJobSlides>>
): Promise<boolean> {
  let positions = pickMimicDocAiLayerPositionsFromMimicV1(job.generation_payload.mimic_v1) ?? {};
  const slidesToReprint: number[] = [];
  let anyPatch = false;

  for (const slideQa of slideResults) {
    if (slideQa.pass) continue;
    const layers = resolveSlideDocAiLayers(job, slideQa.slide_index, slideCount);
    const patches = collectLayoutPatchesForSlide(layers, slideQa);
    if (patches.length === 0) continue;
    const existing = pickMimicDocAiLayerPositionsForSlide(
      job.generation_payload.mimic_v1,
      slideQa.slide_index
    );
    const merged = applyLayoutQaPatchesToOverrides(layers, existing, patches);
    positions = mergeMimicDocAiLayerPositionOverrides(positions, slideQa.slide_index, merged);
    slidesToReprint.push(slideQa.slide_index);
    anyPatch = true;
  }

  if (!anyPatch) return false;

  await patchMimicDocAiLayerPositions(db, job.project_id, job.task_id, positions);
  logPipelineEvent("info", "qc", "applying post-render layout patches — text reprint", {
    task_id: job.task_id,
    data: { slides: slidesToReprint },
  });

  const { rerenderCarouselTextOverlay } = await import("./job-pipeline.js");
  await rerenderCarouselTextOverlay(db, config, job.id, slidesToReprint);
  return true;
}

/**
 * Post-composite layout QA with auto-reprint loop.
 * Hard failures (overlap, clipped boxes) block Review by default after reprint attempts.
 */
export async function runMimicPostRenderLayoutLoop(
  db: Pool,
  config: AppConfig,
  jobId: string
): Promise<MimicPostRenderLayoutLoopResult> {
  const job = await reloadJob(db, jobId);
  if (!job || !isTpGroundedCarouselRenderFlow(job.flow_type)) {
    const empty = summarizeLayoutQc([], { iterations: 0, blockReview: false });
    return { pass: true, blockReview: false, layoutQc: empty, reprintIterations: 0 };
  }

  const slideCount = resolveOutputSlideCount(job);
  if (slideCount < 1) {
    const empty = summarizeLayoutQc([], { iterations: 0, blockReview: false });
    return { pass: true, blockReview: false, layoutQc: empty, reprintIterations: 0 };
  }

  const maxIterations = Math.max(0, config.MIMIC_LAYOUT_QA_MAX_REPRINT_ITERATIONS ?? 3);
  const minPassScore = config.MIMIC_LAYOUT_QA_MIN_PASS_SCORE ?? 0.72;
  const blockOnAnyFail = config.MIMIC_LAYOUT_QA_BLOCK_REVIEW_ON_FAIL === true;
  const blockOnHardFail = config.MIMIC_LAYOUT_QA_BLOCK_ON_HARD_FAIL !== false;
  let reprintIterations = 0;
  let slideResults = await analyzeJobSlides(db, config, job, slideCount, minPassScore);

  for (let iter = 0; iter < maxIterations; iter++) {
    const needsFix = slideResults.some((s) => slideLayoutAutoFixWarranted(s.findings));
    if (!needsFix) break;
    const refreshed = await reloadJob(db, jobId);
    if (!refreshed) break;
    const didReprint = await applyPatchesAndReprint(db, config, refreshed, slideCount, slideResults);
    if (!didReprint) break;
    reprintIterations += 1;
    const after = await reloadJob(db, jobId);
    if (!after) break;
    slideResults = await analyzeJobSlides(db, config, after, slideCount, minPassScore);
  }

  const pass = slideResults.every((s) => slidePassesLayoutQa(s.findings, minPassScore));
  const hardFail = shouldHardBlockReviewFromSlides(slideResults);
  const blockReview = blockOnAnyFail ? !pass : blockOnHardFail && hardFail;
  const layoutQc = summarizeLayoutQc(slideResults, {
    iterations: reprintIterations,
    blockReview,
  });
  await persistLayoutQc(db, jobId, layoutQc);
  logLayoutQcSummary(job.task_id, layoutQc);

  return { pass, blockReview, layoutQc, reprintIterations };
}
