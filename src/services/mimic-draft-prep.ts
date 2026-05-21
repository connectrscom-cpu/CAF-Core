import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  composeMimicCarouselDraftPackage,
  slimVisualGuidelineFromEntry,
} from "../domain/mimic-carousel-package.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { mergeMimicPayloadSlice, pickMimicPayload } from "../domain/mimic-payload.js";
import {
  isTopPerformerMimicCarouselFlow,
  isTopPerformerMimicRenderableFlow,
} from "../domain/top-performer-mimic-flow-types.js";
import { getJobLineageByTaskId } from "../repositories/job-lineage.js";
import { classifyMimicMode } from "./mimic-mode-classifier.js";
import { resolveMimicReferenceFromLineage } from "./mimic-reference-resolver.js";
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

/**
 * Draft-phase mimic prep: resolve reference assets + classify mode into `generation_payload.mimic_v1`.
 * Mimic carousel jobs also get a composed `mimic_carousel_package` on `draft_package_snapshot`.
 * No image API calls — safe to run during Generate Jobs.
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

  const existing = pickMimicPayload(job.generation_payload);
  if (existing?.reference_items?.length) {
    return existing;
  }

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

  let resolved;
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

  const { mode, slide_plans } = classifyMimicMode(job.flow_type, resolved.guideline_entry);
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

  if (resolved.reference_tier_fallback) {
    logPipelineEvent("warn", "generate", "mimic reference tier fallback", {
      run_id: runId ?? undefined,
      task_id: job.task_id,
      flow_type: job.flow_type,
      data: {
        resolved_tier: resolved.analysis_tier,
        reference_count: mimic.reference_items.length,
      },
    });
  }

  const row = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const gp = row.rows[0]?.generation_payload ?? {};
  let merged = mergeMimicPayloadSlice(gp, mimic);

  if (isTopPerformerMimicCarouselFlow(job.flow_type)) {
    const composed = composeMimicCarouselDraftPackage(merged, mimic, {
      reference_tier_fallback: resolved.reference_tier_fallback,
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
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(merged), job.id]
  );

  logPipelineEvent("info", "generate", "mimic_v1 stored", {
    run_id: runId ?? undefined,
    task_id: job.task_id,
    flow_type: job.flow_type,
    data: {
      mode,
      strategy: mode === "template_bg" ? "template_background" : "per_slide_mimic",
      reference_count: mimic.reference_items.length,
    },
  });

  return mimic;
}
