import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  composeMimicCarouselDraftPackage,
  slimVisualGuidelineFromEntry,
} from "../domain/mimic-carousel-package.js";
import { assertMimicCopyDiffersFromReference } from "../domain/mimic-copy-guard.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { mergeMimicPayloadSlice, pickMimicPayload } from "../domain/mimic-payload.js";
import { assertMimicReferenceEligibleForFlow } from "../domain/mimic-reference-eligibility.js";
import { buildMimicRenderContextForLlm } from "../domain/mimic-render-context.js";
import {
  expectedMimicCarouselOutputSlideCount,
  filterPromotionalSlidesFromMimicPayload,
  reconcileMimicPayloadToOutputSlideCount,
} from "./mimic-carousel-render.js";
import { slideHasRenderableContent, slidesFromGeneratedOutput } from "./carousel-render-pack.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { resolveTemplateStorageDecision } from "../domain/mimic-template-library.js";
import { pickGeneratedOutput } from "../domain/generation-payload-output.js";
import {
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
  isTopPerformerMimicRenderableFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import { getJobLineageByTaskId } from "../repositories/job-lineage.js";
import type { MimicMode } from "../domain/mimic-payload.js";
import { classifyMimicMode } from "./mimic-mode-classifier.js";
import {
  normalizeMimicReferenceItems,
  resolveMimicReferenceFromLineage,
  type ResolvedMimicReference,
} from "./mimic-reference-resolver.js";
import { getMimicModeOverridesFromPack } from "../repositories/signal-packs.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { compactStoredInspectionMedia } from "./visual-guidelines-media.js";
import { loadMimicPromptOverrides } from "./mimic-prompt-overrides-loader.js";
import {
  mimicDeckUsesSlotDeduplication,
  requireMimicSlideBackgroundPlate,
  slideIndicesForTemplateBgPrep,
  templateBackgroundPlatesReady,
} from "./mimic-carousel-render.js";
import { targetSlideCountFromReference } from "../domain/mimic-text-heavy.js";
import { carouselVideoSlideIndicesFromPayload } from "./instagram-media-normalizer.js";
import type { JobLineageResult } from "../repositories/job-lineage.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function inspectionFolderFromEntry(entry: Record<string, unknown>): {
  storage_folder_prefix: string | null;
  storage_folder_label: string | null;
} {
  const media =
    compactStoredInspectionMedia(entry.inspection_media) ??
    compactStoredInspectionMedia(entry.stored_inspection_media_json);
  return {
    storage_folder_prefix: media?.folder_prefix ?? null,
    storage_folder_label: media?.storage_folder_label ?? null,
  };
}

function evidencePayloadForResolved(
  lineage: JobLineageResult,
  resolved: ResolvedMimicReference
): Record<string, unknown> | null {
  const insightId = resolved.source_insights_id;
  const rowId = resolved.source_evidence_row_id;
  for (const g of lineage.grounding) {
    const ir = g.insight_row;
    if (insightId && String(ir.insights_id) === insightId) {
      const p = g.evidence_row?.payload_json;
      if (p && typeof p === "object" && !Array.isArray(p)) return p;
    }
  }
  if (rowId) {
    for (const g of lineage.grounding) {
      const er = g.evidence_row;
      if (er && String(er.id) === String(rowId)) {
        const p = er.payload_json;
        if (p && typeof p === "object" && !Array.isArray(p)) return p;
      }
    }
  }
  return null;
}

function buildMimicPayloadFromResolved(
  flowType: string,
  resolved: ResolvedMimicReference,
  modeOverride?: MimicMode | null,
  evidencePayload?: Record<string, unknown> | null
): { mimic: MimicPayloadV1; visualGuideline: ReturnType<typeof slimVisualGuidelineFromEntry> } {
  const { mode, slide_plans } = classifyMimicMode(flowType, resolved.guideline_entry, modeOverride);
  let visualGuideline = slimVisualGuidelineFromEntry(resolved.guideline_entry);
  const fromPayload = evidencePayload ? carouselVideoSlideIndicesFromPayload(evidencePayload) : [];
  if (fromPayload.length > 0 && !(visualGuideline.video_slide_indices?.length)) {
    visualGuideline = { ...visualGuideline, video_slide_indices: fromPayload };
  }
  const folder = inspectionFolderFromEntry(resolved.guideline_entry);

  const mimic: MimicPayloadV1 = {
    schema_version: 1,
    mode,
    mode_override: modeOverride ?? null,
    classified_at: new Date().toISOString(),
    source_insights_id: resolved.source_insights_id,
    source_evidence_row_id: resolved.source_evidence_row_id,
    analysis_tier: resolved.analysis_tier,
    reference_tier_fallback: resolved.reference_tier_fallback ?? false,
    reference_items: normalizeMimicReferenceItems(resolved.reference_items),
    storage_folder_prefix: folder.storage_folder_prefix,
    storage_folder_label: folder.storage_folder_label,
    visual_guideline: visualGuideline as unknown as Record<string, unknown>,
    twist_brief: {
      visual_only: true,
      legal_note:
        "Recreate the visual pattern only; do not copy logos, faces, or copyrighted imagery verbatim.",
    },
    slide_plans,
  };

  return { mimic, visualGuideline };
}

async function resolveMimicPayloadForJob(
  db: Pool,
  job: { task_id: string; project_id: string; flow_type: string; generation_payload: Record<string, unknown> },
  runId: string | null
): Promise<{ mimic: MimicPayloadV1; resolved: ResolvedMimicReference; visualGuideline: ReturnType<typeof slimVisualGuidelineFromEntry> }> {
  const candidateData = asRecord(job.generation_payload.candidate_data);
  const lineage = await getJobLineageByTaskId(db, job.project_id, job.task_id);
  if (!lineage) {
    const msg = "Job lineage not found — signal pack link missing on generation_payload";
    logPipelineEvent("error", "generate", msg, {
      run_id: runId ?? undefined,
      task_id: job.task_id,
      flow_type: job.flow_type,
    });
    throw new Error(msg);
  }

  let resolved: ResolvedMimicReference;
  try {
    resolved = resolveMimicReferenceFromLineage(job.flow_type, lineage, candidateData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPipelineEvent("error", "generate", `mimic reference resolve failed: ${msg}`, {
      run_id: runId ?? undefined,
      task_id: job.task_id,
      flow_type: job.flow_type,
    });
    throw err;
  }

  assertMimicReferenceEligibleForFlow(job.flow_type, resolved.reference_items);

  // Read any manual mode override set by a reviewer on the signal pack.
  const overrides = getMimicModeOverridesFromPack(lineage.signal_pack);
  const packOverride = overrides[resolved.source_insights_id] as MimicMode | null | undefined;
  const evidencePayload = evidencePayloadForResolved(lineage, resolved);
  const built = buildMimicPayloadFromResolved(
    job.flow_type,
    resolved,
    packOverride ?? null,
    evidencePayload
  );

  if (resolved.reference_tier_fallback) {
    logPipelineEvent("warn", "generate", "mimic reference tier fallback", {
      run_id: runId ?? undefined,
      task_id: job.task_id,
      flow_type: job.flow_type,
      data: {
        resolved_tier: resolved.analysis_tier,
        reference_count: built.mimic.reference_items.length,
      },
    });
  }

  return { ...built, resolved };
}

async function persistGenerationPayload(
  db: Pool,
  jobId: string,
  merged: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(merged), jobId]
  );
}

/**
 * Resolve reference + classify render mode **before** LLM copy generation.
 * Persists `mimic_v1` and `mimic_render_context` so the copy prompt knows slide count / template path.
 */
export async function ensureMimicReferenceBeforeCopyGeneration(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; flow_type: string; generation_payload: Record<string, unknown> },
  runId: string | null
): Promise<MimicPayloadV1> {
  if (!config.MIMIC_IMAGE_ENABLED) {
    throw new Error("MIMIC_IMAGE_ENABLED is off — enable env flag to run top-performer mimic flows.");
  }
  if (!isTopPerformerMimicRenderableFlow(job.flow_type)) {
    throw new Error(`ensureMimicReferenceBeforeCopyGeneration called for non-mimic flow: ${job.flow_type}`);
  }

  const existing = pickMimicPayload(job.generation_payload);
  if (existing?.reference_items?.length) {
    const normalized = {
      ...existing,
      reference_items: normalizeMimicReferenceItems(existing.reference_items),
    };
    const { mimic: filtered, removed_slide_indices } =
      filterPromotionalSlidesFromMimicPayload(normalized);
    const vg = asRecord(filtered.visual_guideline) ?? {};
    const renderContext = {
      ...buildMimicRenderContextForLlm(filtered, vg),
      ...(removed_slide_indices.length > 0
        ? { skipped_promotional_slide_indices: removed_slide_indices }
        : {}),
    };
    const row = await db.query<{ generation_payload: Record<string, unknown> }>(
      `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    const gp = row.rows[0]?.generation_payload ?? job.generation_payload;
    await persistGenerationPayload(db, job.id, {
      ...mergeMimicPayloadSlice(gp, filtered),
      mimic_render_context: renderContext,
    });
    return filtered;
  }

  const { mimic: resolvedMimic, resolved } = await resolveMimicPayloadForJob(db, job, runId);
  const { mimic, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(resolvedMimic);
  const renderContext = {
    ...buildMimicRenderContextForLlm(mimic, resolved.guideline_entry),
    ...(removed_slide_indices.length > 0
      ? { skipped_promotional_slide_indices: removed_slide_indices }
      : {}),
  };
  const templateStorage = resolveTemplateStorageDecision(resolved.guideline_entry, mimic.mode);

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp = row.rows[0]?.generation_payload ?? {};
  const merged = {
    ...mergeMimicPayloadSlice(gp, mimic),
    mimic_render_context: renderContext,
    template_storage_decision: templateStorage,
  };

  await persistGenerationPayload(db, job.id, merged);

  logPipelineEvent("info", "generate", "mimic reference resolved before copy", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    flow_type: job.flow_type,
    data: {
      mode: mimic.mode,
      copy_before_visual_mimic: renderContext.copy_before_visual_mimic,
      target_slide_count: renderContext.target_slide_count,
      reference_count: mimic.reference_items.length,
      template_storage_quality: templateStorage.quality,
      template_library_eligible: templateStorage.eligible_for_library,
    },
  });

  return mimic;
}

/**
 * For `template_bg` carousels: extract cover/body/CTA background plates **before** OpenAI copy.
 * Plates are reused at render for Qwen text compositing.
 */
export async function ensureMimicTemplateBackgroundsBeforeCopy(
  db: Pool,
  config: AppConfig,
  job: {
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    generation_payload: Record<string, unknown>;
  },
  runId: string | null
): Promise<{ prepared: boolean; skipped?: boolean }> {
  if (!config.MIMIC_IMAGE_ENABLED || !isTopPerformerMimicCarouselFlow(job.flow_type)) {
    return { prepared: false };
  }

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp = row.rows[0]?.generation_payload ?? job.generation_payload;
  const mimic = pickMimicPayload(gp);
  if (!mimic || mimic.mode !== "template_bg") {
    return { prepared: false };
  }

  const ctx = asRecord(gp.mimic_render_context);
  const totalSlides =
    typeof ctx?.target_slide_count === "number" && ctx.target_slide_count > 0
      ? ctx.target_slide_count
      : targetSlideCountFromReference(mimic.reference_items.length, mimic.visual_guideline ?? {}) ??
        mimic.reference_items.length;

  if (await templateBackgroundPlatesReady(db, job.project_id, job.task_id, totalSlides)) {
    return { prepared: true, skipped: true };
  }

  const promptOverrides = await loadMimicPromptOverrides(db);
  const indices = mimicDeckUsesSlotDeduplication(mimic)
    ? slideIndicesForTemplateBgPrep(totalSlides)
    : [1];

  for (const slideIndex of indices) {
    await requireMimicSlideBackgroundPlate(db, config, job, mimic, slideIndex, {
      promptOverrides,
      totalSlides,
    });
  }

  const merged = {
    ...gp,
    template_backgrounds_prepared_at: new Date().toISOString(),
    template_backgrounds_slide_count: totalSlides,
  };
  await persistGenerationPayload(db, job.id, merged);

  logPipelineEvent("info", "generate", "mimic template backgrounds prepared before copy", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    data: { totalSlides, extracted_slide_indices: indices },
  });

  return { prepared: true };
}

/**
 * After LLM copy: compose `mimic_carousel_package`, validate copy divergence, finalize draft snapshot.
 */
export async function prepareMimicDraftPackage(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; flow_type: string; generation_payload: Record<string, unknown> },
  runId: string | null
): Promise<MimicPayloadV1> {
  if (!config.MIMIC_IMAGE_ENABLED) {
    throw new Error("MIMIC_IMAGE_ENABLED is off — enable env flag to run top-performer mimic flows.");
  }
  if (!isTopPerformerMimicRenderableFlow(job.flow_type)) {
    throw new Error(`prepareMimicDraftPackage called for non-mimic flow: ${job.flow_type}`);
  }

  let mimic = pickMimicPayload(job.generation_payload);
  let resolvedGuideline: Record<string, unknown> | null = null;

  if (!mimic?.reference_items?.length) {
    const resolved = await resolveMimicPayloadForJob(db, job, runId);
    const filtered = filterPromotionalSlidesFromMimicPayload(resolved.mimic);
    mimic = filtered.mimic;
    resolvedGuideline = resolved.resolved.guideline_entry;
    const renderContext = {
      ...buildMimicRenderContextForLlm(mimic, resolved.resolved.guideline_entry),
      ...(filtered.removed_slide_indices.length > 0
        ? { skipped_promotional_slide_indices: filtered.removed_slide_indices }
        : {}),
    };
    const row = await db.query<{ generation_payload: Record<string, unknown> }>(
      `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    const gp = row.rows[0]?.generation_payload ?? {};
    await persistGenerationPayload(db, job.id, {
      ...mergeMimicPayloadSlice(gp, mimic),
      mimic_render_context: renderContext,
    });
  }

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  let merged = row.rows[0]?.generation_payload ?? {};
  mimic = pickMimicPayload(merged) ?? mimic;

  if (!resolvedGuideline && mimic?.source_insights_id) {
    const lineage = await getJobLineageByTaskId(db, job.project_id, job.task_id);
    const candidateData = asRecord(merged.candidate_data);
    if (lineage) {
      try {
        resolvedGuideline = resolveMimicReferenceFromLineage(
          job.flow_type,
          lineage,
          candidateData
        ).guideline_entry;
      } catch {
        resolvedGuideline = asRecord(mimic.visual_guideline);
      }
    }
  }

  if (isTopPerformerMimicCarouselFlow(job.flow_type) && mimic && pickGeneratedOutput(merged)) {
    const visualGuideline = slimVisualGuidelineFromEntry(resolvedGuideline ?? {});
    const composed = composeMimicCarouselDraftPackage(merged, mimic, {
      reference_tier_fallback: mimic.reference_tier_fallback,
      visual_guideline: visualGuideline,
    });
    merged = {
      ...merged,
      draft_package_snapshot: composed,
      draft_package_type: "mimic_carousel_package",
      generated_output: {
        ...(asRecord(merged.generated_output) ?? {}),
        package_type: "mimic_carousel_package",
      },
    };
    await persistGenerationPayload(db, job.id, merged);
  }

  if (
    resolvedGuideline &&
    (isTopPerformerMimicImageFlow(job.flow_type) || isTopPerformerMimicCarouselFlow(job.flow_type))
  ) {
    assertMimicCopyDiffersFromReference(merged, resolvedGuideline);
  }

  if (isTopPerformerMimicCarouselFlow(job.flow_type) && mimic) {
    const gen = pickGeneratedOutputOrEmpty(merged);
    const renderableLlm = slidesFromGeneratedOutput(gen).filter((s) =>
      slideHasRenderableContent(s as Record<string, unknown>)
    );
    const llmCount = renderableLlm.length;
    if (llmCount > 0) {
      const refCountBefore = mimic.reference_items.length;
      const outputCount = expectedMimicCarouselOutputSlideCount(mimic, llmCount);
      if (refCountBefore !== outputCount) {
        mimic = reconcileMimicPayloadToOutputSlideCount(mimic, outputCount);
        merged = mergeMimicPayloadSlice(merged, mimic);
        await persistGenerationPayload(db, job.id, merged);
        logPipelineEvent("info", "generate", "Reconciled mimic_v1 to LLM copy slide count after generation", {
          run_id: runId ?? undefined,
          task_id: job.task_id,
          data: {
            reference_frames_before: refCountBefore,
            output_slides: outputCount,
            llm_slides: llmCount,
            mode: mimic.mode,
          },
        });
      } else if (refCountBefore > llmCount) {
        logPipelineEvent("warn", "generate", "mimic carousel copy slide count mismatch", {
          run_id: runId ?? undefined,
          task_id: job.task_id,
          data: {
            expected_slides: outputCount,
            llm_slides: llmCount,
            skipped_promotional: asRecord(merged.mimic_render_context)?.skipped_promotional_slide_indices,
          },
        });
      }
    }
  }

  logPipelineEvent("info", "generate", "mimic_v1 stored", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    flow_type: job.flow_type,
    data: {
      mode: mimic?.mode,
      strategy: mimic?.mode === "template_bg" ? "template_background" : "per_slide_mimic",
      reference_count: mimic?.reference_items.length,
    },
  });

  return mimic!;
}
