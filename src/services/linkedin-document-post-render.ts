/**
 * Render companion images for FLOW_LINKEDIN_DOCUMENT_POST (BVS / Flux T2I, no copy on image).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  linkedInImageRenderSize,
  type LinkedInAspectRatio,
} from "../domain/linkedin-document-post-flow-types.js";
import {
  LINKEDIN_DOCUMENT_POST_V1_KEY,
  pickLinkedInDocumentPostV1,
  type LinkedInDocumentPostV1,
} from "../domain/linkedin-document-post.js";
import { insertAsset, deleteAssetsForTask } from "../repositories/assets.js";
import type { RunRow } from "../repositories/runs.js";
import {
  assertMimicImageProviderConfigured,
  generateMimicSlideImage,
  mimicImageProviderAssetLabel,
} from "./mimic-image-provider.js";
import { loadProjectMimicRenderSettings } from "./mimic-project-config.js";
import { finalJobStatusAfterRender } from "./validation-router.js";
import { uploadBuffer } from "./supabase-storage.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import {
  assertRenderNotPaused,
  beginRenderActivity,
  endRenderActivity,
  updateRenderActivity,
} from "./render-control.js";

type JobRow = {
  id: string;
  task_id: string;
  flow_type: string;
  project_id: string;
  run_id: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
};

function companionPrompt(brief: string, ratio: LinkedInAspectRatio): string {
  const shape = ratio === "1:1" ? "square 1:1" : "portrait 4:5";
  return [
    `LinkedIn companion image, ${shape}, premium editorial photography or clean illustrated scene.`,
    brief.trim(),
    "Art-only plate: absolutely no readable text, letters, numbers, logos, watermarks, or UI.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function processLinkedInDocumentPostJob(
  db: Pool,
  config: AppConfig,
  job: JobRow,
  run: RunRow | null,
  recommendedRoute: string | null
): Promise<void> {
  assertRenderNotPaused();
  beginRenderActivity({
    task_id: job.task_id,
    run_id: job.run_id,
    flow_type: job.flow_type,
    kind: "image",
    phase: "starting",
  });

  try {
    if (!config.MIMIC_IMAGE_ENABLED) {
      throw new Error("MIMIC_IMAGE_ENABLED is off (required for LinkedIn companion images)");
    }
    assertMimicImageProviderConfigured(config);

    const fresh = await db.query<{ generation_payload: Record<string, unknown> }>(
      `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
      [job.id]
    );
    const payload = { ...(fresh.rows[0]?.generation_payload ?? job.generation_payload) };
    const doc = pickLinkedInDocumentPostV1(payload);
    if (!doc?.post_text?.trim()) {
      throw new Error("linkedin_document_post_v1 missing post_text");
    }

    const renderSettings = await loadProjectMimicRenderSettings(db, job.project_id, config);
    const size = linkedInImageRenderSize(doc.aspect_ratio);
    const providerLabel = mimicImageProviderAssetLabel(config, renderSettings.bflModel);

    await db.query(`UPDATE caf_core.content_jobs SET status = 'RENDERING', updated_at = now() WHERE id = $1`, [
      job.id,
    ]);

    await deleteAssetsForTask(db, job.project_id, job.task_id);

    const mediaUrls: string[] = [];
    const updatedCompanions = [...doc.companion_images];
    const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");

    for (let i = 0; i < doc.image_count; i++) {
      const slot = updatedCompanions[i] ?? {
        index: i + 1,
        visual_brief: `Companion image ${i + 1}`,
      };
      updateRenderActivity(job.task_id, {
        phase: `linkedin_image_${i + 1}_of_${doc.image_count}`,
        kind: "image",
      });

      const prompt = companionPrompt(slot.visual_brief, doc.aspect_ratio);
      const { buffer, mimeType } = await generateMimicSlideImage(config, {
        prompt,
        size,
        imageInputMode: renderSettings.imageInputMode === "analysis_t2i" ? "analysis_t2i" : "analysis_t2i",
        bflModelOverride: renderSettings.bflModel,
        audit: {
          db,
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "linkedin_document_companion_image",
        },
      });

      const ext = mimeType.includes("jpeg") ? "jpg" : "png";
      const objectPath = `linkedin/${safeRun}/${safeTask}/companion_${i + 1}.${ext}`;
      let publicUrl: string | null = null;
      let storedPath = objectPath;
      try {
        const up = await uploadBuffer(config, objectPath, buffer, mimeType);
        publicUrl = up.public_url;
        storedPath = up.object_path;
      } catch {
        /* Supabase optional */
      }
      if (!publicUrl) throw new Error(`Upload failed for companion image ${i + 1}`);

      const assetId = `${job.task_id}__LINKEDIN_COMPANION_v${i + 1}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      await insertAsset(db, {
        asset_id: assetId,
        task_id: job.task_id,
        project_id: job.project_id,
        asset_type: "LINKEDIN_COMPANION_IMAGE",
        position: i,
        bucket: config.SUPABASE_ASSETS_BUCKET,
        object_path: storedPath,
        public_url: publicUrl,
        provider: providerLabel,
        metadata_json: {
          aspect_ratio: doc.aspect_ratio,
          slot_index: i + 1,
          visual_brief: slot.visual_brief,
        },
      });

      updatedCompanions[i] = {
        ...slot,
        index: i + 1,
        asset_id: assetId,
        public_url: publicUrl,
      };
      mediaUrls.push(publicUrl);
    }

    const nextDoc: LinkedInDocumentPostV1 = {
      ...doc,
      companion_images: updatedCompanions.slice(0, doc.image_count),
    };
    payload[LINKEDIN_DOCUMENT_POST_V1_KEY] = nextDoc;
    payload.publish_media_urls_json = mediaUrls;

    await db.query(
      `UPDATE caf_core.content_jobs SET
        generation_payload = $1::jsonb,
        render_provider = $2,
        render_status = 'completed',
        render_state = COALESCE(render_state, '{}'::jsonb) || $3::jsonb,
        status = $4,
        updated_at = now()
      WHERE id = $5`,
      [
        JSON.stringify(payload),
        providerLabel,
        JSON.stringify({
          status: "completed",
          phase: "done",
          linkedin_companion_count: mediaUrls.length,
          aspect_ratio: doc.aspect_ratio,
        }),
        finalJobStatusAfterRender(recommendedRoute),
        job.id,
      ]
    );

    logPipelineEvent("info", "render", "linkedin_document_post_render_complete", {
      task_id: job.task_id,
      run_id: run?.run_id,
      data: { images: mediaUrls.length, aspect_ratio: doc.aspect_ratio },
    });
  } finally {
    endRenderActivity(job.task_id);
  }
}
