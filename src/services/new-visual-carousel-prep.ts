/**
 * Draft prep for New Visual Carousel (`FLOW_VISUAL_FIRST_CAROUSEL`) — idea + BVS driven, no TP replication.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { parseBvsFromPayload, resolveBvsForEnabledJob } from "../domain/bvs-v1.js";
import type { MimicJobPlanningGrounding } from "../domain/mimic-job-grounding.js";
import { groundingInsightIdsFromCandidate } from "../domain/mimic-job-grounding.js";
import {
  buildNewVisualSlidePlans,
  inferNewVisualTargetSlideCount,
  isNewVisualCarouselExecution,
  MIMIC_EXECUTION_MODE_NEW_VISUAL,
  staleNewVisualCarouselPayload,
} from "../domain/new-visual-carousel-execution.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { MIMIC_PAYLOAD_KEY, mergeMimicPayloadSlice } from "../domain/mimic-payload.js";
import { isVisualFirstCarouselFlow } from "../domain/visual-first-carousel-flow-types.js";
import { buildMimicRenderSettingsSnapshot, loadProjectMimicRenderSettings } from "./mimic-project-config.js";
import { logPipelineEvent } from "./pipeline-logger.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function candidateFromPayload(gp: Record<string, unknown>): Record<string, unknown> {
  return asRecord(gp.candidate_data) ?? asRecord(gp.planned) ?? {};
}

export function buildNewVisualCarouselPlanningGrounding(
  candidateData: Record<string, unknown>
): MimicJobPlanningGrounding {
  const insightIds = groundingInsightIdsFromCandidate(candidateData);
  const slideCount = inferNewVisualTargetSlideCount(candidateData);
  const title = String(candidateData.title ?? "").trim();
  const thesis = String(candidateData.thesis ?? candidateData.summary_excerpt ?? "").trim();
  const keyPoints = Array.isArray(candidateData.key_points)
    ? candidateData.key_points.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    grounding_insight_ids: insightIds,
    source_insights_id: insightIds[0] ?? "new_visual",
    visual_guideline_for_copy: {
      deck_concept: title || "Original brand carousel",
      thesis: thesis || null,
      key_points: keyPoints,
      target_slide_count: slideCount,
      lane: "new_visual_carousel",
    } as unknown as MimicJobPlanningGrounding["visual_guideline_for_copy"],
    slide_copy_layout: [],
  };
}

export function buildNewVisualCarouselRenderContext(
  slideCount: number,
  candidateData: Record<string, unknown>
): Record<string, unknown> {
  return {
    target_slide_count: slideCount,
    copy_before_visual_mimic: false,
    new_visual_carousel: true,
    deck_concept: String(candidateData.title ?? "").trim() || null,
    thesis: String(candidateData.thesis ?? candidateData.summary_excerpt ?? "").trim() || null,
  };
}

export function buildNewVisualCarouselMimicPayload(args: {
  candidateData: Record<string, unknown>;
  bvsEnabled: boolean;
  bvsSnapshot: Record<string, unknown> | null;
  slideCount?: number;
}): MimicPayloadV1 {
  const slideCount = args.slideCount ?? inferNewVisualTargetSlideCount(args.candidateData);
  const title = String(args.candidateData.title ?? "").trim();
  return {
    schema_version: 1,
    execution_mode: MIMIC_EXECUTION_MODE_NEW_VISUAL,
    mode: "carousel_visual",
    mode_override: null,
    classified_at: new Date().toISOString(),
    source_insights_id: "new_visual",
    source_evidence_row_id: null,
    analysis_tier: "new_visual",
    reference_tier_fallback: false,
    reference_items: [],
    archive_reference_items: [],
    visual_guideline: {
      deck_concept: title || "Original brand carousel",
      thesis: String(args.candidateData.thesis ?? args.candidateData.summary_excerpt ?? "").trim() || null,
      novelty_angle: String(args.candidateData.novelty_angle ?? "").trim() || null,
      lane: "new_visual_carousel",
    },
    twist_brief: {
      visual_only: true,
      legal_note:
        "Invent fresh brand-original carousel art per slide. Do not copy competitor posts, logos, faces, or copyrighted imagery.",
    },
    slide_plans: buildNewVisualSlidePlans(slideCount),
    bvs_enabled: args.bvsEnabled,
    ...(args.bvsSnapshot ? { bvs_bible_snapshot: args.bvsSnapshot } : {}),
  };
}

/**
 * Persist new-visual mimic payload before copy generation (replaces TP reference resolution).
 */
export async function ensureNewVisualCarouselBeforeCopyGeneration(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; flow_type: string; generation_payload: Record<string, unknown> },
  runId: string | null
): Promise<MimicPayloadV1> {
  if (!isVisualFirstCarouselFlow(job.flow_type)) {
    throw new Error(`ensureNewVisualCarouselBeforeCopyGeneration called for non visual-first flow: ${job.flow_type}`);
  }

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp = row.rows[0]?.generation_payload ?? job.generation_payload;
  const existing = asRecord(gp[MIMIC_PAYLOAD_KEY]) as MimicPayloadV1 | null;

  if (existing && !staleNewVisualCarouselPayload(existing) && isNewVisualCarouselExecution(job.flow_type, existing)) {
    return existing;
  }

  const candidateData = candidateFromPayload(gp);
  const slideCount = inferNewVisualTargetSlideCount(candidateData);
  const bvs = await resolveBvsForEnabledJob(db, job.project_id, gp);
  const mimic = buildNewVisualCarouselMimicPayload({
    candidateData,
    bvsEnabled: bvs?.enabled === true,
    bvsSnapshot: bvs?.bible_snapshot ? (bvs.bible_snapshot as unknown as Record<string, unknown>) : null,
    slideCount,
  });

  const mimicRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const renderSettings = buildMimicRenderSettingsSnapshot(config, {
    ...mimicRender,
    imageInputMode: "analysis_t2i",
  });

  const grounding = buildNewVisualCarouselPlanningGrounding(candidateData);
  const merged: Record<string, unknown> = {
    ...gp,
    ...mergeMimicPayloadSlice(gp, mimic),
    ...(bvs ? { bvs_v1: bvs } : {}),
    mimic_job_grounding: grounding,
    mimic_render_context: buildNewVisualCarouselRenderContext(slideCount, candidateData),
    mimic_render_settings: renderSettings,
  };
  delete merged.template_backgrounds_prepared_at;
  delete merged.template_backgrounds_slide_count;
  delete merged.template_storage_decision;

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(merged), job.id]
  );

  logPipelineEvent("info", "generate", "new_visual_carousel_payload_prepared", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    data: {
      slide_count: slideCount,
      bvs_enabled: mimic.bvs_enabled === true,
      execution_mode: MIMIC_EXECUTION_MODE_NEW_VISUAL,
    },
  });

  return mimic;
}

export function stripNewVisualCarouselRerunPayload(gp: Record<string, unknown>): void {
  for (const key of [
    "mimic_v1",
    "mimic_render_context",
    "mimic_render_settings",
    "template_backgrounds_prepared_at",
    "template_backgrounds_slide_count",
    "template_storage_decision",
    "draft_package_snapshot",
    "draft_package_type",
    "flux_image_prompts",
  ]) {
    delete gp[key];
  }
  const mimic = asRecord(gp.mimic_v1);
  if (mimic && Array.isArray(mimic.flux_image_prompts)) {
    delete mimic.flux_image_prompts;
  }
}
