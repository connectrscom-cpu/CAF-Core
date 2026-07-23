import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  composeMimicCarouselDraftPackage,
  slimVisualGuidelineFromEntry,
} from "../domain/mimic-carousel-package.js";
import { assertMimicCopyDiffersFromReference } from "../domain/mimic-copy-guard.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { mergeMimicPayloadSlice, pickMimicPayload } from "../domain/mimic-payload.js";
import { pickOrDeriveSlideIntelligence, parseSlideIntelligenceBundle } from "../domain/slide-intelligence.js";
import {
  buildWhyMimicSlidePlansFromSil,
  isWhyMimicExecution,
  MIMIC_EXECUTION_MODE_WHY,
} from "../domain/why-mimic-execution.js";
import { isWhyMimicCarouselFlow } from "../domain/why-mimic-carousel-flow-types.js";
import { parseBrandProfile, type BrandProfileV1 } from "../domain/brand-profile.js";
import { buildBrandExecutionBrief } from "../domain/brand-translation.js";
import { parseBvsFromPayload, brandProfileFromBvsSnapshot, resolveBvsForEnabledJob, resolveBvsSnapshotForProject, buildBvsSlice } from "../domain/bvs-v1.js";
import { enrichMimicWithBvsRenderPlan, bvsTemplateBgUsesInventedPlates } from "../domain/bvs-render-plan.js";
import { isVisualFirstCarouselFlow } from "../domain/visual-first-carousel-flow-types.js";
import { isNewVisualCarouselExecution, buildNewVisualSlidePlans } from "../domain/new-visual-carousel-execution.js";
import { attachProductEvidenceUrlsToMimicPayload } from "../domain/product-bible-v1.js";
import { ensureNewVisualCarouselBeforeCopyGeneration } from "./new-visual-carousel-prep.js";
import { getActiveBrandProfile } from "../repositories/brand-profiles.js";
import { buildContentSlideCopyLayoutFromEntry, buildSlideCopyLayoutForLlmFromPayload } from "../domain/mimic-job-grounding.js";
import {
  attachSemanticContractToPayload,
  resolveSemanticContractForJob,
} from "../domain/semantic-contract.js";
import { assertMimicReferenceEligibleForFlow } from "../domain/mimic-reference-eligibility.js";
import { buildMimicRenderContextForLlm } from "../domain/mimic-render-context.js";
import {
  assertMimicCarouselCopySlideCount,
  expectedMimicCarouselOutputSlideCount,
  filterPromotionalSlidesFromMimicPayload,
  reconcileMimicPayloadToOutputSlideCount,
  targetMimicCarouselCopySlideCount,
} from "./mimic-carousel-render.js";
import { slideHasRenderableContent, slidesFromGeneratedOutput } from "./carousel-render-pack.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { resolveTemplateStorageDecision } from "../domain/mimic-template-library.js";
import { pickGeneratedOutput } from "../domain/generation-payload-output.js";
import {
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
  isTopPerformerMimicRenderableFlow,
  isTpGroundedCarouselRenderFlow,
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
import { loadProjectMimicRenderSettings, buildMimicRenderSettingsSnapshot } from "./mimic-project-config.js";
import { generateMimicFluxImagePromptsForJob } from "./mimic-flux-image-prompts.js";
import { generateNewVisualFluxImagePromptsForJob } from "./new-visual-carousel-flux-prompts.js";
import { generateWhyMimicFluxImagePromptsForJob } from "./why-mimic-flux-image-prompts.js";
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
  evidencePayload?: Record<string, unknown> | null,
  brandProfile?: BrandProfileV1 | null,
  whyMimicCopyEnabled?: boolean
): { mimic: MimicPayloadV1; visualGuideline: ReturnType<typeof slimVisualGuidelineFromEntry> } {
  let visualGuideline = slimVisualGuidelineFromEntry(resolved.guideline_entry);
  const fromPayload = evidencePayload ? carouselVideoSlideIndicesFromPayload(evidencePayload) : [];
  if (fromPayload.length > 0 && !(visualGuideline.video_slide_indices?.length)) {
    visualGuideline = { ...visualGuideline, video_slide_indices: fromPayload };
  }
  const folder = inspectionFolderFromEntry(resolved.guideline_entry);

  // Why Mimic: project the reference's slide intelligence onto the job (read-only;
  // never gates render). Prefer the pack entry's stored bundle, derive on-read otherwise.
  const entryRec = asRecord(resolved.guideline_entry) ?? {};
  const slideIntelligence = pickOrDeriveSlideIntelligence(entryRec.slide_intelligence_v1, {
    aesthetic: asRecord(entryRec.aesthetic_analysis_json),
    insights_id: resolved.source_insights_id,
    analysis_tier: resolved.analysis_tier,
    mediaKind: "carousel",
  });

  const whyExecution = isWhyMimicCarouselFlow(flowType);

  // Brand-Aware Why Mimic: always when why lane; classic lane only when project toggle on.
  const brandBrief =
    whyExecution || whyMimicCopyEnabled
      ? brandProfile && slideIntelligence
        ? buildBrandExecutionBrief(slideIntelligence, brandProfile)
        : null
      : null;

  const { mode, slide_plans: classifiedPlans } = classifyMimicMode(flowType, resolved.guideline_entry, modeOverride);
  const slide_plans =
    whyExecution && slideIntelligence
      ? buildWhyMimicSlidePlansFromSil(
          slideIntelligence,
          mode,
          normalizeMimicReferenceItems(resolved.reference_items).length
        )
      : classifiedPlans;

  const mimic: MimicPayloadV1 = {
    schema_version: 1,
    ...(whyExecution ? { execution_mode: MIMIC_EXECUTION_MODE_WHY } : {}),
    mode,
    mode_override: modeOverride ?? null,
    classified_at: new Date().toISOString(),
    source_insights_id: resolved.source_insights_id,
    source_evidence_row_id: resolved.source_evidence_row_id,
    analysis_tier: resolved.analysis_tier,
    reference_tier_fallback: resolved.reference_tier_fallback ?? false,
    reference_items: normalizeMimicReferenceItems(resolved.reference_items),
    archive_reference_items: normalizeMimicReferenceItems(resolved.reference_items),
    storage_folder_prefix: folder.storage_folder_prefix,
    storage_folder_label: folder.storage_folder_label,
    visual_guideline: visualGuideline as unknown as Record<string, unknown>,
    twist_brief: {
      visual_only: true,
      legal_note: whyExecution
        ? "Preserve the reference persuasion strategy only; invent fresh visuals and copy — do not copy logos, faces, or copyrighted imagery verbatim."
        : "Recreate the visual pattern only; do not copy logos, faces, or copyrighted imagery verbatim.",
    },
    slide_plans,
    ...(slideIntelligence
      ? { slide_intelligence: slideIntelligence as unknown as Record<string, unknown> }
      : {}),
    ...(brandBrief
      ? { brand_execution_brief: brandBrief as unknown as Record<string, unknown> }
      : {}),
  };

  return { mimic, visualGuideline };
}

async function resolveMimicPayloadForJob(
  db: Pool,
  config: AppConfig,
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
  const brandProfileRow = await getActiveBrandProfile(db, job.project_id);
  let brandProfile: BrandProfileV1 | null = brandProfileRow
    ? parseBrandProfile(brandProfileRow.profile_json)
    : null;
  let bvs = await resolveBvsForEnabledJob(db, job.project_id, job.generation_payload);
  if (isVisualFirstCarouselFlow(job.flow_type) && !bvs?.enabled) {
    const resolved = await resolveBvsSnapshotForProject(db, job.project_id);
    if (resolved) {
      bvs = buildBvsSlice(true, resolved.version, resolved.snapshot);
    }
  }
  if (bvs?.enabled && bvs.bible_snapshot) {
    const merged = brandProfileFromBvsSnapshot(bvs.bible_snapshot, null);
    brandProfile = merged ? parseBrandProfile(merged) : brandProfile;
  }
  const mimicSettings = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const built = buildMimicPayloadFromResolved(
    job.flow_type,
    resolved,
    packOverride ?? null,
    evidencePayload,
    brandProfile,
    mimicSettings.whyMimicCopyEnabled
  );
  if (bvs?.enabled) {
    built.mimic = enrichMimicWithBvsRenderPlan(
      {
        ...built.mimic,
        bvs_enabled: true,
        ...(bvs.bible_snapshot
          ? { bvs_bible_snapshot: bvs.bible_snapshot as unknown as Record<string, unknown> }
          : {}),
      },
      bvs.bible_snapshot
    );
  }

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

/** Restore full archived frames for jobs persisted before archive_reference_items existed. */
export async function backfillMimicArchiveReferenceItems(
  db: Pool,
  job: {
    project_id: string;
    task_id: string;
    flow_type: string;
    generation_payload: Record<string, unknown>;
  },
  mimic: MimicPayloadV1
): Promise<MimicPayloadV1> {
  if (mimic.archive_reference_items?.length) return mimic;
  try {
    const lineage = await getJobLineageByTaskId(db, job.project_id, job.task_id);
    if (!lineage) return mimic;
    const candidateData = asRecord(job.generation_payload.candidate_data);
    const resolved = resolveMimicReferenceFromLineage(job.flow_type, lineage, candidateData);
    const archive = normalizeMimicReferenceItems(resolved.reference_items);
    if (archive.length === 0) return mimic;
    return { ...mimic, archive_reference_items: archive };
  } catch {
    return mimic;
  }
}

function refreshMimicJobGroundingSlideLayout(
  gp: Record<string, unknown>,
  guidelineEntry: Record<string, unknown>,
  mimic: MimicPayloadV1
): Record<string, unknown> {
  const prior = asRecord(gp.mimic_job_grounding);
  if (!prior) return gp;
  const archive = mimic.archive_reference_items?.length
    ? mimic.archive_reference_items
    : mimic.reference_items;
  const entryForLayout: Record<string, unknown> = {
    ...guidelineEntry,
    stored_inspection_media_json: {
      items: archive.map((item, i) => ({
        index: item.source_slide_index ?? item.index ?? i + 1,
      })),
    },
  };
  const layout = buildContentSlideCopyLayoutFromEntry(entryForLayout);
  if (layout.length === 0) return gp;
  return {
    ...gp,
    mimic_job_grounding: {
      ...prior,
      slide_copy_layout: layout,
    },
  };
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

function payloadWithSemanticContract(
  gp: Record<string, unknown>,
  mimic: MimicPayloadV1
): Record<string, unknown> {
  const contract = resolveSemanticContractForJob(gp, {
    slideIntelligence: parseSlideIntelligenceBundle(mimic.slide_intelligence),
  });
  return attachSemanticContractToPayload(gp, contract);
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

  if (isVisualFirstCarouselFlow(job.flow_type)) {
    return ensureNewVisualCarouselBeforeCopyGeneration(db, config, job, runId);
  }

  const mimicRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const renderContextOpts = { visualSimilarityPct: mimicRender.visualSimilarityPct };

  const existing = pickMimicPayload(job.generation_payload);
  if (existing?.reference_items?.length) {
    const archive = existing.archive_reference_items?.length
      ? normalizeMimicReferenceItems(existing.archive_reference_items)
      : normalizeMimicReferenceItems(existing.reference_items);
    const normalized = {
      ...existing,
      reference_items: normalizeMimicReferenceItems(existing.reference_items),
      archive_reference_items: archive,
    };
    const { mimic: filtered, removed_slide_indices } =
      filterPromotionalSlidesFromMimicPayload(normalized);
    const vg = asRecord(filtered.visual_guideline) ?? {};
    const renderContext = {
      ...buildMimicRenderContextForLlm(filtered, vg, renderContextOpts),
      ...(removed_slide_indices.length > 0
        ? { skipped_promotional_slide_indices: removed_slide_indices }
        : {}),
    };
    const row = await db.query<{ generation_payload: Record<string, unknown> }>(
      `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    const gp = row.rows[0]?.generation_payload ?? job.generation_payload;
    const bvs = await resolveBvsForEnabledJob(db, job.project_id, gp);
    let filteredWithBvs = filtered;
    if (bvs?.enabled && bvs.bible_snapshot) {
      filteredWithBvs = enrichMimicWithBvsRenderPlan(filtered, bvs.bible_snapshot);
    }
    const renderSettings = buildMimicRenderSettingsSnapshot(config, {
      ...mimicRender,
      ...(bvsTemplateBgUsesInventedPlates(filteredWithBvs) ? { imageInputMode: "analysis_t2i" as const } : {}),
    });
    const mergedBase = {
      ...mergeMimicPayloadSlice(gp, filteredWithBvs),
      ...(bvs ? { bvs_v1: bvs } : {}),
      mimic_render_context: renderContext,
      mimic_render_settings: renderSettings,
    };
    const merged = refreshMimicJobGroundingSlideLayout(mergedBase, vg, filteredWithBvs);
    await persistGenerationPayload(db, job.id, payloadWithSemanticContract(merged, filteredWithBvs));
    return filteredWithBvs;
  }

  const { mimic: resolvedMimic, resolved } = await resolveMimicPayloadForJob(db, config, job, runId);
  const { mimic, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(resolvedMimic);
  const renderContext = {
    ...buildMimicRenderContextForLlm(mimic, resolved.guideline_entry, renderContextOpts),
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
  const bvs = await resolveBvsForEnabledJob(db, job.project_id, gp);
  let mimicWithBvs = mimic;
  if (bvs?.enabled && bvs.bible_snapshot) {
    mimicWithBvs = enrichMimicWithBvsRenderPlan(mimic, bvs.bible_snapshot);
  }
  const renderSettings = buildMimicRenderSettingsSnapshot(config, {
    ...mimicRender,
    ...(bvsTemplateBgUsesInventedPlates(mimicWithBvs) ? { imageInputMode: "analysis_t2i" as const } : {}),
  });
  const mergedBase = {
    ...mergeMimicPayloadSlice(gp, mimicWithBvs),
    ...(bvs ? { bvs_v1: bvs } : {}),
    mimic_render_context: renderContext,
    mimic_render_settings: renderSettings,
    template_storage_decision: templateStorage,
  };
  const merged = refreshMimicJobGroundingSlideLayout(
    mergedBase,
    resolved.guideline_entry,
    mimicWithBvs
  );

  await persistGenerationPayload(db, job.id, payloadWithSemanticContract(merged, mimicWithBvs));

  logPipelineEvent("info", "generate", "mimic reference resolved before copy", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    flow_type: job.flow_type,
    data: {
      mode: mimicWithBvs.mode,
      copy_before_visual_mimic: renderContext.copy_before_visual_mimic,
      target_slide_count: renderContext.target_slide_count,
      reference_count: mimicWithBvs.reference_items.length,
      template_storage_quality: templateStorage.quality,
      template_library_eligible: templateStorage.eligible_for_library,
      bvs_template_bg_invent: bvsTemplateBgUsesInventedPlates(mimicWithBvs),
    },
  });

  return mimicWithBvs;
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
  if (!config.MIMIC_IMAGE_ENABLED || !isTpGroundedCarouselRenderFlow(job.flow_type)) {
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

  // Why Mimic template_bg: plates are generated after copy (SIL + flux prompts + BVS) — same as full-bleed.
  if (isWhyMimicExecution(job.flow_type, mimic)) {
    return { prepared: false, skipped: true };
  }

  // BVS template_bg: invent brand plates after copy (analysis_t2i + BVS flux prompts), not reference strip.
  if (bvsTemplateBgUsesInventedPlates(mimic)) {
    return { prepared: false, skipped: true };
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
  const mimicRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const indices = mimicDeckUsesSlotDeduplication(mimic)
    ? slideIndicesForTemplateBgPrep(totalSlides)
    : [1];

  for (const slideIndex of indices) {
    await requireMimicSlideBackgroundPlate(db, config, job, mimic, slideIndex, {
      promptOverrides,
      totalSlides,
      visualSimilarityPct: mimicRender.visualSimilarityPct,
      imageInputMode: mimicRender.imageInputMode,
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

  const mimicRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const renderContextOpts = { visualSimilarityPct: mimicRender.visualSimilarityPct };

  let mimic = pickMimicPayload(job.generation_payload);
  if (!mimic && isVisualFirstCarouselFlow(job.flow_type)) {
    mimic = await ensureNewVisualCarouselBeforeCopyGeneration(db, config, job, runId);
  }
  let resolvedGuideline: Record<string, unknown> | null = null;

  if (!mimic?.reference_items?.length && !isNewVisualCarouselExecution(job.flow_type, mimic)) {
    const resolved = await resolveMimicPayloadForJob(db, config, job, runId);
    const filtered = filterPromotionalSlidesFromMimicPayload(resolved.mimic);
    mimic = filtered.mimic;
    resolvedGuideline = resolved.resolved.guideline_entry;
    const renderContext = {
      ...buildMimicRenderContextForLlm(mimic, resolved.resolved.guideline_entry, renderContextOpts),
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
      mimic_render_settings: buildMimicRenderSettingsSnapshot(config, mimicRender),
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

  if (isTpGroundedCarouselRenderFlow(job.flow_type) && mimic && pickGeneratedOutput(merged)) {
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
    !isWhyMimicExecution(job.flow_type, mimic) &&
    !isNewVisualCarouselExecution(job.flow_type, mimic) &&
    (isTopPerformerMimicImageFlow(job.flow_type) || isTpGroundedCarouselRenderFlow(job.flow_type))
  ) {
    assertMimicCopyDiffersFromReference(merged, resolvedGuideline);
  }

  if (isTpGroundedCarouselRenderFlow(job.flow_type) && mimic) {
    const gen = pickGeneratedOutputOrEmpty(merged);
    const mimicTarget = targetMimicCarouselCopySlideCount(merged, mimic);
    const slideOpts = mimicTarget != null ? { preferred_slide_count: mimicTarget } : undefined;
    assertMimicCarouselCopySlideCount(merged, gen, mimic);
    const renderableLlm = slidesFromGeneratedOutput(gen, slideOpts).filter((s) =>
      slideHasRenderableContent(s as Record<string, unknown>)
    );
    const llmCount = renderableLlm.length;
    if (llmCount > 0 && !isNewVisualCarouselExecution(job.flow_type, mimic)) {
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
    } else if (llmCount > 0 && isNewVisualCarouselExecution(job.flow_type, mimic)) {
      mimic = {
        ...mimic,
        slide_plans: buildNewVisualSlidePlans(llmCount),
      };
      merged = mergeMimicPayloadSlice(merged, mimic);
      await persistGenerationPayload(db, job.id, merged);
    }

    const whyFlux = isWhyMimicExecution(job.flow_type, mimic);
    const newVisualFlux = isNewVisualCarouselExecution(job.flow_type, mimic);
    const bvsTemplateFlux = bvsTemplateBgUsesInventedPlates(mimic);
    const imageInputMode =
      whyFlux || newVisualFlux || bvsTemplateFlux ? "analysis_t2i" : mimicRender.imageInputMode;
    if (imageInputMode === "analysis_t2i" && !mimic.flux_image_prompts) {
      const layout = buildSlideCopyLayoutForLlmFromPayload(merged);
      const canGenerateFlux =
        layout.length > 0 || whyFlux || newVisualFlux || bvsTemplateFlux;
      if (canGenerateFlux) {
        // Re-select product screenshots now that copy/script text is available.
        mimic = attachProductEvidenceUrlsToMimicPayload(merged, mimic, {
          candidateData: asRecord(merged.candidate_data),
        });
        merged = mergeMimicPayloadSlice(merged, mimic);
        await persistGenerationPayload(db, job.id, merged);

        const fluxOpts = { imageInputMode, useLlm: config.MIMIC_FLUX_PROMPT_LLM } as const;
        const { bySlide, meta } = whyFlux
          ? await generateWhyMimicFluxImagePromptsForJob(
              config,
              config.OPENAI_API_KEY ?? "",
              db,
              { task_id: job.task_id, project_id: job.project_id, run_id: runId },
              mimic,
              gen,
              layout,
              fluxOpts
            )
          : newVisualFlux
            ? await generateNewVisualFluxImagePromptsForJob(
                config,
                config.OPENAI_API_KEY ?? "",
                db,
                { task_id: job.task_id, project_id: job.project_id, run_id: runId },
                mimic,
                gen,
                layout,
                fluxOpts
              )
            : await generateMimicFluxImagePromptsForJob(
              config,
              config.OPENAI_API_KEY ?? "",
              db,
              { task_id: job.task_id, project_id: job.project_id, run_id: runId },
              mimic,
              gen,
              layout,
              fluxOpts
            );
        if (Object.keys(bySlide).length > 0) {
          mimic = { ...mimic, flux_image_prompts: bySlide };
          merged = mergeMimicPayloadSlice(merged, mimic);
          await persistGenerationPayload(db, job.id, merged);
          logPipelineEvent("info", "generate", whyFlux ? "why_mimic_flux_image_prompts_stored" : newVisualFlux ? "new_visual_flux_image_prompts_stored" : "mimic_flux_image_prompts_stored", {
            run_id: runId ?? undefined,
            task_id: job.task_id,
            data: {
              slides_written: meta.slides_written,
              slides_requested: meta.slides_requested,
              slides_reference_fallback: meta.slides_reference_fallback,
              model: meta.model,
              used_llm: meta.used_llm,
              execution_mode: whyFlux ? MIMIC_EXECUTION_MODE_WHY : undefined,
            },
          });
        }
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
