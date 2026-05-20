import type { AppConfig } from "../config.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import type { Pool } from "pg";
import { insertAsset } from "../repositories/assets.js";
import { editImageFromReference } from "./mimic-image-provider.js";
import { mimicPromptForMode } from "./mimic-prompt-builder.js";
import { refreshMimicReferenceFetchUrl } from "./mimic-reference-urls.js";
import { uploadBuffer } from "./supabase-storage.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/**
 * Extract / generate a clean background plate for template-bg carousel mimic.
 */
export async function ensureMimicCarouselBackground(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1
): Promise<string | null> {
  if (mimic.mode !== "template_bg") return null;

  const ref = mimic.reference_items[0];
  if (!ref?.vision_fetch_url) return null;

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, ref);

  const { buffer, mimeType } = await editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("template_bg"),
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "mimic_bg_extract",
    },
  });

  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const objectPath = `mimic_backgrounds/${safeRun}/${safeTask}/bg_v1.${ext}`;

  let publicUrl: string | null = null;
  let storedPath = objectPath;
  try {
    const up = await uploadBuffer(config, objectPath, buffer, mimeType);
    publicUrl = up.public_url;
    storedPath = up.object_path;
  } catch {
    return null;
  }

  await insertAsset(db, {
    asset_id: `${job.task_id}__MIMIC_BACKGROUND_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "MIMIC_BACKGROUND",
    position: -1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: "openai-gpt-image-1",
    metadata_json: { role: "template_background" },
  });

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
    [publicUrl ?? storedPath, job.id]
  );

  return publicUrl ?? storedPath;
}

export function slideMimicRenderMode(mimic: MimicPayloadV1, slideIndex: number): "full_bleed" | "hbs" | null {
  if (mimic.mode === "template_bg") return "hbs";
  if (mimic.mode !== "carousel_visual") return null;
  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  return plan?.render_mode ?? "full_bleed";
}

export function referenceUrlForSlide(mimic: MimicPayloadV1, slideIndex: number): string | null {
  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  const idx = plan?.reference_index ?? slideIndex;
  const item = mimic.reference_items.find((r) => r.index === idx) ?? mimic.reference_items[idx - 1];
  return item?.vision_fetch_url ?? mimic.reference_items[0]?.vision_fetch_url ?? null;
}

export function slideVisionHints(
  mimic: MimicPayloadV1,
  slideIndex: number
): { layout?: string; visual?: string } {
  const gp = asRecord(mimic as unknown);
  void gp;
  return {};
}

/**
 * Generate a full-bleed mimicked carousel slide PNG.
 */
export async function renderMimicCarouselSlideFullBleed(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number
): Promise<{ buffer: Buffer; mimeType: string }> {
  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  const idx = plan?.reference_index ?? slideIndex;
  const item =
    mimic.reference_items.find((r) => r.index === idx) ?? mimic.reference_items[idx - 1] ?? mimic.reference_items[0];
  if (!item?.vision_fetch_url) throw new Error(`No reference URL for mimic slide ${slideIndex}`);

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);

  return editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("carousel_visual", { index: slideIndex }),
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: `mimic_slide_gen_${slideIndex}`,
    },
  });
}
