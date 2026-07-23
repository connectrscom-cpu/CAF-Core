/**
 * Post-copy prep for BVS-backed `FLOW_CAROUSEL` jobs — brand bible backgrounds + overlay layout.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  BVS_TEXT_CAROUSEL_EXECUTION_MODE,
  BVS_TEXT_CAROUSEL_SOURCE_ID,
  isBvsTextCarouselOverlayRender,
  isStandardCarouselFlow,
} from "../domain/bvs-text-carousel-flow.js";
import {
  listBrandBibleBackgroundPlates,
  pickBrandBibleBackgroundForSlide,
  type BrandBibleSnapshotV1,
} from "../domain/brand-bible.js";
import {
  enrichMimicWithBvsRenderPlan,
  bvsTextCarouselUsesBibleAssetPlates,
  type BvsRenderPlanV1,
} from "../domain/bvs-render-plan.js";
import { pickGeneratedOutput } from "../domain/generation-payload-output.js";
import { composeMimicCarouselDraftPackage } from "../domain/mimic-carousel-package.js";
import type { MimicPayloadV1, MimicSlidePlan } from "../domain/mimic-payload.js";
import { mergeMimicPayloadSlice, pickMimicPayload } from "../domain/mimic-payload.js";
import { attachProductEvidenceUrlsToMimicPayload } from "../domain/product-bible-v1.js";
import {
  templateBgAssetPositionForSlot,
  templateBgSlotForIndex,
} from "../domain/mimic-template-library.js";
import { isBvsEnabledForCandidate, parseBvsFromPayload, resolveBvsForEnabledJob } from "../domain/bvs-v1.js";
import { insertAsset } from "../repositories/assets.js";
import {
  slideIndicesForTemplateBgPrep,
  templateBackgroundPlatesReady,
} from "./mimic-carousel-render.js";
import { buildMimicRenderSettingsSnapshot, loadProjectMimicRenderSettings } from "./mimic-project-config.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import {
  slidesFromGeneratedOutput,
  slideHasRenderableContent,
} from "./carousel-render-pack.js";

async function persistGenerationPayload(
  db: Pool,
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(payload), jobId]
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function buildBvsTextCarouselSlidePlans(slideCount: number): MimicSlidePlan[] {
  const n = Math.max(1, Math.floor(slideCount));
  return Array.from({ length: n }, (_, i) => ({
    slide_index: i + 1,
    render_mode: "hbs" as const,
    reference_index: i + 1,
  }));
}

export function buildBvsTextCarouselMimicPayload(args: {
  slideCount: number;
  bvsSnapshot: BrandBibleSnapshotV1;
  bvsRenderPlan: BvsRenderPlanV1 | null;
}): MimicPayloadV1 {
  const slideCount = Math.max(1, Math.floor(args.slideCount));
  return {
    schema_version: 1,
    execution_mode: BVS_TEXT_CAROUSEL_EXECUTION_MODE,
    mode: "template_bg",
    mode_override: null,
    classified_at: new Date().toISOString(),
    source_insights_id: BVS_TEXT_CAROUSEL_SOURCE_ID,
    source_evidence_row_id: null,
    analysis_tier: "bvs_text_carousel",
    reference_tier_fallback: false,
    reference_items: [],
    archive_reference_items: [],
    visual_guideline: {
      format_pattern: "listicle",
      deck_visual_system: {
        repeated_template: "brand bible background plates with movable text overlay",
      },
      lane: "bvs_text_carousel",
    },
    twist_brief: {
      visual_only: true,
      legal_note:
        "Use brand bible background plates with HTML/DocAI text overlay only — do not bake copy into image models.",
    },
    slide_plans: buildBvsTextCarouselSlidePlans(slideCount),
    bvs_enabled: true,
    bvs_bible_snapshot: args.bvsSnapshot as unknown as Record<string, unknown>,
    ...(args.bvsRenderPlan ? { bvs_render_plan: args.bvsRenderPlan } : {}),
  };
}

function withBvsTextCarouselBackgroundMode(
  mimic: MimicPayloadV1,
  snapshot: BrandBibleSnapshotV1
): MimicPayloadV1 {
  const backgrounds = listBrandBibleBackgroundPlates(snapshot);
  const plan = mimic.bvs_render_plan;
  if (!plan || typeof plan !== "object") return mimic;
  return {
    ...mimic,
    bvs_render_plan: {
      ...plan,
      background_mode: backgrounds.length > 0 ? "bible_asset" : "invent",
    },
  };
}

/** Register MIMIC_BACKGROUND assets pointing at brand bible plates (no Flux). */
export async function ensureBvsTextCarouselBibleBackgroundPlates(
  db: Pool,
  job: { id: string; task_id: string; project_id: string },
  mimic: MimicPayloadV1,
  totalSlides: number
): Promise<boolean> {
  if (!bvsTextCarouselUsesBibleAssetPlates(mimic)) return false;

  const snapshot = asRecord(mimic.bvs_bible_snapshot) as BrandBibleSnapshotV1 | null;
  if (!snapshot || listBrandBibleBackgroundPlates(snapshot).length === 0) return false;

  if (await templateBackgroundPlatesReady(db, job.project_id, job.task_id, totalSlides)) {
    return true;
  }

  const indices = slideIndicesForTemplateBgPrep(totalSlides);
  let coverUrl: string | null = null;

  for (const slideIndex of indices) {
    const slot = templateBgSlotForIndex(slideIndex, totalSlides);
    const position = templateBgAssetPositionForSlot(slot, totalSlides);
    const bg = pickBrandBibleBackgroundForSlide(snapshot, job.task_id, slideIndex);
    const publicUrl = bg?.public_url?.trim();
    if (!bg || !publicUrl) continue;

    if (slideIndex === 1) coverUrl = publicUrl;

    await insertAsset(db, {
      asset_id: `${job.task_id}__MIMIC_BACKGROUND_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      task_id: job.task_id,
      project_id: job.project_id,
      asset_type: "MIMIC_BACKGROUND",
      position,
      public_url: publicUrl,
      provider: "brand_bible",
      metadata_json: {
        role: "bvs_bible_background",
        slide_index: slideIndex,
        template_slot: slot,
        bible_asset_id: bg.asset_id,
        bible_asset_label: bg.label,
      },
    });
  }

  if (coverUrl) {
    await db.query(
      `UPDATE caf_core.content_jobs
       SET generation_payload = jsonb_set(
             COALESCE(generation_payload, '{}'::jsonb),
             '{mimic_v1,background_image_url}',
             to_jsonb($1::text),
             true
           ),
           updated_at = now()
       WHERE id = $2`,
      [coverUrl, job.id]
    );
  }

  return true;
}

/**
 * After standard carousel LLM copy: attach `mimic_v1`, bible background plates, and mimic package snapshot.
 */
export async function prepareFlowCarouselBvsDraftPackage(
  db: Pool,
  config: AppConfig,
  job: {
    id: string;
    task_id: string;
    project_id: string;
    flow_type: string;
    generation_payload: Record<string, unknown>;
  },
  runId: string | null
): Promise<MimicPayloadV1 | null> {
  if (!isStandardCarouselFlow(job.flow_type)) return null;

  const candidateData = asRecord(job.generation_payload.candidate_data) ?? {};
  if (!isBvsEnabledForCandidate(candidateData) && parseBvsFromPayload(job.generation_payload)?.enabled !== true) {
    return null;
  }

  if (!pickGeneratedOutput(job.generation_payload)) return null;

  const bvs = await resolveBvsForEnabledJob(db, job.project_id, job.generation_payload);
  if (!bvs?.enabled || !bvs.bible_snapshot) return null;

  const gen = pickGeneratedOutput(job.generation_payload) ?? {};
  const slides = slidesFromGeneratedOutput(gen).filter((s) =>
    slideHasRenderableContent(s as Record<string, unknown>)
  );
  const slideCount = Math.max(1, slides.length);

  let mimic = buildBvsTextCarouselMimicPayload({
    slideCount,
    bvsSnapshot: bvs.bible_snapshot,
    bvsRenderPlan: null,
  });
  mimic = enrichMimicWithBvsRenderPlan(mimic, bvs.bible_snapshot);
  mimic = withBvsTextCarouselBackgroundMode(mimic, bvs.bible_snapshot);
  mimic = attachProductEvidenceUrlsToMimicPayload(job.generation_payload, mimic, { candidateData });

  const mimicRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const composed = composeMimicCarouselDraftPackage(
    { ...job.generation_payload, mimic_v1: mimic },
    mimic
  );

  let merged: Record<string, unknown> = {
    ...job.generation_payload,
    bvs_v1: bvs,
    ...mergeMimicPayloadSlice(job.generation_payload, mimic),
    draft_package_snapshot: composed,
    draft_package_type: "mimic_carousel_package",
    mimic_render_context: {
      target_slide_count: slideCount,
      copy_before_visual_mimic: false,
      bvs_text_carousel: true,
    },
    mimic_render_settings: buildMimicRenderSettingsSnapshot(config, mimicRender),
    generated_output: {
      ...(asRecord(job.generation_payload.generated_output) ?? {}),
      package_type: "mimic_carousel_package",
    },
  };

  await persistGenerationPayload(db, job.id, merged);

  mimic = pickMimicPayload(merged) ?? mimic;
  const platesReady = await ensureBvsTextCarouselBibleBackgroundPlates(
    db,
    { id: job.id, task_id: job.task_id, project_id: job.project_id },
    mimic,
    slideCount
  );
  if (platesReady) {
    merged = {
      ...merged,
      template_backgrounds_prepared_at: new Date().toISOString(),
      template_backgrounds_slide_count: slideCount,
    };
    await persistGenerationPayload(db, job.id, merged);
  }

  logPipelineEvent("info", "generate", "bvs text carousel mimic package prepared", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    data: {
      slide_count: slideCount,
      background_mode: mimic.bvs_render_plan?.background_mode ?? "invent",
      bible_plates_ready: platesReady,
    },
  });

  return mimic;
}

export function shouldPrepareBvsTextCarouselPackage(
  flowType: string,
  payload: Record<string, unknown>
): boolean {
  if (!isStandardCarouselFlow(flowType)) return false;
  if (isBvsTextCarouselOverlayRender(flowType, payload)) return false;
  const candidateData = asRecord(payload.candidate_data) ?? {};
  return isBvsEnabledForCandidate(candidateData) || parseBvsFromPayload(payload)?.enabled === true;
}
