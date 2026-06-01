/**
 * Execution draft package for FLOW_TOP_PERFORMER_MIMIC_CAROUSEL only.
 * Distinct from `carousel_package` (FLOW_CAROUSEL): merges LLM copy + upstream visual analysis + render plan.
 */
import type { MimicMode, MimicPayloadV1, MimicReferenceItem, MimicSlidePlan } from "./mimic-payload.js";
import { pickMimicPayload } from "./mimic-payload.js";
import { parseMimicTextBlocks } from "../services/mimic-slide-typography.js";
import { aestheticSlideRecords } from "./mimic-text-heavy.js";

export type MimicCarouselRenderStrategy = "template_background" | "per_slide_mimic";

export interface MimicCarouselSlideColorTokens {
  background: string | null;
  primary_text: string | null;
  accent: string[] | null;
}

export interface MimicCarouselSlideTextBlock {
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  align: string | null;
  font_size_px: number | null;
  font_weight: string | null;
  color_hex: string | null;
}

export interface MimicCarouselSlideTypography {
  headline_guess: string | null;
  body_guess: string | null;
  accent_guess: string | null;
  relative_scale: string | null;
  text_placement: string | null;
  hierarchy: string | null;
  font_size_px_headline: number | null;
  font_size_px_body: number | null;
}

export interface MimicCarouselSlideGuideline {
  slide_index: number;
  layout_template: string | null;
  visual_description: string | null;
  text_density: string | null;
  image_or_photo_role: string | null;
  on_screen_text_transcript: string | null;
  slide_purpose: string | null;
  brand_specificity: string | null;
  color_tokens: MimicCarouselSlideColorTokens | null;
  typography: MimicCarouselSlideTypography | null;
  text_blocks: MimicCarouselSlideTextBlock[] | null;
}

export type TemplateStorageQuality = "reusable" | "job_only" | "reject";

export interface MimicEvaluation {
  recommended_mode: string | null;
  mode_reason: string | null;
  background_replicability: string | null;
  background_description: string | null;
  template_consistency: string | null;
  content_slide_indices: number[];
  skip_slide_indices: number[];
  skip_reason: string | null;
  replication_difficulty: string | null;
  /** Whether backgrounds should be persisted in the project template library for reuse. */
  template_storage_quality: TemplateStorageQuality | null;
  template_storage_reason: string | null;
}

export interface MimicCarouselVisualGuideline {
  format_pattern: string | null;
  format_key: string | null;
  hook_text_preview: string | null;
  deck_as_whole_summary: string | null;
  visual_consistency: string | null;
  deck_visual_system: Record<string, unknown> | null;
  replication_blueprint: Record<string, unknown> | null;
  mimic_evaluation: MimicEvaluation | null;
  evidence_post_url: string | null;
  /** Per-slide layout / visual cues from top-performer deep analysis (no signed URLs). */
  slides: MimicCarouselSlideGuideline[] | null;
  /** 1-based source-deck positions that were video clips (always skipped at mimic render). */
  video_slide_indices?: number[];
}

export interface MimicCarouselVisualReference {
  source_insights_id: string;
  source_evidence_row_id: string | null;
  analysis_tier: string;
  reference_tier_fallback?: boolean;
  storage_bucket: string | null;
  folder_prefix: string | null;
  storage_folder_label: string | null;
  reference_items: MimicReferenceItem[];
}

export interface MimicCarouselRenderPlan {
  mode: MimicMode;
  strategy: MimicCarouselRenderStrategy;
  slide_plans?: MimicSlidePlan[];
  classified_at: string;
}

/** Full mimic carousel draft — copy + visual reference + render plan (not used by FLOW_CAROUSEL). */
export interface MimicCarouselDraftPackage {
  package_type: "mimic_carousel_package";
  copy: Record<string, unknown>;
  render_plan: MimicCarouselRenderPlan;
  visual_reference: MimicCarouselVisualReference;
  visual_guideline: MimicCarouselVisualGuideline;
  twist_brief: MimicPayloadV1["twist_brief"];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function renderStrategyForMode(mode: MimicMode): MimicCarouselRenderStrategy {
  return mode === "template_bg" ? "template_background" : "per_slide_mimic";
}

/** Slim top-performer vision row for the execution package (no signed URLs in guideline slice). */
function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

function slimColorTokens(raw: unknown): MimicCarouselSlideColorTokens | null {
  const ct = asRecord(raw);
  if (!ct) return null;
  const background = String(ct.background ?? "").trim();
  const primary_text = String(ct.primary_text ?? "").trim();
  const accentRaw = Array.isArray(ct.accent) ? ct.accent : [];
  const accent = accentRaw
    .map((v) => String(v ?? "").trim())
    .filter((v) => isHexColor(v));
  if (!isHexColor(background) && !isHexColor(primary_text) && accent.length === 0) {
    return null;
  }
  return {
    background: isHexColor(background) ? background : null,
    primary_text: isHexColor(primary_text) ? primary_text : null,
    accent: accent.length > 0 ? accent : null,
  };
}

function slimTypography(raw: unknown): MimicCarouselSlideTypography | null {
  const t = asRecord(raw);
  if (!t) return null;
  const headline_guess = String(t.headline_guess ?? "").trim() || null;
  const body_guess = String(t.body_guess ?? "").trim() || null;
  const accent_guess = String(t.accent_guess ?? "").trim() || null;
  const relative_scale = String(t.relative_scale ?? "").trim() || null;
  const text_placement = String(t.text_placement ?? "").trim() || null;
  const hierarchy = String(t.hierarchy ?? "").trim() || null;
  const hPx = Number(t.font_size_px_headline ?? t.headline_font_size_px);
  const bPx = Number(t.font_size_px_body ?? t.body_font_size_px);
  const font_size_px_headline =
    Number.isFinite(hPx) && hPx > 0 && hPx < 400 ? Math.round(hPx) : null;
  const font_size_px_body =
    Number.isFinite(bPx) && bPx > 0 && bPx < 400 ? Math.round(bPx) : null;
  if (
    !headline_guess &&
    !body_guess &&
    !relative_scale &&
    !text_placement &&
    !hierarchy &&
    font_size_px_headline == null &&
    font_size_px_body == null
  ) {
    return null;
  }
  return {
    headline_guess,
    body_guess,
    accent_guess,
    relative_scale,
    text_placement,
    hierarchy,
    font_size_px_headline,
    font_size_px_body,
  };
}

function slimTextBlocks(raw: unknown): MimicCarouselSlideTextBlock[] | null {
  const blocks = parseMimicTextBlocks(raw);
  return blocks.length > 0 ? blocks : null;
}

function slimSlideGuidelinesFromEntry(entry: Record<string, unknown>): MimicCarouselSlideGuideline[] {
  const records = aestheticSlideRecords(entry);
  if (records.length === 0) return [];
  return records.map((s, i) => ({
    slide_index: Number(s.slide_index ?? i + 1) || i + 1,
    layout_template: String(s.layout_template ?? "").trim() || null,
    visual_description: String(s.visual_description ?? "").trim() || null,
    text_density: String(s.text_density ?? "").trim() || null,
    image_or_photo_role: String(s.image_or_photo_role ?? "").trim() || null,
    on_screen_text_transcript: String(s.on_screen_text_transcript ?? s.on_image_text ?? "").trim() || null,
    slide_purpose: typeof s.slide_purpose === "string" && s.slide_purpose.trim() ? s.slide_purpose.trim() : null,
    brand_specificity: typeof s.brand_specificity === "string" && s.brand_specificity.trim() ? s.brand_specificity.trim() : null,
    color_tokens: slimColorTokens(s.color_tokens),
    typography: slimTypography(s.typography),
    text_blocks: slimTextBlocks(s.text_blocks),
  }));
}

function slimMimicEvaluation(raw: unknown): MimicEvaluation | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const mode = typeof obj.recommended_mode === "string" ? obj.recommended_mode.trim() : null;
  if (!mode) return null;
  return {
    recommended_mode: mode || null,
    mode_reason: typeof obj.mode_reason === "string" ? obj.mode_reason.trim() : null,
    background_replicability: typeof obj.background_replicability === "string" ? obj.background_replicability.trim() : null,
    background_description: typeof obj.background_description === "string" ? obj.background_description.trim() : null,
    template_consistency: typeof obj.template_consistency === "string" ? obj.template_consistency.trim() : null,
    content_slide_indices: Array.isArray(obj.content_slide_indices) ? obj.content_slide_indices.filter((v: unknown) => typeof v === "number") : [],
    skip_slide_indices: Array.isArray(obj.skip_slide_indices) ? obj.skip_slide_indices.filter((v: unknown) => typeof v === "number") : [],
    skip_reason: typeof obj.skip_reason === "string" ? obj.skip_reason.trim() : null,
    replication_difficulty: typeof obj.replication_difficulty === "string" ? obj.replication_difficulty.trim() : null,
    template_storage_quality:
      obj.template_storage_quality === "reusable" ||
      obj.template_storage_quality === "job_only" ||
      obj.template_storage_quality === "reject"
        ? obj.template_storage_quality
        : null,
    template_storage_reason:
      typeof obj.template_storage_reason === "string" ? obj.template_storage_reason.trim() : null,
  };
}

function videoSlideIndicesFromEntry(entry: Record<string, unknown>): number[] {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const raw = aes.video_slide_indices ?? entry.video_slide_indices;
  const stored = asRecord(entry.stored_inspection_media_json)?.video_slide_indices;
  const fromStored = Array.isArray(stored) ? stored : null;
  const src = fromStored ?? raw;
  if (!Array.isArray(src)) return [];
  return src
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

const LLM_COPY_SLIDE_TEXT_MAX_CHARS = 420;
const LLM_COPY_VISUAL_DESC_MAX_CHARS = 720;
const LLM_COPY_TEXT_BLOCK_CAP = 12;

function truncateSlideTextForLlm(value: string | null, maxChars: number): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

/** Per-slide layout contract for copy LLM — what text exists, how the slide looks, where text sits. */
export interface MimicSlideCopyLayoutForLlm {
  slide_index: number;
  /** Archived reference wording (for structure/length only — output must be fresh). */
  reference_on_screen_text: string | null;
  visual_description: string | null;
  layout_template: string | null;
  image_or_photo_role: string | null;
  text_density: string | null;
  slide_purpose: string | null;
  graphic_elements: string | null;
  color_tokens: MimicCarouselSlideColorTokens | null;
  typography: MimicCarouselSlideTypography | null;
  /** Normalized 0–1 boxes + font hints from Nemotron vision. */
  text_blocks: MimicCarouselSlideTextBlock[] | null;
}

function slimTextBlocksForLlmCopy(raw: unknown): MimicCarouselSlideTextBlock[] | null {
  const blocks = parseMimicTextBlocks(raw);
  if (blocks.length === 0) return null;
  return blocks.slice(0, LLM_COPY_TEXT_BLOCK_CAP).map((b) => ({
    ...b,
    text: b.text.length > 280 ? `${b.text.slice(0, 280)}…` : b.text,
  }));
}

function stringFieldForLlm(v: unknown, max: number): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Explicit per-slide layout for mimic copy generation (text + look + placement).
 * Built from full `aesthetic_analysis_json` when available (DB insight row or enriched entry).
 */
export function buildMimicSlideCopyLayoutFromEntry(
  entry: Record<string, unknown>
): MimicSlideCopyLayoutForLlm[] {
  const slides = aestheticSlideRecords(entry);
  if (slides.length === 0) return [];
  return slides.map((s, i) => {
    const slide_index = Number(s.slide_index ?? i + 1) || i + 1;
    return {
      slide_index,
      reference_on_screen_text: stringFieldForLlm(
        s.on_screen_text_transcript ?? s.on_image_text,
        LLM_COPY_SLIDE_TEXT_MAX_CHARS
      ),
      visual_description: stringFieldForLlm(s.visual_description, LLM_COPY_VISUAL_DESC_MAX_CHARS),
      layout_template: stringFieldForLlm(s.layout_template, 120),
      image_or_photo_role: stringFieldForLlm(s.image_or_photo_role, 80),
      text_density: stringFieldForLlm(s.text_density, 40),
      slide_purpose: stringFieldForLlm(s.slide_purpose, 40),
      graphic_elements: stringFieldForLlm(s.graphic_elements, 320),
      color_tokens: slimColorTokens(s.color_tokens),
      typography: slimTypography(s.typography),
      text_blocks: slimTextBlocksForLlmCopy(s.text_blocks),
    };
  });
}

/** Visual guideline for mimic carousel copy prompts — no URLs, capped slide text. */
export function slimMimicVisualGuidelineForLlmCopy(entry: Record<string, unknown>): MimicCarouselVisualGuideline {
  const base = slimVisualGuidelineFromEntry(entry);
  return {
    ...base,
    replication_blueprint: null,
    slides:
      base.slides?.map((s) => ({
        ...s,
        visual_description: truncateSlideTextForLlm(s.visual_description, LLM_COPY_VISUAL_DESC_MAX_CHARS),
        on_screen_text_transcript: truncateSlideTextForLlm(
          s.on_screen_text_transcript,
          LLM_COPY_SLIDE_TEXT_MAX_CHARS
        ),
      })) ?? null,
  };
}

export function slimVisualGuidelineFromEntry(entry: Record<string, unknown>): MimicCarouselVisualGuideline {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const slides = slimSlideGuidelinesFromEntry(entry);
  const video_slide_indices = videoSlideIndicesFromEntry(entry);
  return {
    format_pattern: String(aes.format_pattern ?? entry.format_pattern ?? "").trim() || null,
    format_key: String(entry.format_key ?? "").trim() || null,
    hook_text_preview: String(entry.hook_text_preview ?? "").trim() || null,
    deck_as_whole_summary: String(entry.deck_as_whole_summary ?? "").trim() || null,
    visual_consistency: String(entry.visual_consistency ?? "").trim() || null,
    deck_visual_system: asRecord(entry.deck_visual_system),
    replication_blueprint: asRecord(entry.replication_blueprint),
    mimic_evaluation: slimMimicEvaluation(aes.mimic_evaluation ?? entry.mimic_evaluation),
    evidence_post_url: String(entry.evidence_post_url ?? "").trim() || null,
    slides: slides.length > 0 ? slides : null,
    ...(video_slide_indices.length > 0 ? { video_slide_indices } : {}),
  };
}

export function buildVisualReferenceFromMimic(
  mimic: MimicPayloadV1,
  opts?: { reference_tier_fallback?: boolean }
): MimicCarouselVisualReference {
  const first = mimic.reference_items[0];
  return {
    source_insights_id: mimic.source_insights_id,
    source_evidence_row_id: mimic.source_evidence_row_id ?? null,
    analysis_tier: mimic.analysis_tier,
    reference_tier_fallback: opts?.reference_tier_fallback ?? mimic.reference_tier_fallback ?? false,
    storage_bucket: first?.bucket ?? null,
    folder_prefix: mimic.storage_folder_prefix ?? null,
    storage_folder_label: mimic.storage_folder_label ?? null,
    reference_items: mimic.reference_items,
  };
}

/** Pick LLM copy fields from generated_output / draft snapshot (excludes package_type). */
export function extractMimicCarouselCopyLayer(gp: Record<string, unknown>): Record<string, unknown> {
  const snap = asRecord(gp.draft_package_snapshot);
  if (snap?.package_type === "mimic_carousel_package") {
    const nested = asRecord(snap.copy);
    if (nested) return { ...nested };
  }
  const src = asRecord(gp.generated_output) ?? snap ?? gp;
  const copy: Record<string, unknown> = {};
  for (const k of [
    "caption",
    "primary_copy",
    "hook_text",
    "hook",
    "hashtags",
    "cta",
    "cta_text",
    "carousel",
    "slides",
    "cover",
    "cta_slide",
  ] as const) {
    if (src[k] != null) copy[k] = src[k];
  }
  return copy;
}

export function composeMimicCarouselDraftPackage(
  generationPayload: Record<string, unknown>,
  mimic: MimicPayloadV1,
  opts?: { reference_tier_fallback?: boolean; visual_guideline?: MimicCarouselVisualGuideline | null }
): MimicCarouselDraftPackage {
  const visual_guideline =
    opts?.visual_guideline ??
    (mimic.visual_guideline as MimicCarouselVisualGuideline | undefined) ??
    ({
      format_pattern: null,
      format_key: null,
      hook_text_preview: null,
      deck_as_whole_summary: null,
      visual_consistency: null,
      deck_visual_system: null,
      replication_blueprint: null,
      mimic_evaluation: null,
      evidence_post_url: null,
      slides: null,
    } satisfies MimicCarouselVisualGuideline);

  return {
    package_type: "mimic_carousel_package",
    copy: extractMimicCarouselCopyLayer(generationPayload),
    render_plan: {
      mode: mimic.mode,
      strategy: renderStrategyForMode(mimic.mode),
      slide_plans: mimic.slide_plans,
      classified_at: mimic.classified_at,
    },
    visual_reference: buildVisualReferenceFromMimic(mimic, opts),
    visual_guideline,
    twist_brief: mimic.twist_brief,
  };
}

export function pickMimicCarouselDraftPackage(payload: unknown): MimicCarouselDraftPackage | null {
  const gp = asRecord(payload);
  if (!gp) return null;
  const snap = asRecord(gp.draft_package_snapshot);
  if (snap?.package_type === "mimic_carousel_package") {
    return snap as unknown as MimicCarouselDraftPackage;
  }
  const mimic = pickMimicPayload(gp);
  if (!mimic || mimic.mode === "image_full") return null;
  return composeMimicCarouselDraftPackage(gp, mimic);
}
