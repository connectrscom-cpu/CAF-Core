import type { AppConfig } from "../config.js";
import type { MimicPayloadV1, MimicReferenceItem } from "../domain/mimic-payload.js";
import { deckUsesUnifiedBackgroundPlate } from "../domain/mimic-text-heavy.js";
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

  const consistencyHint = usesSlots
    ? "Maintain consistent color palette, gradients, and visual style with the other slides in this carousel."
    : "";
  return extractMimicSlideBackground(db, config, job, mimic, extractIndex, {
    ...opts,
    consistencyHint,
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
    prompt: mimicPromptForMode("template_bg", { consistencyHint: opts?.consistencyHint }, opts?.promptOverrides),
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

function resolveSlideGuideline(
  mimic: MimicPayloadV1,
  slideIndex: number
): Record<string, unknown> | null {
  const vg = asRecord(mimic.visual_guideline);
  const slides = Array.isArray(vg?.slides) ? vg!.slides : [];
  return (
    slides
      .map((raw) => asRecord(raw))
      .find((s) => s && Number(s.slide_index) === slideIndex) ??
    asRecord(slides[slideIndex - 1]) ??
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
      `The reference slide has dense text (${intent.referenceTextLength} chars). Keep any on-image text to under ${FULL_BLEED_TEXT_CAP} characters total — shorten, summarize, or use placeholder text blocks.`
    );
  }

  if (intent.slidePurpose === "cta") {
    parts.push("This is a call-to-action slide. Replace any brand-specific CTAs with a generic, universally applicable call to action.");
  } else if (intent.slidePurpose === "hook") {
    parts.push("This is a hook/cover slide. Keep the bold visual energy but use fresh, original text — not the reference wording.");
  } else if (intent.slidePurpose === "storytelling" || intent.slidePurpose === "content") {
    parts.push("This is a content slide. Capture the same narrative energy but do not reproduce the reference text.");
  }

  if (intent.brandSpecificity === "low") {
    parts.push("The reference has some brand-specific elements — replace any brand names, handles, or product references with generic equivalents.");
  }

  return parts.join(" ");
}

// ─── Promotional / brand-specific slide filter ──────────────────────────────

const PROMO_KEYWORD_PATTERNS = [
  /\bdownload\b/i,
  /\bbuy\s+now\b/i,
  /\border\s+now\b/i,
  /\bget\s+(your|the|my|our)\b/i,
  /\bavailable\s+now\b/i,
  /\blink\s+in\s+bio\b/i,
  /\bswipe\s+up\b/i,
  /\buse\s+code\b/i,
  /\bdiscount\b/i,
  /\bfree\s+shipping\b/i,
  /\bcoupon\b/i,
  /\bpromo\s*code\b/i,
  /\btake\s+(the|our|my)\s+quiz\b/i,
  /\bmy\s+(course|book|guide|ebook|e-book|program|masterclass|workshop|webinar|app|tool)\b/i,
  /\bour\s+(course|book|guide|ebook|e-book|program|masterclass|workshop|webinar|app|tool)\b/i,
  /\bnew\s+guide\b/i,
  /\bpre-?order\b/i,
  /\blaunch(ing|ed)?\b.*\b(guide|book|course|program)\b/i,
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
];

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
  const vg = asRecord(mimic.visual_guideline);

  // Level 1: deck-level skip list from mimic_evaluation
  const mimicEval = asRecord(vg?.mimic_evaluation);
  if (mimicEval) {
    const skipIndices = Array.isArray(mimicEval.skip_slide_indices) ? mimicEval.skip_slide_indices : [];
    if (skipIndices.includes(slideIndex)) return true;
    const contentIndices = Array.isArray(mimicEval.content_slide_indices) ? mimicEval.content_slide_indices : [];
    if (contentIndices.length > 0 && contentIndices.includes(slideIndex)) return false;
  }

  // Level 2-3: per-slide intent tags
  const slides = Array.isArray(vg?.slides) ? vg!.slides : [];
  const match =
    slides
      .map((raw) => asRecord(raw))
      .find((s) => s && Number(s.slide_index) === slideIndex) ??
    asRecord(slides[slideIndex - 1]);
  if (!match) return false;

  const purpose = String(match.slide_purpose ?? "").trim().toLowerCase();
  const brandSpec = String(match.brand_specificity ?? "").trim().toLowerCase();

  if (purpose === "self_promo" || purpose === "product_pitch") return true;
  if (brandSpec === "high") return true;

  if (purpose && brandSpec) return false;

  // Level 4: regex fallback for packs without Nemotron tags
  const transcript = String(
    match.on_screen_text_transcript ?? match.on_image_text ?? ""
  ).trim();
  const visual = String(match.visual_description ?? "").trim();

  if (transcript && PROMO_KEYWORD_PATTERNS.some((rx) => rx.test(transcript))) return true;
  if (visual && PROMO_VISUAL_PATTERNS.some((rx) => rx.test(visual))) return true;

  return false;
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
  }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const item = referenceItemForMimicSlide(mimic, slideIndex);
  if (!item?.vision_fetch_url) throw new Error(`No reference URL for mimic slide ${slideIndex}`);

  const referenceUrl = await refreshMimicReferenceFetchUrl(config, item);

  const visionHints = slideVisionHints(mimic, slideIndex);
  const intent = slideIntentHints(mimic, slideIndex);

  let effectiveCopy = String(opts?.onImageCopy ?? "").trim();
  if (effectiveCopy.length > 200) effectiveCopy = effectiveCopy.slice(0, 200);

  const intentInstruction = buildSlideIntentInstruction(intent);
  const consistencyHint = buildFullBleedConsistencyHint(mimic, slideIndex);

  return editImageFromReference(config, {
    referenceUrl,
    prompt: mimicPromptForMode("carousel_visual", {
      index: slideIndex,
      layout: visionHints.layout,
      visual: visionHints.visual,
      onImageCopy: effectiveCopy || null,
      consistencyHint,
      intentInstruction,
    }, opts?.promptOverrides),
    size: "1024x1536",
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: `mimic_slide_gen_${slideIndex}`,
    },
  });
}
