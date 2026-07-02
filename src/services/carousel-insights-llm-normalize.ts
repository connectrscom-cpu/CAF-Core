/**
 * Normalize carousel top-performer LLM JSON (esp. Nemotron) into the flat schema CAF persists.
 */
import { isSlideIntelligenceVisualDescriptionSufficient, isSlideIntelligenceWhyItWorksSufficient } from "../domain/mimic-slide-analysis-quality.js";

const WRAPPER_KEYS = ["deck", "carousel", "analysis", "result", "response", "output", "data"] as const;

const ROOT_STRING_FIELDS = [
  "slide_arc",
  "cover_vs_body",
  "visual_consistency",
  "on_screen_text_summary",
  "cta_clarity",
  "format_pattern",
  "why_it_worked",
  "deck_as_whole_summary",
  "primary_emotion",
  "secondary_emotion",
  "caption_style",
] as const;

const DECK_VISUAL_SYSTEM_KEYS = new Set([
  "overall_aesthetic",
  "canvas_aspect",
  "safe_margins_gutters",
  "repeated_template",
  "motion_or_energy",
  "emoji_or_sticker_usage",
]);

const REPLICATION_BLUEPRINT_KEYS = new Set([
  "steps_to_remake",
  "asset_sources",
  "tooling_notes",
  "legal_ethics",
]);

const COMPOSITION_BLUEPRINT_KEYS = new Set([
  "canvas_description",
  "layout_structure",
  "visual_hierarchy",
  "elements",
  "text_blocks",
  "background",
  "spacing_notes",
  "qwen_prompt_notes",
]);

const COMPOSITION_ELEMENT_KEYS = new Set([
  "element_id",
  "element_type",
  "description",
  "bbox_pct",
  "anchor",
  "layer_order",
  "prominence",
  "style_notes",
  "position_confidence",
]);

const COMPOSITION_TEXT_BLOCK_KEYS = new Set([
  "role",
  "text",
  "bbox_pct",
  "alignment",
  "typography_notes",
  "position_confidence",
]);

const VALID_COMPOSITION_PROMINENCE = new Set(["primary", "secondary", "tertiary", "background"]);
const VALID_COMPOSITION_TEXT_ALIGN = new Set(["left", "center", "right"]);
const VALID_COMPOSITION_CONFIDENCE = new Set(["low", "medium", "high"]);

/** Known Nemotron training-data bleed — not valid per-slide OCR. */
const SLIDE_HALLUCINATION_MARKERS: RegExp[] = [
  /@FashionNova/i,
  /\bFashion Nova\b/i,
  /\bmlm_data\b/i,
  /\bclassifier_input\b/i,
  /\bpackaging_score\b/i,
  /\bproduct gallery\b/i,
  /Want a closer look at my @/i,
];

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeTextDensity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "low" || s === "medium" || s === "high") return s;
  if (/\bhigh\b|7\d%|8\d%|9\d%/.test(s)) return "high";
  if (/\bmedium\b|4\d%|5\d%|6\d%/.test(s)) return "medium";
  if (/\blow\b|1\d%|2\d%|3\d%/.test(s)) return "low";
  return null;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(100, n));
}

function normalizeBboxPct(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map((v) => clampPct(Number(v)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function normalizeCompositionElements(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!COMPOSITION_ELEMENT_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    const id = String(cleaned.element_id ?? "").trim();
    const type = String(cleaned.element_type ?? "").trim();
    const desc = String(cleaned.description ?? "").trim();
    if (!id || !type || !desc) continue;
    cleaned.element_id = id.slice(0, 80);
    cleaned.element_type = type.slice(0, 40);
    cleaned.description = desc.slice(0, 400);

    const bbox = normalizeBboxPct(cleaned.bbox_pct);
    if (bbox) cleaned.bbox_pct = bbox;
    else delete cleaned.bbox_pct;

    const anchor = String(cleaned.anchor ?? "").trim();
    if (anchor) cleaned.anchor = anchor.slice(0, 24);
    else delete cleaned.anchor;

    const layer = Number(cleaned.layer_order);
    if (Number.isFinite(layer)) cleaned.layer_order = Math.max(0, Math.min(100, Math.round(layer)));
    else delete cleaned.layer_order;

    const prom = String(cleaned.prominence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_PROMINENCE.has(prom)) cleaned.prominence = prom;
    else if (prom) cleaned.prominence = "secondary";
    else delete cleaned.prominence;

    const style = String(cleaned.style_notes ?? "").trim();
    if (style) cleaned.style_notes = style.slice(0, 500);
    else delete cleaned.style_notes;

    const conf = String(cleaned.position_confidence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_CONFIDENCE.has(conf)) cleaned.position_confidence = conf;
    else delete cleaned.position_confidence;

    out.push(cleaned);
    if (out.length >= 24) break;
  }
  return out;
}

function normalizeCompositionTextBlocks(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!COMPOSITION_TEXT_BLOCK_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    const role = String(cleaned.role ?? "").trim();
    const text = String(cleaned.text ?? "").trim();
    if (!role || !text) continue;
    cleaned.role = role.slice(0, 24);
    cleaned.text = text.slice(0, 220);

    const bbox = normalizeBboxPct(cleaned.bbox_pct);
    if (bbox) cleaned.bbox_pct = bbox;
    else delete cleaned.bbox_pct;

    const align = String(cleaned.alignment ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_TEXT_ALIGN.has(align)) cleaned.alignment = align;
    else delete cleaned.alignment;

    const typo = String(cleaned.typography_notes ?? "").trim();
    if (typo) cleaned.typography_notes = typo.slice(0, 320);
    else delete cleaned.typography_notes;

    const conf = String(cleaned.position_confidence ?? "").trim().toLowerCase();
    if (VALID_COMPOSITION_CONFIDENCE.has(conf)) cleaned.position_confidence = conf;
    else delete cleaned.position_confidence;

    out.push(cleaned);
    if (out.length >= 24) break;
  }
  return out;
}

function sanitizeCompositionBlueprint(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!COMPOSITION_BLUEPRINT_KEYS.has(k)) continue;
    out[k] = v;
  }
  for (const key of ["canvas_description", "layout_structure", "visual_hierarchy", "background", "spacing_notes", "qwen_prompt_notes"] as const) {
    if (out[key] == null) continue;
    const s = String(out[key] ?? "").trim();
    if (!s) delete out[key];
    else out[key] = s.slice(0, key === "qwen_prompt_notes" ? 900 : 500);
  }
  const elems = normalizeCompositionElements(out.elements);
  if (elems.length > 0) out.elements = elems;
  else delete out.elements;
  const tbs = normalizeCompositionTextBlocks(out.text_blocks);
  if (tbs.length > 0) out.text_blocks = tbs;
  else delete out.text_blocks;
  return Object.keys(out).length > 0 ? out : null;
}

const VALID_SLIDE_PURPOSE = new Set([
  "hook", "content", "listicle_item", "storytelling", "cta",
  "self_promo", "product_pitch", "testimonial", "filler",
]);

const VALID_BRAND_SPECIFICITY = new Set(["none", "low", "high"]);

function normalizeSlidePurpose(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (VALID_SLIDE_PURPOSE.has(s)) return s;
  if (s.includes("promo") || s.includes("self_")) return "self_promo";
  if (s.includes("product") || s.includes("pitch") || s.includes("sell")) return "product_pitch";
  if (s.includes("hook") || s.includes("cover")) return "hook";
  if (s.includes("cta") || s.includes("call_to_action")) return "cta";
  if (s.includes("list") || s.includes("item")) return "listicle_item";
  if (s.includes("story") || s.includes("narrative")) return "storytelling";
  if (s.includes("testimonial") || s.includes("quote") || s.includes("review")) return "testimonial";
  if (s.includes("filler") || s.includes("spacer") || s.includes("transition")) return "filler";
  return "content";
}

function normalizeBrandSpecificity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (VALID_BRAND_SPECIFICITY.has(s)) return s;
  if (/\bhigh\b/.test(s)) return "high";
  if (/\blow\b/.test(s)) return "low";
  if (/\bnone\b|\bgeneric\b|\bn\/a\b/.test(s)) return "none";
  return null;
}

function slideQualityScore(slide: Record<string, unknown>): number {
  const transcript = slideTranscriptText(slide);
  const visual = pickString(slide, "visual_description") ?? "";
  let score = transcript.length * 2 + visual.length;
  if (isWeakCarouselSlide(slide)) score -= 10_000;
  return score;
}

export function slideTranscriptText(slide: Record<string, unknown>): string {
  return pickString(slide, "on_screen_text_transcript", "on_screen_text", "text_transcript", "ocr_text") ?? "";
}

function normalizedTranscriptBody(transcript: string): string {
  return transcript
    .replace(/\[illegible\]/gi, "")
    .replace(/&#160;|&nbsp;|\u00a0/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHashtagOnlyCaptionBleed(transcript: string): boolean {
  const t = transcript.trim();
  if (!t || !/#/u.test(t)) return false;
  const withoutTags = t.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, "").trim();
  return withoutTags.length === 0;
}

/** Slide OCR/visual is empty, placeholder-only, or known model hallucination. */
export function isWeakCarouselSlide(slide: Record<string, unknown>): boolean {
  const transcript = slideTranscriptText(slide);
  const visual = pickString(slide, "visual_description") ?? "";
  const body = normalizedTranscriptBody(transcript);

  if (!body && !visual.trim()) return true;
  if (!body && visual.length < 24) return true;
  if (isHashtagOnlyCaptionBleed(transcript)) return true;

  for (const re of SLIDE_HALLUCINATION_MARKERS) {
    if (re.test(transcript) || re.test(visual)) return true;
  }
  return false;
}

function normalizeSlideRecord(raw: unknown, fallbackIndex: number): Record<string, unknown> | null {
  const s = asRecord(raw);
  if (!s) return null;
  const slideIndex = Number(s.slide_index);
  const out: Record<string, unknown> = { ...s };
  out.slide_index = Number.isFinite(slideIndex) && slideIndex > 0 ? slideIndex : fallbackIndex;

  const density = normalizeTextDensity(s.text_density);
  if (density) out.text_density = density;

  if (!out.on_screen_text_transcript) {
    const alt = pickString(s, "on_screen_text", "text_transcript", "ocr_text", "visible_text");
    if (alt) out.on_screen_text_transcript = alt;
  }

  const purpose = normalizeSlidePurpose(s.slide_purpose ?? s.purpose ?? s.slide_type ?? s.slide_role);
  if (purpose) out.slide_purpose = purpose;

  const slideWhy = pickString(
    s,
    "why_it_works",
    "why_it_worked",
    "why_this_slide_works",
    "slide_why",
    "performance_reason"
  );
  if (slideWhy && isSlideIntelligenceWhyItWorksSufficient(slideWhy)) {
    out.why_it_works = slideWhy.length > 900 ? `${slideWhy.slice(0, 900)}…` : slideWhy;
  } else {
    delete out.why_it_works;
  }

  const visualRaw = pickString(s, "visual_description", "image_description", "scene_description");
  if (visualRaw && isSlideIntelligenceVisualDescriptionSufficient(visualRaw)) {
    out.visual_description = visualRaw.length > 900 ? `${visualRaw.slice(0, 900)}…` : visualRaw;
  } else {
    const existingVisual = pickString(out, "visual_description");
    if (existingVisual && !isSlideIntelligenceVisualDescriptionSufficient(existingVisual)) {
      delete out.visual_description;
    }
  }

  const brandSpec = normalizeBrandSpecificity(s.brand_specificity ?? s.brand_specific ?? s.brand_tied);
  if (brandSpec) out.brand_specificity = brandSpec;

  const textBlocks = normalizeSlideTextBlocks(s.text_blocks);
  if (textBlocks.length > 0) out.text_blocks = textBlocks;

  const typo = asRecord(s.typography);
  if (typo) {
    const enriched = { ...typo };
    const hPx = Number(typo.font_size_px_headline ?? typo.headline_font_size_px);
    const bPx = Number(typo.font_size_px_body ?? typo.body_font_size_px);
    if (Number.isFinite(hPx) && hPx > 0) enriched.font_size_px_headline = Math.round(hPx);
    if (Number.isFinite(bPx) && bPx > 0) enriched.font_size_px_body = Math.round(bPx);
    out.typography = enriched;
  }

  if (s.composition_blueprint != null) {
    const cleaned = sanitizeCompositionBlueprint(s.composition_blueprint);
    if (cleaned) out.composition_blueprint = cleaned;
    else delete out.composition_blueprint;
  }

  return out;
}

function normalizeSlideTextBlocks(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = String(rec.text ?? rec.content ?? "").trim();
    if (!text) continue;
    const block: Record<string, unknown> = { text };
    const role = String(rec.role ?? rec.semantic_role ?? "").trim();
    if (role) block.role = role;
    const align = String(rec.align ?? rec.alignment ?? rec.text_align ?? "").trim();
    if (align) block.align = align;
    const bboxNorm = asRecord(rec.bbox_norm);
    if (bboxNorm) {
      block.bbox_norm = bboxNorm;
    } else if (Array.isArray(rec.bbox) && rec.bbox.length >= 4) {
      block.bbox = rec.bbox;
    }
    const fontPx = Number(rec.font_size_px ?? rec.estimated_font_size_px);
    if (Number.isFinite(fontPx) && fontPx > 0) block.font_size_px = Math.round(fontPx);
    const weight = String(rec.font_weight ?? rec.weight ?? "").trim();
    if (weight) block.font_weight = weight;
    const color = String(rec.color_hex ?? rec.color ?? "").trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(color)) block.color_hex = color;
    out.push(block);
  }
  return out;
}

function collectSlides(root: Record<string, unknown>): unknown[] {
  const direct = root.slides ?? root.carousel_slides ?? root.slide_analysis;
  if (Array.isArray(direct)) return direct;

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    const nested = inner.slides ?? inner.carousel_slides;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function unwrapRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  let root: Record<string, unknown> = { ...parsed };

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    const merged: Record<string, unknown> = { ...root, ...inner };
    delete merged[wrap];
    root = merged;
  }

  return root;
}

function applyAliases(root: Record<string, unknown>): void {
  if (!pickString(root, "format_pattern")) {
    const hook = pickString(root, "hook_type", "format", "content_format");
    if (hook) root.format_pattern = hook;
  }
  if (!pickString(root, "cta_clarity")) {
    const cta = pickString(root, "cta_type", "call_to_action", "cta");
    if (cta) root.cta_clarity = cta;
  }
  if (!pickString(root, "why_it_worked")) {
    const why = pickString(root, "performance_reason", "why_it_performed", "summary");
    if (why) root.why_it_worked = why;
  }
  if (!pickString(root, "slide_arc")) {
    const arc = pickString(root, "narrative_arc", "story_arc", "hook");
    if (arc) root.slide_arc = arc;
  }
  if (!pickString(root, "on_screen_text_summary")) {
    const t = pickString(root, "text_summary", "headline_summary");
    if (t) root.on_screen_text_summary = t;
  }
}

function sanitizeDeckVisualSystem(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (DECK_VISUAL_SYSTEM_KEYS.has(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeReplicationBlueprint(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REPLICATION_BLUEPRINT_KEYS.has(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const VALID_MIMIC_RECOMMENDED_MODE = new Set(["full_bleed_visual", "text_on_template", "not_suitable"]);
const VALID_MIMIC_BG_REPLICABILITY = new Set(["high", "medium", "low"]);
const VALID_MIMIC_TEMPLATE_CONSISTENCY = new Set(["uniform", "varied", "mixed"]);
const VALID_MIMIC_DIFFICULTY = new Set(["easy", "moderate", "hard"]);
const VALID_TEMPLATE_STORAGE_QUALITY = new Set(["reusable", "job_only", "reject"]);

export function normalizeMimicEvaluation(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const mode = String(obj.recommended_mode ?? obj.mode ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const out: Record<string, unknown> = {};

  out.recommended_mode = VALID_MIMIC_RECOMMENDED_MODE.has(mode) ? mode : null;
  out.mode_reason = typeof obj.mode_reason === "string" ? obj.mode_reason.trim().slice(0, 500) : null;

  const bgr = String(obj.background_replicability ?? "").trim().toLowerCase();
  out.background_replicability = VALID_MIMIC_BG_REPLICABILITY.has(bgr) ? bgr : null;
  out.background_description = typeof obj.background_description === "string" ? obj.background_description.trim().slice(0, 400) : null;

  const tc = String(obj.template_consistency ?? "").trim().toLowerCase();
  out.template_consistency = VALID_MIMIC_TEMPLATE_CONSISTENCY.has(tc) ? tc : null;

  out.content_slide_indices = Array.isArray(obj.content_slide_indices)
    ? obj.content_slide_indices.filter((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 1).map(Number)
    : [];
  out.skip_slide_indices = Array.isArray(obj.skip_slide_indices)
    ? obj.skip_slide_indices.filter((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 1).map(Number)
    : [];
  out.skip_reason = typeof obj.skip_reason === "string" ? obj.skip_reason.trim().slice(0, 400) : null;

  const diff = String(obj.replication_difficulty ?? "").trim().toLowerCase();
  out.replication_difficulty = VALID_MIMIC_DIFFICULTY.has(diff) ? diff : null;

  const tsq = String(obj.template_storage_quality ?? obj.library_quality ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  out.template_storage_quality = VALID_TEMPLATE_STORAGE_QUALITY.has(tsq) ? tsq : null;
  out.template_storage_reason =
    typeof obj.template_storage_reason === "string" ? obj.template_storage_reason.trim().slice(0, 500) : null;

  if (!out.recommended_mode && !out.background_replicability && !out.template_storage_quality) return null;
  return out;
}

function stripGarbageFromCarouselRoot(root: Record<string, unknown>): void {
  if (root.deck_visual_system != null) {
    const cleaned = sanitizeDeckVisualSystem(root.deck_visual_system);
    if (cleaned) root.deck_visual_system = cleaned;
    else delete root.deck_visual_system;
  }
  if (root.replication_blueprint != null) {
    const cleaned = sanitizeReplicationBlueprint(root.replication_blueprint);
    if (cleaned) root.replication_blueprint = cleaned;
    else delete root.replication_blueprint;
  }
  if (root.mimic_evaluation != null) {
    const cleaned = normalizeMimicEvaluation(root.mimic_evaluation);
    if (cleaned) root.mimic_evaluation = cleaned;
    else delete root.mimic_evaluation;
  }
  delete root.mlm_data;
  delete root.classifier_input;
  if (root.deck_composition_system != null) {
    const sys = asRecord(root.deck_composition_system);
    if (!sys) {
      delete root.deck_composition_system;
    } else {
      const out: Record<string, unknown> = {};
      const recurring = pickString(sys, "recurring_layout_pattern");
      if (recurring) out.recurring_layout_pattern = recurring.slice(0, 700);
      const safe = pickString(sys, "safe_margin_pattern");
      if (safe) out.safe_margin_pattern = safe.slice(0, 500);
      const hier = pickString(sys, "visual_hierarchy_pattern");
      if (hier) out.visual_hierarchy_pattern = hier.slice(0, 500);
      const rep = sys.repeated_element_positions;
      if (Array.isArray(rep)) {
        const items = rep.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
        if (items.length > 0) out.repeated_element_positions = items;
      }
      if (Object.keys(out).length > 0) root.deck_composition_system = out;
      else delete root.deck_composition_system;
    }
  }
}

/** Drop out-of-range slides and dedupe by slide_index (keep richer OCR). */
export function sanitizeCarouselSlides(
  slides: unknown,
  deckSlideCount: number
): Record<string, unknown>[] {
  if (!Array.isArray(slides) || deckSlideCount < 1) return [];

  const byIndex = new Map<number, Record<string, unknown>>();
  for (const raw of slides) {
    const slide = normalizeSlideRecord(raw, 0);
    if (!slide) continue;
    const idx = Number(slide.slide_index);
    if (!Number.isFinite(idx) || idx < 1 || idx > deckSlideCount) continue;

    const prev = byIndex.get(idx);
    if (!prev || slideQualityScore(slide) >= slideQualityScore(prev)) {
      byIndex.set(idx, slide);
    }
  }

  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slide]) => slide);
}

/** Slide indices in 1..deckSlideCount missing from the parsed slides array. */
export function findMissingCarouselSlideIndices(slides: unknown, deckSlideCount: number): number[] {
  if (deckSlideCount < 1) return [];
  const present = new Set<number>();
  if (Array.isArray(slides)) {
    for (const raw of slides) {
      const idx = Number(asRecord(raw)?.slide_index);
      if (Number.isFinite(idx) && idx >= 1 && idx <= deckSlideCount) present.add(idx);
    }
  }
  const missing: number[] = [];
  for (let i = 1; i <= deckSlideCount; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/** Slides present but with empty OCR or known hallucination patterns. */
export function findWeakCarouselSlideIndices(slides: unknown, deckSlideCount: number): number[] {
  if (!Array.isArray(slides) || deckSlideCount < 1) return [];

  const byIndex = new Map<number, Record<string, unknown>>();
  for (const raw of slides) {
    const slide = asRecord(raw);
    if (!slide) continue;
    const idx = Number(slide.slide_index);
    if (!Number.isFinite(idx) || idx < 1 || idx > deckSlideCount) continue;
    byIndex.set(idx, slide);
  }

  const weak: number[] = [];
  for (let i = 1; i <= deckSlideCount; i++) {
    const slide = byIndex.get(i);
    if (!slide || isWeakCarouselSlide(slide)) weak.push(i);
  }
  return weak;
}

/** Missing indices plus weak/hallucinated slides — candidates for targeted retry. */
export function findCarouselSlidesNeedingRetry(slides: unknown, deckSlideCount: number): number[] {
  const missing = findMissingCarouselSlideIndices(slides, deckSlideCount);
  const weak = findWeakCarouselSlideIndices(slides, deckSlideCount);
  return [...new Set([...missing, ...weak])].sort((a, b) => a - b);
}

/**
 * Nemotron often returns slide_index 1..k for each chunk. Remap by attachment order to global indices.
 */
export function remapChunkSlideIndices(
  parsed: Record<string, unknown> | null | undefined,
  globalStart: number,
  attachmentCount: number
): Record<string, unknown> | null {
  if (!parsed || attachmentCount < 1 || globalStart < 1) return parsed ?? null;
  const slidesRaw = Array.isArray(parsed.slides) ? parsed.slides : [];
  if (slidesRaw.length === 0) return parsed;

  const normalized = slidesRaw
    .map((raw, i) => normalizeSlideRecord(raw, globalStart + i))
    .filter((s): s is Record<string, unknown> => s != null);

  if (normalized.length === 0) return parsed;

  const indices = normalized.map((s) => Number(s.slide_index));
  const expectedEnd = globalStart + attachmentCount - 1;
  const alreadyGlobal =
    normalized.length === attachmentCount &&
    indices.every((idx, i) => idx === globalStart + i);
  if (alreadyGlobal) return { ...parsed, slides: normalized };

  const allLocalOneBased =
    normalized.length === attachmentCount && indices.every((idx) => idx >= 1 && idx <= attachmentCount);

  const remapped = normalized.map((slide, i) => ({
    ...slide,
    slide_index: globalStart + i,
  }));

  if (allLocalOneBased || normalized.length === attachmentCount) {
    return { ...parsed, slides: remapped };
  }

  const inGlobalRange = indices.every((idx) => idx >= globalStart && idx <= expectedEnd);
  if (inGlobalRange) return { ...parsed, slides: normalized };

  return { ...parsed, slides: remapped.slice(0, attachmentCount) };
}

/** Flatten Nemotron / alternate LLM shapes into canonical carousel insight JSON. */
export function normalizeCarouselInsightsLlmJson(
  parsed: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!parsed) return null;

  const root = unwrapRoot(parsed);
  applyAliases(root);

  const slidesRaw = collectSlides(root);
  if (slidesRaw.length > 0) {
    root.slides = slidesRaw
      .map((raw, i) => normalizeSlideRecord(raw, i + 1))
      .filter((s): s is Record<string, unknown> => s != null);
  }

  if (!Array.isArray(root.risk_flags)) {
    const risks = root.risk_flags ?? root.risks;
    root.risk_flags = Array.isArray(risks) ? risks : [];
  }

  for (const key of ROOT_STRING_FIELDS) {
    const v = root[key];
    if (v != null && typeof v !== "string") {
      root[key] = String(v);
    }
  }

  stripGarbageFromCarouselRoot(root);
  return root;
}

/** Apply slide sanitization after merge / retry. */
export function finalizeCarouselInsightJson(
  insight: Record<string, unknown> | null | undefined,
  deckSlideCount: number
): Record<string, unknown> | null {
  const normalized = normalizeCarouselInsightsLlmJson(insight);
  if (!normalized) return null;
  if (deckSlideCount > 0) {
    normalized.slides = sanitizeCarouselSlides(normalized.slides, deckSlideCount);
  }
  return normalized;
}

/** Merge chunked Nemotron calls (deck summary + slide batches) into one insight object. */
export function mergeCarouselInsightChunks(
  chunks: Array<Record<string, unknown> | null>,
  deckSlideCount?: number
): Record<string, unknown> {
  const normalized = chunks
    .map((c) => normalizeCarouselInsightsLlmJson(c))
    .filter((c): c is Record<string, unknown> => c != null);

  if (normalized.length === 0) return {};

  const merged: Record<string, unknown> = {};
  const slides: Record<string, unknown>[] = [];

  for (const part of normalized) {
    for (const key of ROOT_STRING_FIELDS) {
      if (!pickString(merged, key) && pickString(part, key)) {
        merged[key] = part[key];
      }
    }
    if (merged.risk_flags == null && Array.isArray(part.risk_flags) && part.risk_flags.length > 0) {
      merged.risk_flags = part.risk_flags;
    }
    if (merged.deck_as_whole_summary == null && part.deck_as_whole_summary != null) {
      merged.deck_as_whole_summary = part.deck_as_whole_summary;
    }
    if (merged.deck_visual_system == null && part.deck_visual_system != null) {
      merged.deck_visual_system = part.deck_visual_system;
    }
    if (merged.replication_blueprint == null && part.replication_blueprint != null) {
      merged.replication_blueprint = part.replication_blueprint;
    }
    if (merged.mimic_evaluation == null && part.mimic_evaluation != null) {
      merged.mimic_evaluation = part.mimic_evaluation;
    }

    const partSlides = Array.isArray(part.slides) ? part.slides : [];
    for (const raw of partSlides) {
      const slide = normalizeSlideRecord(raw, slides.length + 1);
      if (slide) slides.push(slide);
    }
  }

  if (slides.length > 0) {
    merged.slides = slides;
  }
  if (merged.risk_flags == null) merged.risk_flags = [];

  const out = normalizeCarouselInsightsLlmJson(merged) ?? merged;
  if (deckSlideCount != null && deckSlideCount > 0) {
    out.slides = sanitizeCarouselSlides(out.slides, deckSlideCount);
  }
  return out;
}

/** Persisted `aesthetic_analysis_json` slice for top_performer_carousel insights. */
export function buildCarouselAestheticAnalysisJson(
  parsed: Record<string, unknown> | null
): Record<string, unknown> {
  if (!parsed) return {};
  const out: Record<string, unknown> = {
    slide_arc: parsed.slide_arc,
    cover_vs_body: parsed.cover_vs_body,
    visual_consistency: parsed.visual_consistency,
    on_screen_text_summary: parsed.on_screen_text_summary,
    cta_clarity: parsed.cta_clarity,
    format_pattern: parsed.format_pattern,
    primary_emotion: parsed.primary_emotion,
    secondary_emotion: parsed.secondary_emotion,
    caption_style: parsed.caption_style,
  };
  if (Array.isArray(parsed.slides)) out.slides = parsed.slides;
  if (parsed.deck_as_whole_summary != null) out.deck_as_whole_summary = parsed.deck_as_whole_summary;
  if (parsed.deck_visual_system != null) out.deck_visual_system = parsed.deck_visual_system;
  if (parsed.deck_composition_system != null) out.deck_composition_system = parsed.deck_composition_system;
  if (parsed.replication_blueprint != null) out.replication_blueprint = parsed.replication_blueprint;
  if (parsed.mimic_evaluation != null) out.mimic_evaluation = parsed.mimic_evaluation;
  if (parsed._slide_coverage != null) out._slide_coverage = parsed._slide_coverage;
  if (parsed.document_ai_deck_v1 != null) out.document_ai_deck_v1 = parsed.document_ai_deck_v1;
  return out;
}

export const TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX = `

NVIDIA / Nemotron — strict output contract:
- Return ONE flat JSON object at the root. Never nest the payload under "deck", "carousel", "analysis", "result", or "output".
- Never put slides[], mlm_data, or classifier blobs inside deck_visual_system or replication_blueprint.
- Required root strings: slide_arc, cover_vs_body, visual_consistency, on_screen_text_summary, cta_clarity, format_pattern, why_it_worked, primary_emotion, secondary_emotion, caption_style
- Required root objects: mimic_evaluation (with recommended_mode, mode_reason, background_replicability, background_description, template_consistency, content_slide_indices, skip_slide_indices, skip_reason, replication_difficulty)
- mimic_evaluation.recommended_mode MUST be one of: full_bleed_visual, text_on_template, not_suitable
- mimic_evaluation.template_storage_quality MUST be one of: reusable, job_only, reject
- mimic_evaluation.content_slide_indices and skip_slide_indices MUST be arrays of integers (slide_index values)
- Required root arrays: risk_flags (use [] when none), slides (one object per attached image)
- Each slides[] entry MUST include slide_index (1..N), on_screen_text_transcript, visual_description, layout_template, typography, color_tokens, image_or_photo_role, text_density, slide_purpose, why_it_works, brand_specificity
- why_it_works (per slide): 3–4 sentences (~120+ chars) on why THIS slide works in the deck arc (psychological/emotional job, curiosity, proof, swipe motivation). Must be slide-specific — NEVER repeat deck why_it_worked verbatim.
- visual_description (per slide): 2–3 sentences (~80+ chars) describing composition, subjects, palette, lighting, and mood. Distinct from why_it_works.
- Each slides[] entry MUST also include composition_blueprint (compact, model-neutral, for regeneration):
  - composition_blueprint.canvas_description
  - composition_blueprint.layout_structure
  - composition_blueprint.visual_hierarchy
  - composition_blueprint.elements[] (element_id, element_type, description, bbox_pct [x,y,w,h] in 0-100, anchor, layer_order, prominence, style_notes, position_confidence low|medium|high)
  - composition_blueprint.text_blocks[] (role, text, bbox_pct, alignment, typography_notes, position_confidence)
  - composition_blueprint.background
  - composition_blueprint.spacing_notes
  - composition_blueprint.qwen_prompt_notes
- typography MUST include: headline_guess, body_guess, relative_scale, text_placement, hierarchy, font_size_px_headline, font_size_px_body (approximate px from visible text height)
- When on-screen text exists, include text_blocks[]: one object per distinct text region with text, role (title|subtitle|body|caption|cta), align, bbox_norm {x,y,w,h} as fractions 0-1 of the slide, font_size_px, font_weight, color_hex
- slide_purpose MUST be one of: hook, content, listicle_item, storytelling, cta, self_promo, product_pitch, testimonial, filler
- brand_specificity MUST be one of: none, low, high (high = slide mentions a specific product, guide, course, app, quiz, or branded offering)
- format_pattern MUST be one of: educational, listicle, story, before_after, promo, mixed, unknown
- slides.length MUST exactly equal the number of image attachments in the user message
- slide_index MUST use the **global** indices stated in the user message (not 1..k per batch)
- Describe ONLY pixels visible in each attached image. Do NOT invent unrelated brands, ads, or meme decks from training data
- Do not paste caption-only hashtags onto a slide unless those hashtags are visibly printed on that slide image`;

export const TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT = `You analyze an Instagram carousel deck from caption context and the cover slide image.

Return ONLY flat JSON (no "deck" wrapper, no slides array):
{
  "slide_arc": "...",
  "cover_vs_body": "...",
  "visual_consistency": "...",
  "on_screen_text_summary": "...",
  "cta_clarity": "...",
  "format_pattern": "educational | listicle | story | before_after | promo | mixed | unknown",
  "risk_flags": [],
  "why_it_worked": "3–4 sentences (~200+ chars): why this carousel performs as a SET — slide combination, pacing, emotional arc, swipe motivation",
  "primary_emotion": "dominant emotional vibe (short)",
  "secondary_emotion": "secondary vibe or empty string",
  "caption_style": "how the post caption pairs with the carousel (short)",
  "deck_as_whole_summary": "3–5 sentences: how slides combine into a cohesive swipe-worthy arc (not slide 1 alone)",
  "deck_composition_system": {
    "recurring_layout_pattern": "Recurring spatial pattern across slides (short)",
    "repeated_element_positions": ["Logo consistently top-right", "Headline usually top 15–25%"],
    "safe_margin_pattern": "Text safe area / margins pattern",
    "visual_hierarchy_pattern": "Headline first, subject second, CTA third"
  },
  "deck_visual_system": {
    "overall_aesthetic": "...",
    "canvas_aspect": "...",
    "safe_margins_gutters": "...",
    "repeated_template": "...",
    "motion_or_energy": "...",
    "emoji_or_sticker_usage": "..."
  },
  "replication_blueprint": {
    "steps_to_remake": ["..."],
    "asset_sources": ["..."],
    "tooling_notes": "...",
    "legal_ethics": "..."
  },
  "mimic_evaluation": {
    "recommended_mode": "full_bleed_visual | text_on_template | not_suitable",
    "mode_reason": "...",
    "background_replicability": "high | medium | low",
    "background_description": "...",
    "template_consistency": "uniform | varied | mixed",
    "content_slide_indices": [1, 2, 3],
    "skip_slide_indices": [],
    "skip_reason": "...",
    "replication_difficulty": "easy | moderate | hard",
    "template_storage_quality": "reusable | job_only | reject",
    "template_storage_reason": "..."
  }
}`;

export const TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT = `You analyze a subset of slides from a larger Instagram carousel deck.

Return ONLY flat JSON (no "deck" wrapper):
{
  "slides": [
    {
      "slide_index": <global index from user message>,
      "on_screen_text_transcript": "...",
      "visual_description": "...",
      "layout_template": "...",
      "composition_blueprint": {
        "canvas_description": "short, include aspect + orientation if inferable",
        "layout_structure": "short: e.g. top headline, central subject, bottom CTA",
        "visual_hierarchy": "what draws attention first → last",
        "elements": [
          {
            "element_id": "headline_1",
            "element_type": "headline | body_text | cta | logo | person | product | background | shape | icon | screenshot | decorative_element | other",
            "description": "what it is",
            "bbox_pct": [10, 12, 80, 18],
            "anchor": "top_left | top_center | top_right | center_left | center | center_right | bottom_left | bottom_center | bottom_right",
            "layer_order": 3,
            "prominence": "primary | secondary | tertiary | background",
            "style_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "text_blocks": [
          {
            "role": "headline | subheadline | body | cta | logo | other",
            "text": "visible line",
            "bbox_pct": [10, 12, 80, 18],
            "alignment": "left | center | right",
            "typography_notes": "optional",
            "position_confidence": "low | medium | high"
          }
        ],
        "background": "short",
        "spacing_notes": "short, include safe margins",
        "qwen_prompt_notes": "Preserve spatial layout + relative positions; use reference image for composition, not copyrighted details."
      },
      "typography": {
        "headline_guess": "sans bold",
        "body_guess": "sans regular",
        "relative_scale": "lg",
        "text_placement": "center band",
        "hierarchy": "headline over body",
        "font_size_px_headline": 72,
        "font_size_px_body": 38
      },
      "text_blocks": [
        {
          "text": "visible line",
          "role": "title",
          "align": "center",
          "bbox_norm": { "x": 0.1, "y": 0.35, "w": 0.8, "h": 0.12 },
          "font_size_px": 72,
          "font_weight": "bold",
          "color_hex": "#FFFFFF"
        }
      ],
      "color_tokens": { "background": "...", "primary_text": "...", "accent": [] },
      "graphic_elements": "...",
      "image_or_photo_role": "...",
      "text_density": "low | medium | high",
      "slide_purpose": "hook | content | listicle_item | storytelling | cta | self_promo | product_pitch | testimonial | filler",
      "why_it_works": "3–4 sentences (~120+ chars): why THIS slide works in the deck arc (psychological/emotional job, curiosity hook, proof function, or swipe motivation). Slide-specific — never repeat deck why_it_worked verbatim.",
      "visual_description": "2–3 sentences (~80+ chars): composition, subjects, palette, lighting, mood — distinct from why_it_works.",
      "brand_specificity": "none | low | high"
    }
  ]
}

slides.length MUST equal the number of image attachments. slide_index values MUST match the global indices in the user message.
Each slides[] entry MUST include why_it_works (per-slide strategic why, distinct from deck-level why_it_worked).

Vision fidelity rules:
- One slides[] object per attached image, in attachment order.
- Transcribe only text visible on that slide; use [illegible] for unreadable fragments — never fabricate filler copy.
- If a slide is photo-only with no text, set on_screen_text_transcript to "" and describe the photo in visual_description.
- Do not import content from the post caption unless it is visibly printed on the slide.`;

const GENERATED_OUTPUT_PREAMBLE = `You analyze content GENERATED by CAF (Content Automation Framework) that a human reviewer already APPROVED for publication.

Your job is to describe what was ACTUALLY RENDERED on screen (pixels in the attached images) and relate it to the INTENDED copy/spec in the user message.

Compare intended vs rendered where possible. This is not a reference top-performer post — it is CAF's own output quality read.

`;

export const GENERATED_OUTPUT_CAROUSEL_DECK_SUMMARY_PROMPT =
  GENERATED_OUTPUT_PREAMBLE + TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT;

export const GENERATED_OUTPUT_CAROUSEL_SLIDES_CHUNK_PROMPT =
  GENERATED_OUTPUT_PREAMBLE + TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT;
