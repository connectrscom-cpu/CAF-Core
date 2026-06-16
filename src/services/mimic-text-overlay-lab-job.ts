import type { AppConfig } from "../config.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { isTpGroundedCarouselRenderFlow } from "../domain/top-performer-mimic-flow-types.js";
import { listAssetsByTask } from "../repositories/assets.js";
import { resolveProjectInstagramHandle } from "../domain/instagram-handle.js";
import { getContentJobByTaskId } from "../repositories/jobs.js";
import { getProjectById } from "../repositories/core.js";
import { getStrategyDefaults } from "../repositories/project-config.js";
import { pickSlideByCarouselIndex, slidesFromGeneratedOutput, mergeSlideCopyAtCarouselIndex } from "./carousel-render-pack.js";
import { replaceSlidesInGeneratedOutput } from "./editorial-copy-apply.js";
import {
  mimicDeckUsesSlotDeduplication,
  pickStoredMimicPlateUrl,
  publicUrlFromAssetRow,
  templateBgSlotForIndex,
} from "./mimic-carousel-render.js";
import type { MimicTextOverlayLabFixture } from "./mimic-text-overlay-lab.js";
import type { Pool } from "pg";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function assetPositionForSlot(slot: "cover" | "body" | "cta", totalSlides: number): number {
  if (slot === "cover") return 0;
  if (slot === "cta") return totalSlides - 1;
  return 1;
}

export type MimicOverlayLabJobRow = {
  task_id: string;
  status: string;
  flow_type: string;
  mimic_mode: string | null;
  slide_count: number;
  background_plate_count: number;
  has_rendered_slides: boolean;
};

export async function listMimicCarouselJobsForRun(
  db: Pool,
  projectId: string,
  runId: string
): Promise<MimicOverlayLabJobRow[]> {
  const r = await db.query<{
    task_id: string;
    status: string;
    flow_type: string;
    generation_payload: Record<string, unknown> | null;
  }>(
    `SELECT task_id, status, flow_type, generation_payload
     FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2
     ORDER BY task_id ASC`,
    [projectId, runId]
  );

  const out: MimicOverlayLabJobRow[] = [];
  for (const row of r.rows) {
    if (!isTpGroundedCarouselRenderFlow(row.flow_type)) continue;
    const mimic = pickMimicPayload(row.generation_payload ?? {});
    if (!mimic) continue;

    const gen = pickGeneratedOutputOrEmpty(row.generation_payload ?? {});
    const slides = slidesFromGeneratedOutput(gen);
    const assets = await listAssetsByTask(db, projectId, row.task_id);
    const bgCount = assets.filter((a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND").length;
    const plateCount = assets.filter((a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_VISUAL_PLATE").length;
    const slideAssets = assets.filter((a) => (a.asset_type ?? "").toUpperCase() === "CAROUSEL_SLIDE").length;

    out.push({
      task_id: row.task_id,
      status: row.status,
      flow_type: row.flow_type,
      mimic_mode: mimic.mode ?? null,
      slide_count: Math.max(slides.length, mimic.reference_items?.length ?? 0, 1),
      background_plate_count: bgCount + plateCount,
      has_rendered_slides: slideAssets > 0,
    });
  }
  return out;
}

export type MimicOverlayLabJobSlideRow = {
  slide_index: number;
  has_background_plate: boolean;
  background_url: string | null;
  rendered_slide_url: string | null;
  object_path: string | null;
  headline_preview: string;
  body_preview: string;
};

export async function listJobSlidesForOverlayLab(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<{ task_id: string; slides: MimicOverlayLabJobSlideRow[] }> {
  const job = await getContentJobByTaskId(db, projectId, taskId);
  if (!job) throw new Error("job_not_found");
  const mimic = pickMimicPayload(job.generation_payload ?? {});
  if (!mimic) throw new Error("job_has_no_mimic_payload");

  const genPayload = (job.generation_payload ?? {}) as Record<string, unknown>;
  const gen = pickGeneratedOutputOrEmpty(genPayload);
  const llmSlides = slidesFromGeneratedOutput(gen);
  const n = Math.max(llmSlides.length, mimic.reference_items?.length ?? 0, 1);
  const assets = await listAssetsByTask(db, projectId, taskId);
  const usesSlots = mimicDeckUsesSlotDeduplication(mimic);

  const slides: MimicOverlayLabJobSlideRow[] = [];
  for (let i = 1; i <= n; i++) {
    const lookupPosition = usesSlots
      ? assetPositionForSlot(templateBgSlotForIndex(i, n), n)
      : i - 1;
    const bgUrl = pickStoredMimicPlateUrl(config, assets, lookupPosition, i);
    const bgAsset =
      assets.find(
        (a) =>
          (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND" && a.position === lookupPosition
      ) ??
      assets.find(
        (a) =>
          (a.asset_type ?? "").toUpperCase() === "MIMIC_VISUAL_PLATE" && a.position === i - 1
      ) ??
      null;
    const renderedAsset =
      assets.find(
        (a) => (a.asset_type ?? "").toUpperCase() === "CAROUSEL_SLIDE" && a.position === i - 1
      ) ?? null;

    const llmSlide = pickSlideByCarouselIndex(llmSlides, i);
    const headline = String(llmSlide.headline ?? llmSlide.title ?? "").trim();
    const body = String(llmSlide.body ?? llmSlide.subtitle ?? "").trim();

    slides.push({
      slide_index: i,
      has_background_plate: Boolean(bgUrl),
      background_url: bgUrl,
      rendered_slide_url: renderedAsset ? publicUrlFromAssetRow(config, renderedAsset) : null,
      object_path: bgAsset?.object_path ?? null,
      headline_preview: headline.slice(0, 60),
      body_preview: body.slice(0, 80),
    });
  }

  return { task_id: taskId, slides };
}

/** Production job fixture: real LLM copy + mimic payload + stored background plate URL. */
export async function loadMimicTextOverlayFixtureFromJob(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string,
  slideIndex: number
): Promise<MimicTextOverlayLabFixture> {
  const job = await getContentJobByTaskId(db, projectId, taskId);
  if (!job) throw new Error(`Job not found: ${taskId}`);
  const mimicFull = pickMimicPayload(job.generation_payload ?? {});
  if (!mimicFull) throw new Error(`Job ${taskId} has no mimic_v1 payload`);

  const genPayload = (job.generation_payload ?? {}) as Record<string, unknown>;
  const gen = pickGeneratedOutputOrEmpty(genPayload);
  const llmSlides = slidesFromGeneratedOutput(gen);
  const llmSlide = pickSlideByCarouselIndex(llmSlides, slideIndex);

  const mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans"> = {
    visual_guideline: mimicFull.visual_guideline ?? {},
    reference_items: mimicFull.reference_items ?? [],
    slide_plans: mimicFull.slide_plans ?? [],
  };

  const n = Math.max(llmSlides.length, mimic.reference_items?.length ?? 0, slideIndex);
  const slideRows = await listJobSlidesForOverlayLab(db, config, projectId, taskId);
  const slideRow = slideRows.slides.find((s) => s.slide_index === slideIndex);

  const strategyRow = await getStrategyDefaults(db, projectId);
  const projectRow = await getProjectById(db, projectId);
  const projectHandle = resolveProjectInstagramHandle({
    generationPayload: genPayload,
    strategyInstagramHandle: strategyRow?.instagram_handle ?? null,
    projectSlug: projectRow?.slug ?? null,
  });

  return {
    description: `Job ${taskId} · slide ${slideIndex} · ${job.run_id}`,
    slide_index: slideIndex,
    background_image_url: slideRow?.background_url ?? null,
    rendered_slide_url: slideRow?.rendered_slide_url ?? null,
    llm_slide: { ...llmSlide },
    mimic,
    task_id: taskId,
    run_id: String(job.run_id ?? ""),
    project_handle: projectHandle,
  };
}

/** Persist lab-edited llm_slide copy onto the job's generated_output (single slide). */
export async function persistLabSlideCopyToJob(
  db: Pool,
  projectId: string,
  taskId: string,
  slideIndex: number,
  llmSlide: Record<string, unknown>
): Promise<{ slide_index: number; llm_slide: Record<string, unknown> }> {
  const job = await getContentJobByTaskId(db, projectId, taskId);
  if (!job) throw new Error("job_not_found");
  const jobId = String(job.id ?? "");
  if (!jobId) throw new Error("job_missing_id");

  const gp = JSON.parse(JSON.stringify(job.generation_payload ?? {})) as Record<string, unknown>;
  const gen = pickGeneratedOutputOrEmpty(gp);
  const slides = slidesFromGeneratedOutput(gen);
  const mergedSlides = mergeSlideCopyAtCarouselIndex(slides, slideIndex, llmSlide);
  const mergedSlide = pickSlideByCarouselIndex(mergedSlides, slideIndex);
  gp.generated_output = replaceSlidesInGeneratedOutput(gen, mergedSlides);
  gp.mimic_overlay_lab_last_saved_at = new Date().toISOString();
  gp.mimic_overlay_lab_last_saved_slide = slideIndex;

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(gp), jobId]
  );

  return { slide_index: slideIndex, llm_slide: { ...mergedSlide } };
}
