import type { AppConfig } from "../config.js";
import type { MimicPayloadV1, MimicReferenceItem } from "../domain/mimic-payload.js";
import { deckUsesUnifiedBackgroundPlate } from "../domain/mimic-text-heavy.js";
import type { Pool } from "pg";
import { insertAsset, listAssetsByTask } from "../repositories/assets.js";
import { editImageFromReference, mimicImageProviderAssetLabel } from "./mimic-image-provider.js";
import { mimicPromptForMode } from "./mimic-prompt-builder.js";
import { refreshMimicReferenceFetchUrl } from "./mimic-reference-urls.js";
import { uploadBuffer } from "./supabase-storage.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function slideTextParts(slide: Record<string, unknown>): { headline: string; body: string } {
  const headline = String(
    slide.headline ?? slide.cover_title ?? slide.title ?? slide.panel_title ?? ""
  ).trim();
  const body = String(
    slide.body ?? slide.cover_subtitle ?? slide.subtitle ?? slide.panel_body ?? ""
  ).trim();
  return { headline, body };
}

/** Headline + body for a 1-based carousel slide index (full-bleed copy injection). */
export function slideOnImageCopyFromSlides(
  slides: Record<string, unknown>[],
  slideIndex1Based: number
): string {
  if (slides.length === 0) return "";
  const idx = Math.max(0, Math.min(slides.length - 1, slideIndex1Based - 1));
  const slide = slides[idx] ?? {};
  const { headline, body } = slideTextParts(slide);
  return [headline, body].filter(Boolean).join("\n\n").trim();
}

/** Resolve archived reference frame for a 1-based output slide (1-based or 0-based item indexes). */
export function referenceItemForMimicSlide(
  mimic: MimicPayloadV1,
  slideIndex: number
): MimicReferenceItem | null {
  const items = mimic.reference_items;
  if (items.length === 0) return null;

  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  if (plan?.reference_index != null) {
    const refIdx = plan.reference_index;
    const exact = items.find((r) => r.index === refIdx);
    if (exact) return exact;
    if (refIdx >= 1 && refIdx <= items.length) {
      const oneBased = items[refIdx - 1];
      if (oneBased) return oneBased;
    }
    if (refIdx >= 0 && refIdx < items.length) {
      const zeroBased = items[refIdx];
      if (zeroBased) return zeroBased;
    }
  }

  const positional = items[slideIndex - 1];
  if (positional) return positional;
  return items[(slideIndex - 1) % items.length] ?? items[0] ?? null;
}

function publicUrlFromAssetRow(
  config: AppConfig,
  row: { public_url: string | null; bucket: string | null; object_path: string | null }
): string | null {
  const direct = (row.public_url ?? "").trim();
  if (direct) return direct;
  const bucket = (row.bucket ?? "").trim();
  const objectPath = (row.object_path ?? "").trim().replace(/^\/+/, "");
  const base = (config.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!bucket || !objectPath || !base) return null;
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
}

function mimicGuidelineEntry(mimic: MimicPayloadV1): Record<string, unknown> {
  const vg = mimic.visual_guideline ?? {};
  return { ...vg, aesthetic_analysis_json: vg };
}

/** Listicles / repeated-template decks reuse slide-1 background plate for every output slide. */
export function mimicDeckUsesUnifiedBackgroundPlate(mimic: MimicPayloadV1): boolean {
  if (mimic.mode !== "template_bg") return false;
  return deckUsesUnifiedBackgroundPlate(mimicGuidelineEntry(mimic));
}

/** Reuse stored `MIMIC_BACKGROUND` plate when present; otherwise generate via Qwen. */
export async function resolveMimicSlideBackgroundPlate(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number
): Promise<string | null> {
  const extractIndex = mimicDeckUsesUnifiedBackgroundPlate(mimic) ? 1 : slideIndex;
  const assets = await listAssetsByTask(db, job.project_id, job.task_id);
  const pos = extractIndex - 1;
  const existing = assets.find(
    (a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND" && a.position === pos
  );
  if (existing) {
    const url = publicUrlFromAssetRow(config, existing);
    if (url) return url;
  }
  if (mimicDeckUsesUnifiedBackgroundPlate(mimic) && slideIndex > 1) {
    const slideOne = assets.find(
      (a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND" && a.position === 0
    );
    if (slideOne) {
      const url = publicUrlFromAssetRow(config, slideOne);
      if (url) return url;
    }
  }
  return extractMimicSlideBackground(db, config, job, mimic, extractIndex);
}

export class MimicBackgroundPlateRequiredError extends Error {
  constructor(taskId: string, slideIndex: number, detail?: string) {
    super(
      `Mimic carousel render blocked for ${taskId} slide ${slideIndex}: ` +
        "template background plate (MIMIC_BACKGROUND from Qwen) is required before compositing. " +
        (detail ?? "Background generation or storage failed.")
    );
    this.name = "MimicBackgroundPlateRequiredError";
  }
}

/** Same as `resolveMimicSlideBackgroundPlate` but never returns null — blocks plain-paper fallback renders. */
export async function requireMimicSlideBackgroundPlate(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number
): Promise<string> {
  const url = await resolveMimicSlideBackgroundPlate(db, config, job, mimic, slideIndex);
  if (!url?.trim()) {
    throw new MimicBackgroundPlateRequiredError(job.task_id, slideIndex);
  }
  return url.trim();
}

export function effectiveMimicSlideRenderMode(
  mimic: MimicPayloadV1,
  slideIndex: number,
  mimicVisualGenAiReachable: boolean
): "full_bleed" | "hbs" | null {
  let mode = slideMimicRenderMode(mimic, slideIndex);
  if (mode === "full_bleed" && !mimicVisualGenAiReachable) mode = "hbs";
  return mode;
}

export function assertMimicSlideBackgroundPresent(
  taskId: string,
  slideIndex: number,
  renderBase: Record<string, unknown>,
  detail?: string
): void {
  const bg =
    typeof renderBase.background_image_url === "string" ? renderBase.background_image_url.trim() : "";
  if (!bg) {
    throw new MimicBackgroundPlateRequiredError(taskId, slideIndex, detail);
  }
}

/**
 * Extract / generate a clean background plate from a reference frame (text stripped, layout kept).
 */
export async function extractMimicSlideBackground(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number
): Promise<string | null> {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (!item) return null;

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);

  const { buffer, mimeType } = await editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("template_bg"),
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: slideIndex === 1 ? "mimic_bg_extract" : `mimic_bg_extract_${slideIndex}`,
    },
  });

  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const objectPath = `mimic_backgrounds/${safeRun}/${safeTask}/slide_${String(slideIndex).padStart(3, "0")}_bg_v1.${ext}`;

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
    asset_id: `${job.task_id}__MIMIC_BACKGROUND_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "MIMIC_BACKGROUND",
    position: slideIndex - 1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: mimicImageProviderAssetLabel(config),
    metadata_json: { role: "template_background", slide_index: slideIndex },
  });

  if (slideIndex === 1) {
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
  }

  return publicUrl ?? storedPath;
}

/** True when carousel mimic needs a stored background plate (template_bg or any hbs slide). */
export function mimicCarouselNeedsBackgroundPlate(mimic: MimicPayloadV1): boolean {
  if (mimic.mode === "template_bg") return true;
  if (mimic.mode !== "carousel_visual") return false;
  return (mimic.slide_plans ?? []).some((plan) => plan.render_mode === "hbs");
}

/** @deprecated Prefer per-slide `resolveMimicSlideBackgroundPlate` — kept for first-slide warm-up. */
export async function ensureMimicCarouselBackground(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1
): Promise<string | null> {
  if (!mimicCarouselNeedsBackgroundPlate(mimic)) return null;
  return resolveMimicSlideBackgroundPlate(db, config, job, mimic, 1);
}

export function slideMimicRenderMode(mimic: MimicPayloadV1, slideIndex: number): "full_bleed" | "hbs" | null {
  if (mimic.mode === "template_bg") return "hbs";
  if (mimic.mode !== "carousel_visual") return null;
  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  return plan?.render_mode ?? "full_bleed";
}

export function referenceUrlForSlide(mimic: MimicPayloadV1, slideIndex: number): string | null {
  return referenceItemForMimicSlide(mimic, slideIndex)?.vision_fetch_url ?? null;
}

export function slideVisionHints(
  mimic: MimicPayloadV1,
  slideIndex: number
): { layout?: string; visual?: string } {
  const vg = asRecord(mimic.visual_guideline);
  const slides = Array.isArray(vg?.slides) ? vg!.slides : [];
  const match =
    slides
      .map((raw) => asRecord(raw))
      .find((s) => s && Number(s.slide_index) === slideIndex) ??
    asRecord(slides[slideIndex - 1]);
  if (!match) return {};
  const layout = String(match.layout_template ?? "").trim();
  const visual = String(match.visual_description ?? "").trim();
  return {
    ...(layout ? { layout } : {}),
    ...(visual ? { visual } : {}),
  };
}

/**
 * Generate a full-bleed mimicked carousel slide PNG.
 */
export async function renderMimicCarouselSlideFullBleed(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number,
  opts?: { onImageCopy?: string | null }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (!item?.vision_fetch_url) throw new Error(`No reference URL for mimic slide ${slideIndex}`);

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);

  const hints = slideVisionHints(mimic, slideIndex);
  return editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("carousel_visual", {
      index: slideIndex,
      layout: hints.layout,
      visual: hints.visual,
      onImageCopy: opts?.onImageCopy,
    }),
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: `mimic_slide_gen_${slideIndex}`,
    },
  });
}
