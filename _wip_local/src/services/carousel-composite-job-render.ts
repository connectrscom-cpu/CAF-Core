import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { CarouselCompositeTemplateRecord } from "../domain/carousel-composite-template.js";
import { slideRoleForIndex } from "../domain/carousel-composite-layout.js";
import { insertAsset } from "../repositories/assets.js";
import {
  buildSlideRenderContext,
  type CarouselRenderCtaOptions,
} from "./carousel-render-pack.js";
import { compositeTextFromRenderContext } from "./carousel-composite-text.js";
import {
  pickBackgroundPlateForRole,
  renderCompositeCarouselSlide,
} from "./carousel-composite-render.js";
import { uploadBuffer } from "./supabase-storage.js";

export const CAROUSEL_COMPOSITE_RENDER_MANIFEST_TYPE = "composite";

export async function renderCarouselSlideWithComposite(
  config: AppConfig,
  template: CarouselCompositeTemplateRecord,
  renderBase: Record<string, unknown>,
  usableSlides: Record<string, unknown>[],
  slideIndex1Based: number,
  totalSlides: number,
  ctaOptions?: CarouselRenderCtaOptions
): Promise<{ buffer: Buffer; mimeType: string }> {
  const ctx = buildSlideRenderContext(renderBase, usableSlides, slideIndex1Based, ctaOptions);
  const role = slideRoleForIndex(slideIndex1Based, totalSlides);
  const text = compositeTextFromRenderContext(ctx, slideIndex1Based, totalSlides);
  const plate = pickBackgroundPlateForRole(template.background_plates, role);

  return renderCompositeCarouselSlide(config, {
    layout: template.layout,
    theme: template.theme,
    role,
    backgroundPlate: plate,
    text,
  });
}

export async function uploadCompositeCarouselSlide(
  config: AppConfig,
  job: { task_id: string; run_id: string; project_id: string },
  slideIndex: number,
  buffer: Buffer,
  mimeType: string
): Promise<{ publicUrl: string | null; storedPath: string }> {
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const objectPath = `carousels/${safeRun}/${safeTask}/slide_${String(slideIndex).padStart(3, "0")}.${ext}`;
  let publicUrl: string | null = null;
  let storedPath = objectPath;
  try {
    const up = await uploadBuffer(config, objectPath, buffer, mimeType);
    publicUrl = up.public_url;
    storedPath = up.object_path;
  } catch {
    /* optional supabase */
  }
  return { publicUrl, storedPath };
}

export async function insertCompositeCarouselSlideAsset(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string },
  slideIndex: number,
  storedPath: string,
  publicUrl: string | null,
  templateKey: string
): Promise<void> {
  await insertAsset(db, {
    asset_id: `${job.task_id}__CAROUSEL_SLIDE_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "CAROUSEL_SLIDE",
    position: slideIndex - 1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: "carousel-composite",
    metadata_json: { slide_index: slideIndex, composite_template_key: templateKey },
  });
}
