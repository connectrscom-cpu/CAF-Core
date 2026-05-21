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
import { pickGeneratedOutput } from "../domain/generation-payload-output.js";
import {
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicImageFlow,
  isTopPerformerMimicRenderableFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import { getJobLineageByTaskId } from "../repositories/job-lineage.js";
import { classifyMimicMode } from "./mimic-mode-classifier.js";
import {
  resolveMimicReferenceFromLineage,
  type ResolvedMimicReference,
} from "./mimic-reference-resolver.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { compactStoredInspectionMedia } from "./visual-guidelines-media.js";

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

function buildMimicPayloadFromResolved(
  flowType: string,
  resolved: ResolvedMimicReference
): { mimic: MimicPayloadV1; visualGuideline: ReturnType<typeof slimVisualGuidelineFromEntry> } {
  const { mode, slide_plans } = classifyMimicMode(flowType, resolved.guideline_entry);
  const visualGuideline = slimVisualGuidelineFromEntry(resolved.guideline_entry);
  const folder = inspectionFolderFromEntry(resolved.guideline_entry);

  const mimic: MimicPayloadV1 = {
    schema_version: 1,
    mode,
    classified_at: new Date().toISOString(),
    source_insights_id: resolved.source_insights_id,
    source_evidence_row_id: resolved.source_evidence_row_id,
    analysis_tier: resolved.analysis_tier,
    reference_tier_fallback: resolved.reference_tier_fallback ?? false,
    reference_items: resolved.reference_items,
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
  const built = buildMimicPayloadFromResolved(job.flow_type, resolved);

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
    return existing;
  }

  const { mimic, resolved } = await resolveMimicPayloadForJob(db, job, runId);
  const renderContext = buildMimicRenderContextForLlm(mimic, resolved.guideline_entry);

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp = row.rows[0]?.generation_payload ?? {};
  const merged = {
    ...mergeMimicPayloadSlice(gp, mimic),
    mimic_render_context: renderContext,
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
    },
  });

  return mimic;
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
    mimic = resolved.mimic;
    resolvedGuideline = resolved.resolved.guideline_entry;
    const renderContext = buildMimicRenderContextForLlm(mimic, resolved.resolved.guideline_entry);
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
