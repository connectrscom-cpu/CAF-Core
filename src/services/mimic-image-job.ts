import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { onImageCopyForMimicRender } from "../domain/mimic-copy-guard.js";
import { requireMimicPayloadForRender } from "../domain/mimic-payload.js";
import { assertImageMimicSingleReference } from "../domain/mimic-reference-eligibility.js";
import { insertAsset, deleteAssetsForTask } from "../repositories/assets.js";
import type { RunRow } from "../repositories/runs.js";
import { generateMimicSlideImage, assertMimicImageProviderConfigured, mimicImageProviderAssetLabel } from "./mimic-image-provider.js";
import { loadProjectMimicRenderSettings } from "./mimic-project-config.js";
import { mimicPromptForMode, type MimicPromptOverrides } from "./mimic-prompt-builder.js";
import { loadMimicPromptOverrides } from "./mimic-prompt-overrides-loader.js";
import { refreshMimicPayloadReferenceUrls, refreshMimicReferenceFetchUrl } from "./mimic-reference-urls.js";
import { finalJobStatusAfterRender } from "./validation-router.js";
import { uploadBuffer } from "./supabase-storage.js";
import { logPipelineEvent } from "./pipeline-logger.js";

type JobRow = {
  id: string;
  task_id: string;
  flow_type: string;
  project_id: string;
  run_id: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
};

async function updateJobRenderState(db: Pool, jobId: string, patch: Record<string, unknown>): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs
     SET render_state = COALESCE(render_state, '{}'::jsonb) || $1::jsonb, updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(patch), jobId]
  );
}

export async function processImageMimicJob(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
): Promise<void> {
  if (!config.MIMIC_IMAGE_ENABLED) {
    throw new Error("MIMIC_IMAGE_ENABLED is off");
  }
  assertMimicImageProviderConfigured(config);

  const fresh = await db.query<{ generation_payload: Record<string, unknown> }>(
    `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  const payload = fresh.rows[0]?.generation_payload ?? job.generation_payload;
  const mimicRaw = requireMimicPayloadForRender(payload);
  const mimic = await refreshMimicPayloadReferenceUrls(config, mimicRaw);
  if (mimic.mode !== "image_full") {
    throw new Error(`processImageMimicJob expected mode image_full, got ${mimic.mode}`);
  }

  assertImageMimicSingleReference(mimic.reference_items);

  const ref = mimic.reference_items[0];
  if (!ref?.vision_fetch_url) {
    throw new Error("mimic_v1 has no reference image URL");
  }

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, ref);

  const mimicProjectRender = await loadProjectMimicRenderSettings(db, job.project_id, config);
  const mimicBflModelOverride = mimicProjectRender.bflModel;
  const imageProvider = mimicImageProviderAssetLabel(config, mimicBflModelOverride);

  await db.query(`UPDATE caf_core.content_jobs SET status = 'RENDERING', updated_at = now() WHERE id = $1`, [
    job.id,
  ]);
  await updateJobRenderState(db, job.id, {
    provider: imageProvider,
    status: "pending",
    phase: "mimic_image_edit",
  });

  await deleteAssetsForTask(db, job.project_id, job.task_id);

  logPipelineEvent("info", "render", "starting image mimic render", {
    run_id: job.run_id,
    task_id: job.task_id,
    flow_type: job.flow_type,
  });

  const onImageCopy = onImageCopyForMimicRender(payload);
  if (!onImageCopy.trim()) {
    throw new Error(
      "Image mimic render requires on-image copy in generated_output (hook_text, cover, or slide body) — regenerate the job draft."
    );
  }

  const promptOverrides = await loadMimicPromptOverrides(db);
  const { buffer, mimeType } = await generateMimicSlideImage(config, {
    referenceUrl,
    prompt: mimicPromptForMode(
      "image_full",
      { onImageCopy },
      promptOverrides,
      { visualSimilarityPct: mimicProjectRender.visualSimilarityPct }
    ),
    bflModelOverride: mimicBflModelOverride,
    visualSimilarityPct: mimicProjectRender.visualSimilarityPct,
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "mimic_image_edit",
    },
  });

  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const objectPath = `images/${safeRun}/${safeTask}/frame_001.${ext}`;

  let publicUrl: string | null = null;
  let storedPath = objectPath;
  try {
    const up = await uploadBuffer(config, objectPath, buffer, mimeType);
    publicUrl = up.public_url;
    storedPath = up.object_path;
  } catch {
    /* Supabase optional */
  }

  await insertAsset(db, {
    asset_id: `${job.task_id}__STATIC_IMAGE_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "STATIC_IMAGE",
    position: 0,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: imageProvider,
    metadata_json: { mimic_mode: mimic.mode, source_insights_id: mimic.source_insights_id },
  });

  const renderManifest = {
    render_type: "image_mimic",
    asset_type: "image",
    provider: imageProvider,
    mimic_mode: mimic.mode,
    finished_at: new Date().toISOString(),
    slides: [{ index: 1, object_path: storedPath, public_url: publicUrl }],
  };

  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = jsonb_set(
           jsonb_set(COALESCE(generation_payload, '{}'::jsonb), '{render_manifest}', $1::jsonb, true),
           '{mimic_v1,render,finished_at}', to_jsonb($2::text), true
         ),
         asset_id = $3,
         updated_at = now()
     WHERE id = $4`,
    [JSON.stringify(renderManifest), renderManifest.finished_at, storedPath, job.id]
  );

  await updateJobRenderState(db, job.id, {
    provider: imageProvider,
    status: "completed",
    phase: "done",
  });

  const terminalStatus = await finalJobStatusAfterRender(recommendedRoute);
  await db.query(`UPDATE caf_core.content_jobs SET status = $1, updated_at = now() WHERE id = $2`, [
    terminalStatus,
    job.id,
  ]);

  if (run) {
    await db.query(
      `INSERT INTO caf_core.job_state_transitions (task_id, project_id, from_state, to_state, triggered_by, actor)
       VALUES ($1, $2, 'RENDERING', $3, 'system', 'mimic-image-job')`,
      [job.task_id, run.project_id, terminalStatus]
    );
  }
}
