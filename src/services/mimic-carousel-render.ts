import type { AppConfig } from "../config.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import type { MimicPayloadV1, MimicReferenceItem } from "../domain/mimic-payload.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import { parseMimicTextBlocks } from "./mimic-slide-typography.js";
import {
  aestheticSlideRecords,
  deckUsesUnifiedBackgroundPlate,
  referenceSlideExceedsOnScreenTextLimit,
  slideOnScreenTextChars,
} from "../domain/mimic-text-heavy.js";
import {
  mimicTemplateLibraryObjectPath,
  referenceIndexForTemplateSlot,
  resolveTemplateStorageFromMimic,
} from "../domain/mimic-template-library.js";
import type { TemplateBgSlot } from "../domain/mimic-template-library.js";
import type { Pool } from "pg";
import { insertAsset, listAssetsByTask } from "../repositories/assets.js";
import { editImageFromReference, mimicImageProviderAssetLabel } from "./mimic-image-provider.js";
import { mimicPromptForMode, type MimicPromptOverrides } from "./mimic-prompt-builder.js";
import { refreshMimicReferenceFetchUrl } from "./mimic-reference-urls.js";
import { isVideoishUrl } from "./instagram-media-normalizer.js";
import { createSignedUrlForObjectKey, uploadBuffer } from "./supabase-storage.js";
import {
  slidesFromGeneratedOutput,
  slideHasRenderableContent,
  type SlidesFromGeneratedOutputOptions,
} from "./carousel-render-pack.js";

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

/** Resolve archived reference frame for a 1-based output slide. */
export function referenceItemForMimicSlide(
  mimic: MimicPayloadV1,
  slideIndex: number
): MimicReferenceItem | null {
  const items = mimic.reference_items;
  if (items.length === 0) return null;

  const plan = mimic.slide_plans?.find((s) => s.slide_index === slideIndex);
  const refIdx = plan?.reference_index ?? slideIndex;

  // Per-slide carousel mimic: reference_index tracks output slide (1:1 with deck order).
  if (refIdx === slideIndex && slideIndex >= 1 && slideIndex <= items.length) {
    return items[slideIndex - 1] ?? null;
  }

  if (plan?.reference_index != null) {
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

/** Listicles / repeated-template decks use 3-slot background deduplication (cover, body, CTA). */
export function mimicDeckUsesSlotDeduplication(mimic: MimicPayloadV1): boolean {
  if (mimic.mode !== "template_bg") return false;
  return deckUsesUnifiedBackgroundPlate(mimicGuidelineEntry(mimic));
}

/** @deprecated Alias kept for backward compat — prefer `mimicDeckUsesSlotDeduplication`. */
export function mimicDeckUsesUnifiedBackgroundPlate(mimic: MimicPayloadV1): boolean {
  return mimicDeckUsesSlotDeduplication(mimic);
}

export type { TemplateBgSlot };

/** Determine the template slot type for a given slide index. */
export function templateBgSlotForIndex(slideIndex: number, totalSlides: number): TemplateBgSlot {
  if (slideIndex === 1) return "cover";
  if (totalSlides > 2 && slideIndex === totalSlides) return "cta";
  return "body";
}


/**
 * Asset position used for deduplication (stored on MIMIC_BACKGROUND assets).
 * All body slides share position 1 so only one plate is generated.
 */
function assetPositionForSlot(slot: TemplateBgSlot, totalSlides: number): number {
  if (slot === "cover") return 0;
  if (slot === "cta") return totalSlides - 1;
  return 1;
}

/** Reuse stored `MIMIC_BACKGROUND` plate when present; otherwise generate via Qwen. */
export async function resolveMimicSlideBackgroundPlate(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number,
  opts?: { promptOverrides?: MimicPromptOverrides | null; totalSlides?: number }
): Promise<string | null> {
  const totalSlides = opts?.totalSlides ?? mimic.reference_items.length;
  const usesSlots = mimicDeckUsesSlotDeduplication(mimic);

  let extractIndex: number;
  let lookupPosition: number;

  if (usesSlots) {
    const slot = templateBgSlotForIndex(slideIndex, totalSlides);
    extractIndex = referenceIndexForTemplateSlot(
      mimicGuidelineEntry(mimic),
      slot,
      mimic.reference_items.length
    );
    lookupPosition = assetPositionForSlot(slot, totalSlides);
  } else {
    extractIndex = slideIndex;
    lookupPosition = slideIndex - 1;
  }

  const assets = await listAssetsByTask(db, job.project_id, job.task_id);
  const existing = assets.find(
    (a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND" && a.position === lookupPosition
  );
  if (existing) {
    const url = publicUrlFromAssetRow(config, existing);
    if (url) return url;
  }

  return extractMimicSlideBackground(db, config, job, mimic, extractIndex, {
    ...opts,
    assetPosition: lookupPosition,
    templateSlot: usesSlots ? templateBgSlotForIndex(slideIndex, totalSlides) : undefined,
    totalSlides,
  });
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
  slideIndex: number,
  opts?: { promptOverrides?: MimicPromptOverrides | null; totalSlides?: number }
): Promise<string> {
  const url = await resolveMimicSlideBackgroundPlate(db, config, job, mimic, slideIndex, opts);
  if (!url?.trim()) {
    throw new MimicBackgroundPlateRequiredError(job.task_id, slideIndex);
  }
  return url.trim();
}

export function effectiveMimicSlideRenderMode(
  mimic: MimicPayloadV1,
  slideIndex: number,
  mimicVisualGenAiReachable: boolean,
  _opts?: { generatedSlides?: Record<string, unknown>[] }
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
  slideIndex: number,
  opts?: {
    promptOverrides?: MimicPromptOverrides | null;
    consistencyHint?: string;
    assetPosition?: number;
    templateSlot?: TemplateBgSlot;
    totalSlides?: number;
  }
): Promise<string | null> {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (!item) return null;

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);

  const { buffer, mimeType } = await editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("template_bg", undefined, opts?.promptOverrides),
    size: "1024x1536",
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: slideIndex === 1 ? "mimic_bg_extract" : `mimic_bg_extract_${slideIndex}`,
    },
  });

  const assetPos = opts?.assetPosition ?? (slideIndex - 1);
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

  const storageDecision = resolveTemplateStorageFromMimic(mimic);
  const librarySlot = opts?.templateSlot;
  let libraryObjectPath: string | null = null;

  if (storageDecision.eligible_for_library && librarySlot && mimic.source_insights_id) {
    const libPath = mimicTemplateLibraryObjectPath(
      job.project_id,
      mimic.source_insights_id,
      librarySlot,
      ext === "jpg" ? "jpg" : "png"
    );
    try {
      const libUp = await uploadBuffer(config, libPath, buffer, mimeType);
      libraryObjectPath = libUp.object_path;
    } catch {
      libraryObjectPath = null;
    }
  }

  await insertAsset(db, {
    asset_id: `${job.task_id}__MIMIC_BACKGROUND_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "MIMIC_BACKGROUND",
    position: assetPos,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: mimicImageProviderAssetLabel(config),
    metadata_json: {
      role: "template_background",
      slide_index: slideIndex,
      template_library_slot: librarySlot ?? null,
      template_storage_quality: storageDecision.quality,
      template_library_object_path: libraryObjectPath,
      source_insights_id: mimic.source_insights_id,
    },
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

function slideGuidelineRecords(mimic: MimicPayloadV1): Record<string, unknown>[] {
  const vg = asRecord(mimic.visual_guideline);
  const fromSlim = Array.isArray(vg?.slides) ? vg!.slides : [];
  if (fromSlim.length > 0) {
    return fromSlim.map((raw) => asRecord(raw)).filter((x): x is Record<string, unknown> => x != null);
  }
  return aestheticSlideRecords({ aesthetic_analysis_json: vg, ...vg });
}

function resolveSlideGuideline(
  mimic: MimicPayloadV1,
  slideIndex: number
): Record<string, unknown> | null {
  const slides = slideGuidelineRecords(mimic);
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  const lookupIdx =
    item?.source_slide_index != null && item.source_slide_index > 0
      ? item.source_slide_index
      : slideIndex;
  return (
    slides.find((s) => Number(s.slide_index) === lookupIdx) ??
    slides[lookupIdx - 1] ??
    null
  );
}

/**
 * Text-only cross-slide consistency for full-bleed (avoids passing prior slide images to DashScope).
 */
export function buildFullBleedConsistencyHint(mimic: MimicPayloadV1, slideIndex: number): string {
  const parts: string[] = [];
  const vg = asRecord(mimic.visual_guideline);
  const consistency = String(vg?.visual_consistency ?? "").trim();
  if (consistency) {
    parts.push(`Match this deck-wide visual consistency: ${consistency.slice(0, 450)}`);
  }
  const dvs = asRecord(vg?.deck_visual_system);
  const aesthetic = String(dvs?.overall_aesthetic ?? "").trim();
  if (aesthetic) parts.push(`Overall aesthetic: ${aesthetic.slice(0, 200)}`);
  const repeated = String(dvs?.repeated_template ?? "").trim();
  if (repeated) parts.push(`Repeated layout pattern: ${repeated.slice(0, 200)}`);

  if (slideIndex > 1) {
    const prev = resolveSlideGuideline(mimic, slideIndex - 1);
    const ct = asRecord(prev?.color_tokens);
    if (ct) {
      const bg = String(ct.background ?? "").trim();
      const text = String(ct.primary_text ?? "").trim();
      const grade = String(ct.photo_grade ?? "").trim();
      const bits = [bg && `background ${bg}`, text && `text ${text}`, grade && `grade ${grade}`].filter(Boolean);
      if (bits.length) parts.push(`Align with the previous slide palette (${bits.join(", ")})`);
    }
  }
  return parts.join(" ");
}

/** 1-based slide indices to extract before copy (cover, body, optional CTA). */
export function slideIndicesForTemplateBgPrep(totalSlides: number): number[] {
  const n = Math.max(1, totalSlides);
  const indices = new Set<number>([1]);
  if (n >= 2) indices.add(2);
  if (n > 2) indices.add(n);
  return [...indices].sort((a, b) => a - b);
}

/** True when required MIMIC_BACKGROUND plate positions exist for template_bg slot mode. */
export async function templateBackgroundPlatesReady(
  db: Pool,
  projectId: string,
  taskId: string,
  totalSlides: number
): Promise<boolean> {
  const assets = await listAssetsByTask(db, projectId, taskId);
  const bg = assets.filter((a) => (a.asset_type ?? "").toUpperCase() === "MIMIC_BACKGROUND");
  if (bg.length === 0) return false;

  const needed = new Set<number>();
  needed.add(0);
  needed.add(1);
  if (totalSlides > 2) needed.add(totalSlides - 1);

  for (const pos of needed) {
    if (!bg.some((a) => a.position === pos)) return false;
  }
  return true;
}

export function slideVisionHints(
  mimic: MimicPayloadV1,
  slideIndex: number
): { layout?: string; visual?: string } {
  const match = resolveSlideGuideline(mimic, slideIndex);
  if (!match) return {};
  const layout = String(match.layout_template ?? "").trim();
  const visual = String(match.visual_description ?? "").trim();
  return {
    ...(layout ? { layout } : {}),
    ...(visual ? { visual } : {}),
  };
}

export interface SlideIntentHints {
  slidePurpose: string | null;
  brandSpecificity: string | null;
  referenceTextLength: number;
}

/**
 * Read Nemotron intent tags + on-screen text length for a slide.
 * Used to shape the Qwen prompt at render time.
 */
export function slideIntentHints(
  mimic: MimicPayloadV1,
  slideIndex: number
): SlideIntentHints {
  const match = resolveSlideGuideline(mimic, slideIndex);
  if (!match) return { slidePurpose: null, brandSpecificity: null, referenceTextLength: 0 };
  return {
    slidePurpose: typeof match.slide_purpose === "string" ? match.slide_purpose.trim().toLowerCase() : null,
    brandSpecificity: typeof match.brand_specificity === "string" ? match.brand_specificity.trim().toLowerCase() : null,
    referenceTextLength: String(match.on_screen_text_transcript ?? match.on_image_text ?? "").trim().length,
  };
}

const FULL_BLEED_TEXT_CAP = 200;

/**
 * Build a Qwen prompt instruction based on the slide's Nemotron intent tags.
 * Tells Qwen what kind of slide this is and how to handle text/branding.
 */
export function buildSlideIntentInstruction(intent: SlideIntentHints): string {
  const parts: string[] = [];

  if (intent.referenceTextLength > FULL_BLEED_TEXT_CAP) {
    parts.push(
      `The reference slide has dense on-image text (${intent.referenceTextLength} chars). Do not render any text — leave clean low-detail zones where copy will be overlaid later.`
    );
  }

  if (intent.slidePurpose === "cta") {
    parts.push("This is a call-to-action slide. Do not render CTA wording on the image — visuals only.");
  } else if (intent.slidePurpose === "hook") {
    parts.push("This is a hook/cover slide. Keep bold visual energy with no on-image headline or text blocks.");
  } else if (intent.slidePurpose === "storytelling" || intent.slidePurpose === "content") {
    parts.push("This is a content slide. Match visual narrative energy only — no on-image text.");
  }

  if (intent.brandSpecificity === "low") {
    parts.push("The reference has some brand-specific elements — replace any brand names, handles, or product references with generic equivalents.");
  }

  return parts.join(" ");
}

// ─── Video slide filter ─────────────────────────────────────────────────────

function videoSlideIndicesFromMimic(mimic: MimicPayloadV1): number[] {
  const vg = asRecord(mimic.visual_guideline);
  const raw = vg?.video_slide_indices ?? vg?.skipped_video_slide_indices;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function referenceItemLooksLikeVideo(item: MimicReferenceItem | null | undefined): boolean {
  if (!item) return false;
  if (item.is_video_slide) return true;
  const role = String(item.role ?? "").toLowerCase();
  if (role.includes("video")) return true;
  const ct = String(item.content_type ?? "").toLowerCase();
  if (ct.startsWith("video/")) return true;
  for (const p of [item.object_path, item.source_url, item.vision_fetch_url, item.preview_url]) {
    if (p && isVideoishUrl(p)) return true;
  }
  return false;
}

/**
 * True when the reference frame for this output slide was a video clip in the source carousel.
 * Video slides are never mimicked (no full-bleed / HBS generation).
 */
export function isCarouselVideoSlide(mimic: MimicPayloadV1, slideIndex: number): boolean {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (referenceItemLooksLikeVideo(item)) return true;

  const videoIdx = videoSlideIndicesFromMimic(mimic);
  if (videoIdx.length === 0) return false;

  const src = item?.source_slide_index;
  if (src != null && Number.isFinite(src) && src > 0) {
    return videoIdx.includes(src);
  }

  const anyMapped = mimic.reference_items.some(
    (r) => r.source_slide_index != null && Number.isFinite(r.source_slide_index) && r.source_slide_index > 0
  );
  if (!anyMapped && videoIdx.includes(slideIndex)) return true;

  const match = resolveSlideGuideline(mimic, slideIndex);
  if (match) {
    const role = String(match.image_or_photo_role ?? "").toLowerCase();
    if (role.includes("video")) return true;
    const purpose = String(match.slide_purpose ?? "").toLowerCase();
    if (purpose === "video" || purpose === "video_clip") return true;
  }

  return false;
}

// ─── Promotional / brand-specific slide filter ──────────────────────────────

const PROMO_KEYWORD_PATTERNS = [
  /\bdownload\b/i,
  /\bbuy\s+now\b/i,
  /\border\s+now\b/i,
  /\bget\s+(your|the|my|our)\b/i,
  /\bavailable\s+now\b/i,
  /\bdelivered\s+immediately\b/i,
  /\bas\s+a\s+pdf\b/i,
  /\bpdf\b/i,
  /\blink\s+in\s+bio\b/i,
  /\buse\s+my\s+link\b/i,
  /\bin\s+(?:the\s+)?bio\b/i,
  /\bswipe\s+up\b/i,
  /\buse\s+code\b/i,
  /\bdiscount\b/i,
  /\bfree\s+shipping\b/i,
  /\bcoupon\b/i,
  /\bpromo\s*code\b/i,
  /\bcash\s*back\b/i,
  /\bearn\s+\$+/i,
  /\bearn\b.*\b(eat|eating|going\s+out)\b/i,
  /\b(?:get|save)\s+\d+\s*%/i,
  /\btake\s+(the|our|my)\s+quiz\b/i,
  /\bmy\s+(course|book|guide|ebook|e-book|program|masterclass|workshop|webinar|app|tool)\b/i,
  /\bour\s+(course|book|guide|ebook|e-book|program|masterclass|workshop|webinar|app|tool)\b/i,
  /\bnew\s+guide\b/i,
  /\bcomplete\s+guide\b/i,
  /\bblueprint\s+for\b/i,
  /\bpre-?order\b/i,
  /\blaunch(ing|ed)?\b.*\b(guide|book|course|program)\b/i,
  /\bupdated\s+version\s+will\s+drop\b/i,
  /\blatest\s+obsession\b/i,
  /\breferral\b/i,
  /\bsponsored\b/i,
  /\bpaid\s+partnership\b/i,
  /\baffiliate\b/i,
  /\b[A-Z][A-Z0-9]{1,}\s+APP\b/,
  /\$\d/,
  /\bpart\s+\d\b/i,
];

const PROMO_VISUAL_PATTERNS = [
  /\bproduct\s+mockup/i,
  /\bbook\s+cover/i,
  /\bguide\s+cover/i,
  /\bdevice\s+mockup/i,
  /\bphone\s+screen/i,
  /\btablet\s+screen/i,
  /\bipad\s+mockup/i,
  /\bebook\s+preview/i,
  /\blaptop\s+mockup/i,
  /\bapp\s+screen/i,
  /\bapp\s+icon/i,
  /\bapp\s+logo/i,
  /\bmobile\s+app/i,
  /\bqr\s+code/i,
];

function slideTextBlobForPromoCheck(match: Record<string, unknown>): string {
  const parts: string[] = [];
  const main = String(match.on_screen_text_transcript ?? match.on_image_text ?? "").trim();
  if (main) parts.push(main);
  for (const b of parseMimicTextBlocks(match.text_blocks)) {
    const t = b.text.trim();
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

/** True when archived reference on-screen text (transcript + text_blocks) exceeds the mimic deck cap. */
export function isExcessiveOnScreenTextSlide(mimic: MimicPayloadV1, slideIndex: number): boolean {
  const match = resolveSlideGuideline(mimic, slideIndex);
  if (!match) return false;
  return referenceSlideExceedsOnScreenTextLimit(match);
}

/**
 * Detect whether a reference slide should be skipped (promotional / brand-specific).
 *
 * Priority:
 *  1. Nemotron `mimic_evaluation.skip_slide_indices` — deck-level explicit list
 *  2. Per-slide `slide_purpose` tag (`self_promo`, `product_pitch`)
 *  3. Per-slide `brand_specificity` tag (`high`)
 *  4. Regex fallback on `on_screen_text_transcript` + `visual_description` (pre-tagging packs)
 */
export function isPromotionalSlide(
  mimic: MimicPayloadV1,
  slideIndex: number
): boolean {
  if (isCarouselVideoSlide(mimic, slideIndex)) return true;

  const vg = asRecord(mimic.visual_guideline);

  // Level 1: deck-level skip list from mimic_evaluation
  const mimicEval = asRecord(vg?.mimic_evaluation);
  if (mimicEval) {
    const skipIndices = Array.isArray(mimicEval.skip_slide_indices) ? mimicEval.skip_slide_indices : [];
    if (skipIndices.includes(slideIndex)) return true;
    const contentIndices = Array.isArray(mimicEval.content_slide_indices) ? mimicEval.content_slide_indices : [];
    if (contentIndices.length > 0 && contentIndices.includes(slideIndex)) return false;
  }

  const match = resolveSlideGuideline(mimic, slideIndex);
  if (match) {
    const purpose = String(match.slide_purpose ?? "").trim().toLowerCase();
    const brandSpec = String(match.brand_specificity ?? "").trim().toLowerCase();

    const transcript = slideTextBlobForPromoCheck(match);
    const visual = String(match.visual_description ?? "").trim();

    if (transcript && PROMO_KEYWORD_PATTERNS.some((rx) => rx.test(transcript))) return true;
    if (visual && PROMO_VISUAL_PATTERNS.some((rx) => rx.test(visual))) return true;

    if (purpose === "self_promo" || purpose === "product_pitch") return true;
    if (brandSpec === "high") return true;

    if (purpose && brandSpec) return false;

    return false;
  }

  // No per-slide vision row: last frame is often a product/download CTA in mixed decks.
  const refCount = mimic.reference_items.length;
  if (refCount > 2 && slideIndex === refCount) {
    const fp = String(vg?.format_pattern ?? "").toLowerCase();
    if (fp === "mixed" || fp.includes("mixed")) return true;
  }

  return false;
}

/**
 * Full-bleed Qwen mimic only when the reference frame is visual-led with manageable on-slide text.
 * Without per-slide tags, only the cover (slide 1) may use full_bleed when the deck has visual cues.
 */
export function isFullBleedCandidateSlide(mimic: MimicPayloadV1, slideIndex: number): boolean {
  if (mimic.mode !== "carousel_visual") return false;
  if (isPromotionalSlide(mimic, slideIndex)) return false;
  return true;
}

/**
 * carousel_visual decks use art-only visual plates + HBS for every output slide.
 * Promo frames are removed earlier via `filterPromotionalSlidesFromMimicPayload`.
 */
export function reconcileFullBleedSlidePlansAtRender(mimic: MimicPayloadV1): MimicPayloadV1 {
  if (mimic.mode !== "carousel_visual") return mimic;
  const plans = (mimic.slide_plans ?? []).map((plan) => ({
    ...plan,
    render_mode: "full_bleed" as const,
  }));
  return { ...mimic, slide_plans: plans };
}

/**
 * Return 1-based slide indices that should be rendered (non-promotional).
 * For carousel_visual mode, filters out brand/CTA slides from the reference deck.
 */
export function nonPromotionalSlideIndices(
  mimic: MimicPayloadV1,
  totalSlides: number
): number[] {
  const indices: number[] = [];
  for (let i = 1; i <= totalSlides; i++) {
    if (!isPromotionalSlide(mimic, i)) indices.push(i);
  }
  return indices.length > 0 ? indices : [1];
}

/** 1-based content slide indices from mimic_evaluation when the classifier narrowed the deck. */
export function contentSlideIndicesFromMimic(mimic: MimicPayloadV1): number[] {
  const vg = asRecord(mimic.visual_guideline);
  const mimicEval = asRecord(vg?.mimic_evaluation);
  if (!mimicEval) return [];
  return Array.isArray(mimicEval.content_slide_indices)
    ? mimicEval!.content_slide_indices.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1
      )
    : [];
}

function contentSlideIndexSet(mimic: MimicPayloadV1): Set<number> | null {
  const indices = contentSlideIndicesFromMimic(mimic);
  if (indices.length === 0) return null;
  return new Set(indices);
}

/**
 * Output slide count for carousel_visual: reference frames after promo filtering,
 * optionally capped to generated copy slide count.
 */
export function expectedMimicCarouselOutputSlideCount(
  mimic: MimicPayloadV1,
  generatedSlideCount?: number
): number {
  const refCount = Math.max(mimic.reference_items.length, 0);
  if (typeof generatedSlideCount === "number" && Number.isFinite(generatedSlideCount) && generatedSlideCount > 0) {
    return Math.min(refCount, Math.floor(generatedSlideCount));
  }
  return refCount;
}

/** Required on-screen copy slide count for mimic carousel LLM + render (from planning context). */
export function targetMimicCarouselCopySlideCount(
  payload: Record<string, unknown>,
  mimic?: MimicPayloadV1 | null
): number | null {
  const grounding = asRecord(payload.mimic_job_grounding);
  const layout = grounding?.slide_copy_layout;
  if (Array.isArray(layout) && layout.length > 0) return layout.length;
  const ctx = asRecord(payload.mimic_render_context);
  const fromCtx = ctx?.target_slide_count;
  if (typeof fromCtx === "number" && Number.isFinite(fromCtx) && fromCtx > 0) {
    return Math.floor(fromCtx);
  }
  if (mimic) {
    const content = contentSlideIndicesFromMimic(mimic);
    if (content.length > 0) return content.length;
    if (mimic.reference_items.length > 0) return mimic.reference_items.length;
  }
  return null;
}

export function countRenderableMimicCarouselSlides(
  parsed: Record<string, unknown>,
  opts?: SlidesFromGeneratedOutputOptions
): number {
  return slidesFromGeneratedOutput(parsed, opts).filter((s) =>
    slideHasRenderableContent(s as Record<string, unknown>)
  ).length;
}

export class MimicCarouselCopySlideCountError extends Error {
  readonly target: number;
  readonly got: number;

  constructor(target: number, got: number) {
    super(
      `Mimic carousel copy incomplete: got ${got} renderable slide(s), need ${target}. Regenerate with exactly ${target} slides matching slide_copy_layout (same order, one slide per content frame).`
    );
    this.name = "MimicCarouselCopySlideCountError";
    this.target = target;
    this.got = got;
  }
}

export function assertMimicCarouselCopySlideCount(
  payload: Record<string, unknown>,
  parsed: Record<string, unknown>,
  mimic?: MimicPayloadV1 | null
): void {
  const target = targetMimicCarouselCopySlideCount(payload, mimic ?? pickMimicPayload(payload));
  if (target == null || target < 1) return;
  const got = countRenderableMimicCarouselSlides(parsed, { preferred_slide_count: target });
  if (got < target) throw new MimicCarouselCopySlideCountError(target, got);
}

export function mimicCarouselSlideCountRetryFooter(target: number, got: number): string {
  return [
    "",
    "---",
    `CRITICAL: Your JSON had ${got} renderable on-screen slide(s) but this job requires exactly ${target}.`,
    `Return one complete JSON object with exactly ${target} entries in top-level \`slides[]\` (one per slide_copy_layout row, same order).`,
    "Each slide must contain rephrased on-screen copy (headline+body, or text_blocks with role+text). Do not omit content slides.",
    "Do NOT leave headline/body empty strings. Every slide must have at least one non-empty text field that will be rendered onto the slide.",
    "For content slides, keep `body` substantive (target 220–400 chars unless the slide is intentionally a short CTA/hook).",
    "Output must follow the FLOW_CAROUSEL copy schema (cover/body/cta + caption/hashtags when the schema expects them) — not a visual-only analysis stub.",
  ].join("\n");
}

/**
 * Trim reference_items and slide_plans so render never exceeds generated copy slides.
 */
export function reconcileMimicPayloadToOutputSlideCount(
  mimic: MimicPayloadV1,
  outputSlideCount: number
): MimicPayloadV1 {
  const refLen = mimic.reference_items.length;
  if (refLen === 0) return mimic;
  const cap = Math.max(1, Math.min(Math.floor(outputSlideCount), refLen));
  if (cap >= refLen) {
    const slide_plans =
      mimic.slide_plans && mimic.slide_plans.length > 0
        ? mimic.slide_plans.map((plan, i) => ({
            slide_index: i + 1,
            reference_index: Math.min(plan.reference_index ?? i + 1, cap),
            render_mode: plan.render_mode ?? "full_bleed",
          }))
        : mimic.reference_items.map((_, i) => ({
            slide_index: i + 1,
            reference_index: i + 1,
            render_mode: "full_bleed" as const,
          }));
    return { ...mimic, slide_plans };
  }

  const filteredItems = mimic.reference_items.slice(0, cap).map((item, i) => ({
    ...item,
    index: i + 1,
  }));
  const slide_plans = filteredItems.map((_, i) => ({
    slide_index: i + 1,
    render_mode: "full_bleed" as const,
    reference_index: i + 1,
  }));
  return { ...mimic, reference_items: filteredItems, slide_plans };
}

/**
 * Drop promotional / brand-locked / video / text-heavy reference frames before copy + render.
 * Renumbers `reference_items` and rebuilds 1:1 `slide_plans` (all full_bleed).
 */
export function filterPromotionalSlidesFromMimicPayload(mimic: MimicPayloadV1): {
  mimic: MimicPayloadV1;
  removed_slide_indices: number[];
} {
  // Applies to both mimic carousel modes:
  // - carousel_visual: per-slide reference frames
  // - template_bg: deck-level reference frames (covers listicles that end with self-promo/CTA panels)
  if ((mimic.mode !== "carousel_visual" && mimic.mode !== "template_bg") || mimic.reference_items.length === 0) {
    return { mimic, removed_slide_indices: [] };
  }

  const contentSet = contentSlideIndexSet(mimic);
  const kept: MimicReferenceItem[] = [];
  const removed: number[] = [];
  const keptOrigIndices: number[] = [];
  let hasDenseTextSlides = false;

  for (const item of mimic.reference_items) {
    const origIdx =
      item.source_slide_index != null && item.source_slide_index > 0
        ? item.source_slide_index
        : item.index;
    if (contentSet && !contentSet.has(origIdx)) {
      removed.push(origIdx);
      continue;
    }
    if (isPromotionalSlide(mimic, origIdx)) {
      removed.push(origIdx);
      continue;
    }
    kept.push({ ...item, source_slide_index: origIdx });
    keptOrigIndices.push(origIdx);
    if (isExcessiveOnScreenTextSlide(mimic, origIdx)) hasDenseTextSlides = true;
  }

  // If nothing is removed and no dense-text frames exist, keep payload unchanged.
  // Otherwise, we still rebuild slide_plans so dense-text frames can prefer HBS overlay.
  if (removed.length === 0 && !hasDenseTextSlides) {
    return { mimic, removed_slide_indices: [] };
  }
  if (kept.length === 0) {
    return { mimic, removed_slide_indices: removed };
  }

  const filteredItems = kept.map((item, i) => ({ ...item, index: i + 1 }));
  const slide_plans = filteredItems.map((_, i) => {
    const origIdx = keptOrigIndices[i] ?? (i + 1);
    const denseText = isExcessiveOnScreenTextSlide(mimic, origIdx);
    return {
      slide_index: i + 1,
      // Dense reference text should not remove the slide; it just means we should
      // prefer a clean plate + copy overlay (HBS) instead of per-slide full-bleed mimic.
      render_mode: (mimic.mode === "template_bg" || denseText ? "hbs" : "full_bleed") as "hbs" | "full_bleed",
      reference_index: i + 1,
    };
  });

  return {
    mimic: { ...mimic, reference_items: filteredItems, slide_plans },
    removed_slide_indices: removed,
  };
}

/** Exclude promotional reference slides from copy LLM layout; renumber remaining slides 1..N. */
export function filterSlideCopyLayoutForMimic(
  mimic: MimicPayloadV1,
  layout: MimicSlideCopyLayoutForLlm[]
): MimicSlideCopyLayoutForLlm[] {
  if (layout.length === 0) return layout;

  const vg = asRecord(mimic.visual_guideline);
  const mimicEval = asRecord(vg?.mimic_evaluation);
  const contentIndices = Array.isArray(mimicEval?.content_slide_indices)
    ? mimicEval!.content_slide_indices.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1
      )
    : [];

  let kept = layout;
  if (mimic.mode === "carousel_visual" || mimic.mode === "template_bg") {
    if (contentIndices.length > 0) {
      const contentSet = new Set(contentIndices);
      kept = layout.filter((s) => contentSet.has(s.slide_index));
    } else {
      kept = layout.filter((s) => !isPromotionalSlide(mimic, s.slide_index));
    }
  }

  kept = kept.filter(
    (s) =>
      !referenceSlideExceedsOnScreenTextLimit({
        on_screen_text_transcript: s.reference_on_screen_text,
        text_blocks: s.text_blocks,
      })
  );

  if (kept.length === layout.length) return layout;
  if (kept.length === 0) return layout;
  return kept.map((s, i) => ({ ...s, slide_index: i + 1 }));
}

/**
 * Compose text onto a clean background plate via Qwen (Pass 2 for template_bg).
 * The background plate is the reference image; Qwen renders the copy onto it.
 */
export async function composeMimicSlideOnBackground(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  backgroundUrl: string,
  slideIndex: number,
  opts?: {
    onImageCopy?: string | null;
    promptOverrides?: MimicPromptOverrides | null;
    consistencyHint?: string | null;
    previousSlideUrl?: string | null;
  }
): Promise<{ buffer: Buffer; mimeType: string }> {
  return editImageFromReference(config, {
    referenceUrl: backgroundUrl,
    prompt: mimicPromptForMode("template_bg_compose", {
      onImageCopy: opts?.onImageCopy,
      consistencyHint: opts?.consistencyHint,
    }, opts?.promptOverrides),
    size: "1024x1536",
    previousSlideUrl: opts?.previousSlideUrl || undefined,
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: `mimic_bg_compose_${slideIndex}`,
    },
  });
}

/**
 * Generate a full-bleed mimicked carousel slide PNG.
 * When `previousSlideUrl` is provided, it is sent as additional context to Qwen
 * so the model can maintain color, style, and tonal consistency across the carousel.
 */
export async function renderMimicCarouselSlideFullBleed(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  mimic: MimicPayloadV1,
  slideIndex: number,
  opts?: {
    onImageCopy?: string | null;
    promptOverrides?: MimicPromptOverrides | null;
    previousSlideUrl?: string | null;
    projectHandle?: string | null;
    /** When true, Flux bakes on-image copy (skips art-only plate + HBS overlay). */
    bakeTextOnImage?: boolean;
  }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (!item?.vision_fetch_url) throw new Error(`No reference URL for mimic slide ${slideIndex}`);

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);
  const hints = slideVisionHints(mimic, slideIndex);

  const basePrompt = mimicPromptForMode(
    "carousel_visual",
    {
      index: slideIndex,
      artOnly: opts?.bakeTextOnImage !== true,
      onImageCopy: opts?.onImageCopy,
      layout: hints.layout,
      visual: hints.visual,
      projectHandle: opts?.projectHandle,
    },
    opts?.promptOverrides
  );

  return editImageFromReference(config, {
    referenceUrl,
    prompt: basePrompt,
    size: "1024x1536",
    previousSlideUrl: opts?.previousSlideUrl || undefined,
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: opts?.bakeTextOnImage ? `mimic_slide_flux_text_${slideIndex}` : `mimic_slide_gen_${slideIndex}`,
    },
  });
}

/** Persist a finished carousel slide PNG (Flux or renderer) as CAROUSEL_SLIDE asset. */
export async function persistCarouselSlidePng(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  slideIndex: number,
  buffer: Buffer,
  mimeType: string,
  provider: string
): Promise<{ public_url: string | null; object_path: string }> {
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
    // Supabase optional
  }

  await insertAsset(db, {
    asset_id: `${job.task_id}__CAROUSEL_SLIDE_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "CAROUSEL_SLIDE",
    position: slideIndex - 1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider,
    metadata_json: { slide_index: slideIndex },
  });

  return { public_url: publicUrl, object_path: storedPath };
}

/** Upload art-only visual plate and return a fetchable URL for HBS compositing. */
export async function persistMimicVisualPlateForSlide(
  db: Pool,
  config: AppConfig,
  job: { task_id: string; project_id: string; run_id: string },
  slideIndex: number,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const objectPath = `mimic_visual_plates/${safeRun}/${safeTask}/slide_${String(slideIndex).padStart(3, "0")}_v1.${ext}`;

  const up = await uploadBuffer(config, objectPath, buffer, mimeType);
  const storedPath = up.object_path;
  let publicUrl = up.public_url?.trim() || null;

  await insertAsset(db, {
    asset_id: `${job.task_id}__MIMIC_VISUAL_PLATE_${slideIndex}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "MIMIC_VISUAL_PLATE",
    position: slideIndex - 1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: storedPath,
    public_url: publicUrl,
    provider: mimicImageProviderAssetLabel(config),
    metadata_json: { slide_index: slideIndex, mimic: true, role: "visual_plate" },
  });

  if (storedPath && config.SUPABASE_ASSETS_BUCKET) {
    try {
      const signed = await createSignedUrlForObjectKey(
        config,
        config.SUPABASE_ASSETS_BUCKET,
        storedPath,
        600
      );
      if ("signedUrl" in signed && signed.signedUrl.trim()) {
        return signed.signedUrl.trim();
      }
    } catch {
      /* fall through */
    }
  }
  if (publicUrl) return publicUrl;
  throw new Error(`Mimic visual plate upload failed for ${job.task_id} slide ${slideIndex}`);
}
