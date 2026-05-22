/**
 * Normalize carousel top-performer LLM JSON (esp. Nemotron) into the flat schema CAF persists.
 */

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

function slideQualityScore(slide: Record<string, unknown>): number {
  const transcript = pickString(slide, "on_screen_text_transcript") ?? "";
  const visual = pickString(slide, "visual_description") ?? "";
  return transcript.length * 2 + visual.length;
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

function stripGarbageFromCarouselRoot(root: Record<string, unknown>): void {
  if (root.deck_visual_system != null) {
    const cleaned = sanitizeDeckVisualSystem(root.deck_visual_system);
    if (cleaned) root.deck_visual_system = cleaned;
    else delete root.deck_visual_system;
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

export const TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX = `

NVIDIA / Nemotron — strict output contract:
- Return ONE flat JSON object at the root. Never nest the payload under "deck", "carousel", "analysis", "result", or "output".
- Required root strings: slide_arc, cover_vs_body, visual_consistency, on_screen_text_summary, cta_clarity, format_pattern, why_it_worked, primary_emotion, secondary_emotion, caption_style
- Required root arrays: risk_flags (use [] when none), slides (one object per attached image)
- Each slides[] entry MUST include slide_index (1..N), on_screen_text_transcript, visual_description, layout_template, typography, color_tokens, image_or_photo_role, text_density
- format_pattern MUST be one of: educational, listicle, story, before_after, promo, mixed, unknown
- slides.length MUST exactly equal the number of image attachments in the user message`;

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
  "why_it_worked": "...",
  "primary_emotion": "dominant emotional vibe (short)",
  "secondary_emotion": "secondary vibe or empty string",
  "caption_style": "how the post caption pairs with the carousel (short)",
  "deck_as_whole_summary": "...",
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
      "typography": { "headline_guess": "...", "body_guess": "...", "hierarchy": "..." },
      "color_tokens": { "background": "...", "primary_text": "...", "accent": [] },
      "graphic_elements": "...",
      "image_or_photo_role": "...",
      "text_density": "low | medium | high"
    }
  ]
}

slides.length MUST equal the number of image attachments. slide_index values MUST match the global indices in the user message.`;
