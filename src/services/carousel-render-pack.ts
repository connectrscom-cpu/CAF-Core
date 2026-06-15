/**
 * Build renderer payload for carousel slides from generation_payload / generated_output.
 *
 * Priority matches Sheets "CREATION - Runtime" shape: real copy often lives in `carousel[]` or
 * `{ type, items: [{ headline, body }] }` while `slides` / `variations` are schema placeholders.
 *
 * Also normalizes common LLM drift: `slide_deck.slides`, `variation.slides`, `carousel.slides` (object),
 * `content.carousel[]`, and ignores empty placeholder `slides[]` from merged candidate_data so nested decks still render.
 */

import { randomInt } from "node:crypto";
import { formatInstagramHandleForCta } from "../domain/instagram-handle.js";

export { formatInstagramHandleForCta } from "../domain/instagram-handle.js";

/** Mirrors `pickCarouselTypographyPatch` in `domain/carousel-render-typography.ts` (local copy so Review/Next can bundle this module without resolving `../domain`). */
function pickCarouselTypographyPatchForRender(source: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!source || typeof source !== "object") return {};
  const keys = [
    "carousel_headline_font_px",
    "carousel_body_font_px",
    "carousel_kicker_font_px",
    "carousel_cta_font_px",
    "carousel_handle_font_px",
  ] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const raw = source[k];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(String(raw).trim()) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 512) continue;
    out[k] = Math.round(n);
  }
  return out;
}

/** Same behavior as `pickGeneratedOutputOrEmpty` in `domain/generation-payload-output.ts` (inlined so Review/Next can bundle this module without resolving `../domain`). */
function pickGeneratedOutputOrEmptyFromPayload(
  payload: { generated_output?: unknown; [k: string]: unknown } | null | undefined
): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out = payload.generated_output;
  if (!out || typeof out !== "object" || Array.isArray(out)) return {};
  return out as Record<string, unknown>;
}

const HEADLINE_KEYS = [
  "headline",
  "title",
  "heading",
  "slide_headline",
  "hook",
  "slide_hook",
  "main_title",
  "hero",
  /** Top-performer mimic carousel copy often uses cover_* on the first slide. */
  "cover_title",
  /** MIMIC__Top_Performer_Carousel_v1 often uses panel_title per slide. */
  "panel_title",
];
const BODY_KEYS = [
  "body",
  "text",
  "content",
  "slide_body",
  "caption",
  "subtitle",
  "main_copy",
  "slide_copy",
  "description",
  "supporting_copy",
  "deck",
  /** Top-performer mimic carousel copy often uses cover_* on the first slide. */
  "cover_subtitle",
  /** Some Flow_Carousel / Sheets adapters put the paragraph here instead of `body`. */
  "panel_body",
];

function bulletsToBody(o: Record<string, unknown>): string {
  const b = o.bullets;
  if (!Array.isArray(b) || b.length === 0) return "";
  const lines = b.map((x) => String(x).trim()).filter((s) => s.length > 0);
  if (lines.length === 0) return "";
  return lines.map((s) => `• ${s}`).join("\n");
}

function stripStandaloneEmojiLines(s: string): string {
  const raw = String(s ?? "");
  if (!raw.trim()) return "";
  const lines = raw.split(/\r?\n/);
  // Emoji-only lines create "emoji paragraphs" which frequently fail editorial review.
  // Merge them into the nearest preceding text line when possible, otherwise drop.
  // Avoid Unicode property escapes here; some runtimes/tooling have incomplete support.
  const EMOJI_ANY_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const EMOJI_ONLY_RE = /^[\s\u200D\uFE0F\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/u;

  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      // preserve blank lines only when we already have content and the previous line wasn't blank
      if (out.length > 0 && out[out.length - 1]?.trim() !== "") out.push("");
      continue;
    }
    if (EMOJI_ANY_RE.test(t) && EMOJI_ONLY_RE.test(t)) {
      // Merge into the nearest preceding non-empty line (skip blank paragraphs).
      let j = out.length - 1;
      while (j >= 0 && (out[j] ?? "").trim() === "") j--;
      if (j < 0) continue;
      const prev = (out[j] ?? "").trimEnd();
      out[j] = `${prev} ${t}`.trim();
      // Drop trailing blank lines after the merge point (they were just spacing before the emoji).
      out.splice(j + 1);
      continue;
    }
    out.push(line.trimEnd());
  }

  // Trim leading/trailing blank lines introduced by preservation.
  while (out.length > 0 && (out[0] ?? "").trim() === "") out.shift();
  while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") out.pop();

  return out.join("\n").trim();
}

/**
 * Remove social-style #hashtags from slide copy. Hashtags belong in captions, not slide bodies (editorial).
 * Requires a letter after # so bare numbers like "#1" in "Top #1 tip" are left alone unless #Letter…
 */
export function stripHashtagsFromSlideCopy(s: string): string {
  let t = String(s ?? "");
  if (!t.trim()) return "";
  t = t.replace(/(?:^|\s)#[\p{L}][\p{L}\p{N}_]*/gu, (m) => (m.startsWith(" ") ? " " : ""));
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n");
  return t.trim();
}

/**
 * Remove “air quotes” from slide copy. We strip double-quote characters only
 * (straight + curly) and keep apostrophes for contractions.
 */
export function stripAirQuotesFromSlideCopy(s: string): string {
  let t = String(s ?? "");
  if (!t.trim()) return "";
  t = t.replace(/[“”"]/g, "");
  // Collapse accidental double-spaces from quote removal.
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

/**
 * Some generations leak "field labels" into slide copy (e.g. "Kicker: X", "CTA text: ...").
 * Strip those label prefixes (especially on the first line) so templates don't render them verbatim.
 */
export function stripLeakedFieldLabelsFromSlideCopy(s: string): string {
  const raw = String(s ?? "");
  if (!raw.trim()) return "";
  const lines = raw.split(/\r?\n/);
  const stripLine = (line: string): string => {
    let t = String(line ?? "").trim();
    if (!t) return "";
    // Common leaked labels from review/export UI.
    t = t.replace(/^(kicker|cta\s*text|cta|handle|follow\s*line|panel\s*title|panel\s*body)\s*[:\-]\s*/i, "");
    return t.trim();
  };
  const out = lines.map(stripLine).filter((x) => x.length > 0);
  return out.join("\n").trim();
}

function copyFromNestedTextBlock(val: unknown): { headline: string; body: string } | null {
  if (!val || typeof val !== "object" || Array.isArray(val)) return null;
  const rec = val as Record<string, unknown>;
  const headline = String(rec.headline ?? rec.title ?? rec.heading ?? rec.kicker ?? rec.panel_title ?? "").trim();
  const bodyParts = [
    rec.body,
    rec.subline,
    rec.subtitle,
    rec.content,
    rec.note,
    rec.sub,
    rec.cta_sub,
  ]
    .map((v) => (v != null && typeof v !== "object" ? String(v).trim() : ""))
    .filter((s) => s.length > 0);
  const body = bodyParts.join("\n").trim();
  if (!headline && !body) return null;
  return { headline, body };
}

function textFromTextBlocksArray(blocks: unknown): { headline: string; body: string } | null {
  if (!Array.isArray(blocks)) return null;
  let headline = "";
  const bodyParts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    const role = String(rec.role ?? "").trim().toLowerCase();
    const text = String(rec.text ?? "").trim();
    if (!text) continue;
    if (role === "title" || role === "headline" || role === "kicker") {
      if (!headline) headline = text;
    } else if (role === "subtitle" || role === "body" || role === "sub") {
      bodyParts.push(text);
    } else if (!headline) {
      headline = text;
    } else {
      bodyParts.push(text);
    }
  }
  const body = bodyParts.join("\n").trim();
  if (!headline && !body) return null;
  return { headline, body };
}

function textFromSlide(o: Record<string, unknown>): { headline: string; body: string } {
  const fromBlocks =
    textFromTextBlocksArray(o.text_blocks) ??
    textFromTextBlocksArray(
      o.elements && typeof o.elements === "object" && !Array.isArray(o.elements)
        ? (o.elements as Record<string, unknown>).text_blocks
        : undefined
    );
  const nestedText =
    copyFromNestedTextBlock(o.text) ??
    copyFromNestedTextBlock(o.content);
  const headline =
    (fromBlocks?.headline || nestedText?.headline) ??
    HEADLINE_KEYS.map((k) => o[k]).find((v) => v != null && typeof v !== "object" && String(v).trim());
  let body =
    (fromBlocks?.body || nestedText?.body) ??
    BODY_KEYS.map((k) => {
      const v = o[k];
      if (v == null) return undefined;
      if (typeof v === "object") return undefined;
      const s = String(v).trim();
      return s.length > 0 ? s : undefined;
    }).find(Boolean);
  if (body == null || String(body).trim() === "") {
    const fromBullets = bulletsToBody(o);
    if (fromBullets) body = fromBullets;
  }
  const h = stripLeakedFieldLabelsFromSlideCopy(
    stripAirQuotesFromSlideCopy(stripHashtagsFromSlideCopy(stripStandaloneEmojiLines(String(headline ?? "").trim())))
  );
  const b = stripLeakedFieldLabelsFromSlideCopy(
    stripAirQuotesFromSlideCopy(stripHashtagsFromSlideCopy(stripStandaloneEmojiLines(String(body ?? "").trim())))
  );
  return { headline: h, body: b };
}

function stableMicroActionSeed(parts: string[]): number {
  let h = 2166136261;
  const s = parts.filter(Boolean).join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deriveMicroActionPanelBody(headline: string, body: string, slideIdx0?: number): string {
  const h = String(headline ?? "").trim();
  const b = String(body ?? "").trim();
  const t = `${h}\n${b}`.toLowerCase();
  const seed = stableMicroActionSeed([String(slideIdx0 ?? ""), h.toLowerCase(), b.toLowerCase()]);

  const pick = (options: string[]): string => {
    if (options.length === 0) return "";
    return options[seed % options.length]!;
  };

  if (/\bquiz\b|\btest\b|\binteractive\b/.test(t)) {
    return pick([
      "Pick one question from this slide. Answer it in one sentence, then share it with a friend.",
      "Choose one prompt from this slide. Write a 2-line answer in Notes, then screenshot it.",
      "Answer one question from this slide honestly. Save it and revisit in a week.",
    ]);
  }
  if (/\bcompatibil|relationship|romantic|dating|partner|friendship|family\b/.test(t)) {
    return pick([
      "Circle one line that feels true. Name the need underneath it, then text it to yourself as a reminder.",
      "Write one boundary and one request you want to practice. Keep it short and specific.",
      "Pick the one sentence you wish someone would say to you. Say it to yourself today.",
    ]);
  }
  if (/\bchecklist\b|\bsteps?\b|\bhow to\b|\btry\b|\bpractice\b/.test(t)) {
    return pick([
      "Choose one step from this slide. Do it in the next 10 minutes, then save this to repeat tomorrow.",
      "Turn one line into a tiny checklist. Do step 1 today, nothing more.",
      "Pick the easiest action here. Schedule it for tomorrow in 5 minutes.",
    ]);
  }
  if (/\bmistake\b|\bavoid\b|\bdon't\b|\bstop\b|\bnever\b/.test(t)) {
    return pick([
      "Pick one thing you’ll stop doing this week. Replace it with one tiny action you *will* do instead.",
      "Spot the pattern you want to quit. Write a 1-sentence replacement plan.",
      "Choose one 'don’t' from this slide and rewrite it as a clear 'do'.",
    ]);
  }
  return pick([
    "Underline one line you want to remember. Write the smallest next step you can do today (10 minutes max).",
    "Highlight one sentence. Turn it into a simple mantra you can repeat this week.",
    "Pick one idea from this slide. Explain it in your own words in 2 lines.",
    "Save this slide. Then write: “If I did just one thing, it would be…” and fill it in.",
    "Choose one word that stands out. Write one action that makes that word true today.",
  ]);
}

/**
 * Default panel callouts for templates that render `panel_title` / `panel_body` (e.g. healthcard).
 * We intentionally do **not** apply this to the CTA slide — templates supply their own CTA panel fallbacks
 * and reviewers found synthetic "Engage" confusing.
 */
function ensurePanelFields(
  slide: Record<string, unknown>,
  defaults: { title: string; body: string }
): Record<string, unknown> {
  const panelTitle =
    typeof slide.panel_title === "string"
      ? stripLeakedFieldLabelsFromSlideCopy(stripAirQuotesFromSlideCopy(String(slide.panel_title)))
      : "";
  const panelBody =
    typeof slide.panel_body === "string"
      ? stripLeakedFieldLabelsFromSlideCopy(stripAirQuotesFromSlideCopy(String(slide.panel_body)))
      : "";
  return {
    ...slide,
    ...(panelTitle ? {} : { panel_title: stripLeakedFieldLabelsFromSlideCopy(stripAirQuotesFromSlideCopy(defaults.title)) }),
    ...(panelBody ? {} : { panel_body: stripLeakedFieldLabelsFromSlideCopy(stripAirQuotesFromSlideCopy(defaults.body)) }),
  };
}

/** True if this slide would show meaningful text in the renderer (not just slide_role). */
export function slideHasRenderableContent(s: Record<string, unknown>): boolean {
  const unwrapped = unwrapMimicSlideRow(s);
  const { headline, body } = textFromSlide(unwrapped);
  return headline.length > 0 || body.length > 0;
}

/** Unwrap mimic LLM rows that nest copy under cover / body_slide / cta_slide. */
function unwrapMimicSlideRow(r: Record<string, unknown>): Record<string, unknown> {
  for (const [key, role] of [
    ["cover", "cover"],
    ["body_slide", "body"],
    ["cta_slide", "cta"],
  ] as const) {
    const wrapped = r[key];
    if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      const inner = wrapped as Record<string, unknown>;
      return {
        ...inner,
        slide_number: r.slide_number ?? inner.slide_number,
        slide_role: inner.slide_role ?? r.slide_role ?? role,
      };
    }
  }
  return r;
}

/** Mimic LLM rows with Nemotron placement boxes — composite via text_blocks only (avoid headline+body stack). */
function slideHasPositionedTextBlocks(o: Record<string, unknown>): boolean {
  const elements =
    o.elements && typeof o.elements === "object" && !Array.isArray(o.elements)
      ? (o.elements as Record<string, unknown>)
      : null;
  const blocks = o.text_blocks ?? elements?.text_blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  return blocks.some((b) => {
    if (!b || typeof b !== "object") return false;
    const rec = b as Record<string, unknown>;
    const text = String(rec.text ?? "").trim();
    if (!text) return false;
    return rec.x != null || rec.y != null || rec.w != null || rec.h != null;
  });
}

function normalizeItemSlide(r: Record<string, unknown>): Record<string, unknown> {
  const unwrapped = unwrapMimicSlideRow(r);
  if (slideHasPositionedTextBlocks(unwrapped)) {
    const { headline: _h, body: _b, title: _t, subtitle: _s, ...rest } = unwrapped;
    return {
      ...rest,
      slide_role: unwrapped.slide_role ?? r.slide_role ?? "body",
    };
  }
  const tf = textFromSlide(unwrapped);
  return {
    ...unwrapped,
    ...(tf.headline ? { headline: tf.headline } : {}),
    ...(tf.body ? { body: tf.body } : {}),
    slide_role: unwrapped.slide_role ?? r.slide_role ?? "body",
  };
}

/** Parse Google-Sheets-style carousel: array of slides, or stringified JSON, or `{ items: [...] }`. */
function slidesFromCarouselField(carouselVal: unknown): Record<string, unknown>[] {
  if (carouselVal == null) return [];

  if (Array.isArray(carouselVal)) {
    return carouselVal
      .filter((x) => x && typeof x === "object" && !Array.isArray(x))
      .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  }

  let obj: Record<string, unknown> | null = null;
  if (typeof carouselVal === "string") {
    const t = carouselVal.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return [];
    try {
      const p = JSON.parse(carouselVal) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) obj = p as Record<string, unknown>;
      else if (Array.isArray(p)) {
        return p
          .filter((x) => x && typeof x === "object")
          .map((x) => normalizeItemSlide(x as Record<string, unknown>));
      }
    } catch {
      return [];
    }
  } else if (typeof carouselVal === "object" && !Array.isArray(carouselVal)) {
    obj = carouselVal as Record<string, unknown>;
  }

  if (!obj) return [];
  const items = obj.items;
  if (Array.isArray(items)) {
    return items
      .filter((x) => x && typeof x === "object")
      .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  }
  const nestedSlides = obj.slides;
  if (Array.isArray(nestedSlides)) {
    return nestedSlides
      .filter((x) => x && typeof x === "object" && !Array.isArray(x))
      .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  }
  const coverSlide = obj.cover_slide;
  const bodySlides = obj.body_slides;
  const ctaSlide = obj.cta_slide;
  if (
    (coverSlide && typeof coverSlide === "object" && !Array.isArray(coverSlide)) ||
    (Array.isArray(bodySlides) && bodySlides.length > 0) ||
    (ctaSlide && typeof ctaSlide === "object" && !Array.isArray(ctaSlide))
  ) {
    const assembled: Record<string, unknown>[] = [];
    if (coverSlide && typeof coverSlide === "object" && !Array.isArray(coverSlide)) {
      assembled.push(normalizeItemSlide({ ...(coverSlide as Record<string, unknown>), slide_role: "cover" }));
    }
    if (Array.isArray(bodySlides)) {
      for (const s of bodySlides) {
        if (s && typeof s === "object" && !Array.isArray(s)) {
          assembled.push(normalizeItemSlide({ ...(s as Record<string, unknown>), slide_role: "body" }));
        }
      }
    }
    if (ctaSlide && typeof ctaSlide === "object" && !Array.isArray(ctaSlide)) {
      assembled.push(normalizeItemSlide({ ...(ctaSlide as Record<string, unknown>), slide_role: "cta" }));
    }
    if (assembled.length > 0 && assembled.some(slideHasRenderableContent)) return assembled;
  }
  return [];
}

/** Flow_Carousel_Copy schema often nests slides under `variation.slides`. */
function slidesFromVariationField(variationVal: unknown): Record<string, unknown>[] {
  if (!variationVal || typeof variationVal !== "object" || Array.isArray(variationVal)) return [];
  const slides = (variationVal as Record<string, unknown>).slides;
  if (!Array.isArray(slides)) return [];
  const out = slides
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  return out.length > 0 && out.some(slideHasRenderableContent) ? out : [];
}

/** LLM drift: `structure: { slides: [...] }` alongside `structure_variables` metadata. */
function slidesFromStructureField(structVal: unknown): Record<string, unknown>[] {
  if (!structVal || typeof structVal !== "object" || Array.isArray(structVal)) return [];
  const slides = (structVal as Record<string, unknown>).slides;
  if (!Array.isArray(slides)) return [];
  const out = slides
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  return out.length > 0 && out.some(slideHasRenderableContent) ? out : [];
}

/** LLM drift: `variation_content: { carousel: ... }` or `variation_content.slides[]`. */
function slidesFromVariationContentField(vcVal: unknown): Record<string, unknown>[] {
  if (!vcVal || typeof vcVal !== "object" || Array.isArray(vcVal)) return [];
  const rec = vcVal as Record<string, unknown>;
  const fromCarousel = slidesFromCarouselField(rec.carousel);
  if (fromCarousel.length > 0 && fromCarousel.some(slideHasRenderableContent)) return fromCarousel;
  const slides = rec.slides;
  if (!Array.isArray(slides)) return [];
  const out = slides
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  return out.length > 0 && out.some(slideHasRenderableContent) ? out : [];
}

/** Many prompts return `{ slide_deck: { slides: [...], structure_variables } }` instead of `variations` / top-level `slides`. */
function slidesFromSlideDeckField(deckVal: unknown): Record<string, unknown>[] {
  if (!deckVal || typeof deckVal !== "object" || Array.isArray(deckVal)) return [];
  const slides = (deckVal as Record<string, unknown>).slides;
  if (!Array.isArray(slides)) return [];
  const out = slides
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  return out.length > 0 && out.some(slideHasRenderableContent) ? out : [];
}

/** LLM drift: `{ content: { slides: [...], caption, ... } }` (no top-level `slides` / `variations`). */
function slidesFromContentSlidesField(contentVal: unknown): Record<string, unknown>[] {
  if (!contentVal || typeof contentVal !== "object" || Array.isArray(contentVal)) return [];
  const slides = (contentVal as Record<string, unknown>).slides;
  if (!Array.isArray(slides)) return [];
  const out = slides
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
  return out.length > 0 && out.some(slideHasRenderableContent) ? out : [];
}

/**
 * LLM drift: nests the real deck under `output_schema.schema_json` (meta prompt echoed the schema shape).
 * Also tolerate `output_schema` mirroring `schema_json` without the extra wrapper.
 */
function slidesFromOutputSchemaField(outputSchemaVal: unknown): Record<string, unknown>[] {
  if (!outputSchemaVal || typeof outputSchemaVal !== "object" || Array.isArray(outputSchemaVal)) {
    return [];
  }
  const rec = outputSchemaVal as Record<string, unknown>;
  const fromInner = (inner: Record<string, unknown>): Record<string, unknown>[] => {
    const direct = inner.slides;
    if (Array.isArray(direct)) {
      const out = direct
        .filter((x) => x && typeof x === "object" && !Array.isArray(x))
        .map((x) => normalizeItemSlide(x as Record<string, unknown>));
      if (out.length > 0 && out.some(slideHasRenderableContent)) return out;
    }
    const fromCar = slidesFromCarouselField(inner.carousel);
    if (fromCar.length > 0 && fromCar.some(slideHasRenderableContent)) return fromCar;
    return [];
  };
  const sj = rec.schema_json;
  if (sj && typeof sj === "object" && !Array.isArray(sj)) {
    const got = fromInner(sj as Record<string, unknown>);
    if (got.length > 0) return got;
  }
  return fromInner(rec);
}

function slidesFromContentField(contentVal: unknown): Record<string, unknown>[] {
  if (!contentVal || typeof contentVal !== "object" || Array.isArray(contentVal)) return [];
  const c = contentVal as Record<string, unknown>;
  return slidesFromCarouselField(c.carousel);
}

function topLevelItemsSlideArray(gen: Record<string, unknown>): Record<string, unknown>[] {
  const items = gen.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((x) => normalizeItemSlide(x as Record<string, unknown>));
}

/** Keep slide rows only if at least one has headline or body (skip LLM placeholder shells). */
function usableSlideArray(arr: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = arr.filter(
    (s) =>
      s &&
      typeof s === "object" &&
      !Array.isArray(s) &&
      slideHasRenderableContent(s as Record<string, unknown>)
  ) as Record<string, unknown>[];
  return out.length > 0 ? out.map((s) => normalizeItemSlide(s)) : null;
}

function legacyCoverBodyCtaSlides(gen: Record<string, unknown>): Record<string, unknown>[] {
  const slides: Record<string, unknown>[] = [];

  const coverSlide = (gen.cover_slide ?? {}) as Record<string, unknown>;
  const coverHeadline =
    String(gen.cover ?? gen.intro_title ?? coverSlide.headline ?? coverSlide.title ?? coverSlide.heading ?? "").trim();
  const coverBody =
    String(gen.cover_subtitle ?? coverSlide.body ?? coverSlide.text ?? coverSlide.content ?? "").trim();
  slides.push({ headline: coverHeadline, body: coverBody, slide_role: "cover" });

  const bodySlides = gen.body_slides;
  if (Array.isArray(bodySlides)) {
    for (const s of bodySlides) {
      if (s && typeof s === "object") slides.push({ ...(s as Record<string, unknown>), slide_role: "body" });
    }
  }

  const cta = (gen.cta_slide ?? {}) as Record<string, unknown>;
  if (Object.keys(cta).length > 0 || gen.cta_text || gen.cta_handle) {
    slides.push({
      headline: String(gen.cta_text ?? cta.headline ?? "").trim(),
      body: String(gen.cta_handle ?? cta.body ?? "").trim(),
      slide_role: "cta",
    });
  }

  return slides;
}

function slideHasUnreliableMimicTextBlocks(s: Record<string, unknown>): boolean {
  const blocks = s.text_blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const body = String(s.body ?? "").trim();
  for (const item of blocks) {
    const rec = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const t = String(rec?.text ?? "");
    if (t.includes("…") || t.includes("...")) return true;
  }
  if (body.length > 40) {
    let blockBodyLen = 0;
    for (const item of blocks) {
      const rec = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
      if (!rec) continue;
      const role = String(rec.role ?? "").toLowerCase();
      const text = String(rec.text ?? "").trim();
      if (/headline|title|hook|cover|kicker/.test(role)) continue;
      if (/^@[\w.]{2,}$/.test(text)) continue;
      blockBodyLen += text.length;
    }
    if (blockBodyLen < body.length * 0.45) return true;
  }
  return false;
}

function slideDeckTextScore(slides: Record<string, unknown>[]): number {
  let t = 0;
  let penalty = 0;
  for (const s of slides) {
    const x = textFromSlide(s);
    t += x.headline.length + x.body.length;
    if (slideHasUnreliableMimicTextBlocks(s)) penalty += 800;
  }
  return t - penalty;
}

/**
 * Ensure slide roles are present and differ by position:
 * - first: cover
 * - middle: body
 * - last: cta
 *
 * Many LLM outputs default everything to "body"; without this, downstream render/review
 * cannot reliably reason about cover vs CTA slides.
 */
function normalizeSlideRoles(slides: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!Array.isArray(slides) || slides.length === 0) return slides;
  const n = slides.length;
  return slides.map((s, i) => {
    const role = i === 0 ? "cover" : i === n - 1 ? "cta" : "body";
    return { ...s, slide_role: role };
  });
}

type CarouselDeckId =
  | "slides"
  | "slides_json"
  | "slide_deck"
  | "variation"
  | "variations"
  | "structure_slides"
  | "variation_content"
  | "carousel"
  | "items"
  | "content_slides"
  | "content_carousel"
  | "output_schema";

/** Lower = preferred when total text is within `TIE_BAND_CHARS` (canonical LLM path vs parallel fields). */
const DECK_PRIORITY: Record<CarouselDeckId, number> = {
  // PARTIAL_REWRITE often puts reviewer copy under `slides_json` while merge leaves stale `slides[]`.
  slides_json: 0,
  slides: 1,
  slide_deck: 0,
  variation: 0,
  structure_slides: 0,
  variation_content: 0,
  content_slides: 0,
  output_schema: 0,
  variations: 1,
  carousel: 2,
  content_carousel: 2,
  items: 3,
};

const TIE_BAND_CHARS = 48;

type TaggedSlideDeck = { id: CarouselDeckId; slides: Record<string, unknown>[] };

function collectRenderableSlideDecks(gen: Record<string, unknown>): TaggedSlideDeck[] {
  const out: TaggedSlideDeck[] = [];
  const fromSlides = usableSlideArray(gen.slides);
  if (fromSlides) out.push({ id: "slides", slides: fromSlides });
  const slidesJson = gen.slides_json;
  if (slidesJson && typeof slidesJson === "object" && !Array.isArray(slidesJson)) {
    const fromSlidesJson = usableSlideArray((slidesJson as Record<string, unknown>).slides);
    if (fromSlidesJson) out.push({ id: "slides_json", slides: fromSlidesJson });
  }
  const fromSlideDeck = slidesFromSlideDeckField(gen.slide_deck);
  if (fromSlideDeck.length > 0) out.push({ id: "slide_deck", slides: fromSlideDeck });
  const fromVariation = slidesFromVariationField(gen.variation);
  if (fromVariation.length > 0) out.push({ id: "variation", slides: fromVariation });
  const fromStructureSlides = slidesFromStructureField(gen.structure);
  if (fromStructureSlides.length > 0) out.push({ id: "structure_slides", slides: fromStructureSlides });
  const fromVariationContent = slidesFromVariationContentField(gen.variation_content);
  if (fromVariationContent.length > 0) out.push({ id: "variation_content", slides: fromVariationContent });
  const fromVariations = usableSlideArray(gen.variations);
  if (fromVariations) out.push({ id: "variations", slides: fromVariations });
  const fromCarousel = slidesFromCarouselField(gen.carousel);
  if (fromCarousel.length > 0 && fromCarousel.some(slideHasRenderableContent)) {
    out.push({ id: "carousel", slides: fromCarousel });
  }
  const fromContentSlides = slidesFromContentSlidesField(gen.content);
  if (fromContentSlides.length > 0) {
    out.push({ id: "content_slides", slides: fromContentSlides });
  }
  const fromOutputSchema = slidesFromOutputSchemaField(gen.output_schema);
  if (fromOutputSchema.length > 0) {
    out.push({ id: "output_schema", slides: fromOutputSchema });
  }
  const fromContentCarousel = slidesFromContentField(gen.content);
  if (fromContentCarousel.length > 0 && fromContentCarousel.some(slideHasRenderableContent)) {
    out.push({ id: "content_carousel", slides: fromContentCarousel });
  }
  const fromTopItems = topLevelItemsSlideArray(gen);
  if (fromTopItems.length > 0 && fromTopItems.some(slideHasRenderableContent)) {
    out.push({ id: "items", slides: fromTopItems });
  }
  return out;
}

function renderableSlideCount(slides: Record<string, unknown>[]): number {
  return slides.filter((s) => slideHasRenderableContent(s)).length;
}

/**
 * Prefer much richer copy; when totals are within `TIE_BAND_CHARS`, prefer lower `DECK_PRIORITY`
 * (e.g. `slides_json` over stale merged `slides` after PARTIAL_REWRITE).
 */
function pickBestSlideDeckByScore(tagged: TaggedSlideDeck[]): Record<string, unknown>[] {
  let best = tagged[0]!;
  let bestScore = slideDeckTextScore(best.slides);
  for (let i = 1; i < tagged.length; i++) {
    const cur = tagged[i]!;
    const sc = slideDeckTextScore(cur.slides);
    if (sc > bestScore + TIE_BAND_CHARS) {
      best = cur;
      bestScore = sc;
      continue;
    }
    if (bestScore > sc + TIE_BAND_CHARS) continue;
    if (DECK_PRIORITY[cur.id] < DECK_PRIORITY[best.id]) {
      best = cur;
      bestScore = sc;
    }
  }
  return best.slides;
}

/**
 * Prefer much richer copy; when totals are within `TIE_BAND_CHARS`, prefer lower `DECK_PRIORITY`
 * (e.g. `slides_json` over stale merged `slides` after PARTIAL_REWRITE).
 * When `preferred_slide_count` is set (mimic jobs), prefer the deck whose renderable slide count matches
 * the target — avoids picking a stale 4-slide `carousel` over the canonical 2-slide `slides` array.
 */
function pickBestSlideDeck(tagged: TaggedSlideDeck[], preferredSlideCount?: number | null): Record<string, unknown>[] {
  const viable = tagged.filter((t) => renderableSlideCount(t.slides) > 0);
  const pool = viable.length > 0 ? viable : tagged;
  if (preferredSlideCount != null && Number.isFinite(preferredSlideCount) && preferredSlideCount > 0) {
    const target = Math.floor(preferredSlideCount);
    const exact = pool.filter((t) => renderableSlideCount(t.slides) === target);
    if (exact.length > 0) return pickBestSlideDeckByScore(exact);
    const under = pool.filter((t) => {
      const n = renderableSlideCount(t.slides);
      return n > 0 && n < target;
    });
    if (under.length > 0) {
      const maxUnder = Math.max(...under.map((t) => renderableSlideCount(t.slides)));
      return pickBestSlideDeckByScore(
        under.filter((t) => renderableSlideCount(t.slides) === maxUnder)
      );
    }
    const notOver = pool.filter((t) => renderableSlideCount(t.slides) <= target);
    if (notOver.length > 0) return pickBestSlideDeckByScore(notOver);
  }
  return pickBestSlideDeckByScore(pool);
}

/** When the cover has body copy but no title, derive a short title so templates are not blank above the fold. */
function coverHeadlineFallback(headline: string, body: string): string {
  const h = headline.trim();
  if (h.length > 0) return h;
  const b = body.trim();
  if (!b) return "";
  const first = b.split(/(?<=[.!?])\s+/)[0]?.trim() ?? b;
  const max = 100;
  return first.length > max ? `${first.slice(0, max).trimEnd()}…` : first;
}

function shortenCoverBody(raw: string): string {
  const s0 = String(raw ?? "").trim();
  if (!s0) return "";
  const s = s0.replace(/\s+/g, " ");
  // Target: 1–2 sentences. Prefer ending on sentence boundaries.
  const sentences = s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const picked = sentences.length <= 2 ? sentences.join(" ") : sentences.slice(0, 2).join(" ");
  // Hard cap to avoid templates having to clamp large paragraphs on the cover.
  const maxChars = 220;
  if (picked.length <= maxChars) return picked;
  const clipped = picked.slice(0, maxChars).trimEnd();
  return clipped.endsWith("…") ? clipped : `${clipped}…`;
}

function rowHasRenderableCopy(s: unknown): boolean {
  return Boolean(s && typeof s === "object" && !Array.isArray(s) && slideHasRenderableContent(s as Record<string, unknown>));
}

/**
 * Remove deck-shaped fields that contain no renderable headline/body.
 * When `{ ...candidate_data, ...generated_output }` runs, planner/router stubs on the candidate
 * (empty `slides`, empty `variation.slides`, etc.) can remain while the model copy lives only under
 * `slide_deck` or `carousel` — `collectRenderableSlideDecks` then picks the wrong deck or falls back
 * to an empty legacy cover. Stripping dead decks before normalize/render fixes first-pass carousel jobs.
 */
export function stripNonRenderableDeckFields(base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  if (Array.isArray(out.slides) && !out.slides.some(rowHasRenderableCopy)) {
    delete out.slides;
  }
  if (Array.isArray(out.items) && !out.items.some(rowHasRenderableCopy)) {
    delete out.items;
  }
  if (Array.isArray(out.variations)) {
    const first = out.variations[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const slides = (first as Record<string, unknown>).slides;
      if (Array.isArray(slides) && !slides.some(rowHasRenderableCopy)) {
        delete out.variations;
      }
    }
  }
  if (out.variation && typeof out.variation === "object" && !Array.isArray(out.variation)) {
    const slides = (out.variation as Record<string, unknown>).slides;
    if (Array.isArray(slides) && !slides.some(rowHasRenderableCopy)) {
      delete out.variation;
    }
  }
  if (out.slide_deck && typeof out.slide_deck === "object" && !Array.isArray(out.slide_deck)) {
    const slides = (out.slide_deck as Record<string, unknown>).slides;
    if (Array.isArray(slides) && !slides.some(rowHasRenderableCopy)) {
      delete out.slide_deck;
    }
  }
  if (out.carousel != null) {
    const rows = slidesFromCarouselField(out.carousel);
    if (rows.length === 0 || !rows.some((s) => slideHasRenderableContent(s))) {
      delete out.carousel;
    }
  }
  if (out.content && typeof out.content === "object" && !Array.isArray(out.content)) {
    const c0 = out.content as Record<string, unknown>;
    const c: Record<string, unknown> = { ...c0 };
    let changed = false;
    if (Array.isArray(c.slides) && !c.slides.some(rowHasRenderableCopy)) {
      delete c.slides;
      changed = true;
    }
    if (c.carousel != null) {
      const rows = slidesFromCarouselField(c.carousel);
      if (rows.length === 0 || !rows.some((s) => slideHasRenderableContent(s))) {
        delete c.carousel;
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(c).length > 0) out.content = c;
      else delete out.content;
    }
  }
  if (out.structure && typeof out.structure === "object" && !Array.isArray(out.structure)) {
    const slides = (out.structure as Record<string, unknown>).slides;
    if (Array.isArray(slides) && !slides.some(rowHasRenderableCopy)) {
      const { slides: _s, ...rest } = out.structure as Record<string, unknown>;
      if (Object.keys(rest).length > 0) {
        out.structure = rest;
      } else {
        delete out.structure;
      }
    }
  }
  if (out.variation_content && typeof out.variation_content === "object" && !Array.isArray(out.variation_content)) {
    const rows = slidesFromVariationContentField(out.variation_content);
    if (rows.length === 0 || !rows.some((s) => slideHasRenderableContent(s))) {
      delete out.variation_content;
    }
  }
  if (out.slides_json && typeof out.slides_json === "object" && !Array.isArray(out.slides_json)) {
    const slides = (out.slides_json as Record<string, unknown>).slides;
    if (Array.isArray(slides) && !slides.some(rowHasRenderableCopy)) {
      delete out.slides_json;
    }
  }

  return out;
}

/**
 * Normalize generated carousel JSON into an ordered list of slide records for Handlebars.
 * Chooses the **richest** deck when multiple arrays exist (e.g. planner `items` stubs vs LLM `slides`),
 * so merged `candidate_data` does not shadow full `generated_output`.
 * Fallback: legacy cover/body/cta keys.
 */
export interface SlidesFromGeneratedOutputOptions {
  /** Mimic / structure_variables: prefer deck with this renderable slide count. */
  preferred_slide_count?: number | null;
}

export function slidesFromGeneratedOutput(
  gen: Record<string, unknown>,
  opts?: SlidesFromGeneratedOutputOptions
): Record<string, unknown>[] {
  let base = gen;
  if (gen.package_type === "mimic_carousel_package") {
    const copy =
      gen.copy && typeof gen.copy === "object" && !Array.isArray(gen.copy)
        ? (gen.copy as Record<string, unknown>)
        : null;
    if (copy && (copy.carousel != null || copy.slides != null)) {
      base = { ...copy, package_type: gen.package_type };
    }
  }
  const preferred =
    opts?.preferred_slide_count ??
    (() => {
      const sv =
        gen.structure_variables && typeof gen.structure_variables === "object" && !Array.isArray(gen.structure_variables)
          ? (gen.structure_variables as Record<string, unknown>)
          : null;
      const n = sv?.slide_count;
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    })();
  const candidates = collectRenderableSlideDecks(base);
  if (candidates.length === 0) return legacyCoverBodyCtaSlides(gen);
  const picked =
    candidates.length === 1
      ? candidates[0]!.slides
      : pickBestSlideDeck(candidates, preferred);
  return normalizeSlideRoles(picked);
}

/** Merge lab / editorial copy onto one carousel slide row (by slide_index or array slot). */
export function mergeSlideCopyAtCarouselIndex(
  slides: Record<string, unknown>[],
  slideIndex1Based: number,
  patch: Record<string, unknown>
): Record<string, unknown>[] {
  const want = Math.max(1, Math.floor(slideIndex1Based));
  const out = slides.map((s) => ({ ...(s as Record<string, unknown>) }));
  for (let i = 0; i < out.length; i++) {
    const rec = out[i]!;
    const si = Number(rec.slide_index ?? rec.slide_number ?? 0);
    if (Number.isFinite(si) && si > 0 && si === want) {
      out[i] = { ...rec, ...patch, slide_index: si };
      return out;
    }
  }
  const idx = Math.max(0, Math.min(out.length - 1, want - 1));
  out[idx] = { ...(out[idx] ?? {}), ...patch, slide_index: want };
  return out;
}

/** Match LLM slide row to 1-based carousel output index (`slide_index` / `slide_number`, else array slot). */
export function pickSlideByCarouselIndex(
  slides: Record<string, unknown>[],
  slideIndex1Based: number
): Record<string, unknown> {
  if (!Array.isArray(slides) || slides.length === 0) return {};
  const want = Math.max(1, Math.floor(slideIndex1Based));
  for (const raw of slides) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const si = Number(rec.slide_index ?? rec.slide_number ?? 0);
    if (Number.isFinite(si) && si > 0 && si === want) return rec;
  }
  const idx = Math.max(0, Math.min(slides.length - 1, want - 1));
  return (slides[idx] ?? {}) as Record<string, unknown>;
}

/** Align slide rows 1..N for mimic render — pad missing LLM rows without dropping planned frames. */
export function alignSlidesToMimicOutputCount(
  allSlides: Record<string, unknown>[],
  renderableSlides: Record<string, unknown>[],
  targetCount: number
): Record<string, unknown>[] {
  const n = Math.max(1, Math.floor(targetCount));
  const primary = renderableSlides.length > 0 ? renderableSlides : allSlides;
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i <= n; i++) {
    const fromRenderable = pickSlideByCarouselIndex(primary, i);
    const fromAll = pickSlideByCarouselIndex(allSlides, i);
    const row = slideHasRenderableContent(fromRenderable)
      ? fromRenderable
      : slideHasRenderableContent(fromAll)
        ? fromAll
        : fromRenderable;
    out.push({ ...row, slide_index: i });
  }
  return out;
}

function looksLikeCarouselCtaSlideText(s: string): boolean {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return false;
  if (/@[a-z0-9_.]{2,}/i.test(t)) return true;
  if (/(follow|save|share|comment|dm|subscribe|link in bio|tap|swipe)\b/i.test(t)) return true;
  return false;
}

function ensureCarouselHasCtaSlide(
  slides: Record<string, unknown>[],
  ctaOptions?: CarouselRenderCtaOptions
): Record<string, unknown>[] {
  if (slides.length < 2) return slides;

  const last = slides[slides.length - 1] ?? {};
  const tl = textFromSlide(last as Record<string, unknown>);
  const lastText = `${tl.headline}\n${tl.body}`.trim();
  // Many carousel generations end with a non-CTA "sign off" or generic statement. Editorial requires
  // a closing CTA slide. When the last slide doesn't look like CTA copy, append an explicit CTA slide.
  if (looksLikeCarouselCtaSlideText(lastText)) return slides;

  const handle = formatInstagramHandleForCta(ctaOptions?.instagramHandle ?? null);
  // For multi-slide decks, preserve slide count (tests + renderer expect stable indices).
  // Instead, coerce the *existing* last slide into a CTA slide by filling in default CTA copy.
  if (slides.length > 2) {
    const patchedLast = normalizeItemSlide({
      ...(last as Record<string, unknown>),
      slide_role: "cta",
      headline: tl.headline || "",
      body: tl.body || DEFAULT_CAROUSEL_CTA_COPY,
      ...(handle ? { handle } : {}),
    });
    return [...slides.slice(0, -1), patchedLast];
  }

  // For 2-slide decks, add a dedicated CTA slide so the arc is cover → body → CTA.
  const ctaSlide = normalizeItemSlide({
    slide_role: "cta",
    headline: "",
    body: DEFAULT_CAROUSEL_CTA_COPY,
    ...(handle ? { handle } : {}),
  });
  return [...slides, ctaSlide];
}

/**
 * Carousel .hbs templates render a fixed DOM: one cover `.slide`, `{{#each body_slides}}`, one CTA `.slide`.
 * LLM output is usually a flat `slides[]` with no `body_slides` — without mapping, only cover+CTA exist (2 slides)
 * while the pipeline loops `slide_count` times → "Slide index N out of range".
 */
export function needsBodySlidesMaterialization(renderBase: Record<string, unknown>): boolean {
  const bs = renderBase.body_slides;
  if (!Array.isArray(bs) || bs.length === 0) return true;
  return !bs.some((s) => s && typeof s === "object" && slideHasRenderableContent(s as Record<string, unknown>));
}

/** DOM slide count if templates use existing `cover_slide` + `body_slides` + `cta_slide` (no flat `slides[]` mapping). */
function explicitTemplateDomSlideCount(base: Record<string, unknown>): number | null {
  const bs = usableSlideArray(base.body_slides);
  if (!bs || bs.length === 0) return null;
  return 1 + bs.length + 1;
}

/**
 * True when we must map flat `slides[]` into `cover_slide` / `body_slides` / `cta_slide`.
 * Also true when `candidate_data` carries a short `body_slides` but `generated_output.slides` has more rows
 * (otherwise slide_count loops past the 2–3 DOM nodes the template actually emits).
 */
export function shouldMaterializeCarouselTemplateShape(base: Record<string, unknown>): boolean {
  if (needsBodySlidesMaterialization(base)) return true;
  const flat = slidesFromGeneratedOutput(base);
  const nFlat = flat.length;
  if (nFlat <= 0) return false;
  const explicit = explicitTemplateDomSlideCount(base);
  if (explicit == null) return true;
  return nFlat !== explicit;
}

/**
 * True when this render job uses per-slide full-bleed mimic overlays (no healthcard panel defaults).
 */
export function isMimicFullBleedCarouselRenderBase(base: Record<string, unknown>): boolean {
  const ctx = base.mimic_render_context;
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    const mode = String((ctx as Record<string, unknown>).mode ?? "").trim();
    if (mode === "carousel_visual") return true;
    const seq = String((ctx as Record<string, unknown>).render_sequence ?? "").trim();
    if (seq === "visual_plate_then_hbs_overlay" || seq === "per_slide_visual_mimic") return true;
  }
  const mimic = base.mimic_v1;
  if (mimic && typeof mimic === "object" && !Array.isArray(mimic)) {
    if (String((mimic as Record<string, unknown>).mode ?? "").trim() === "carousel_visual") return true;
  }
  return base.draft_package_type === "mimic_carousel_package";
}

/**
 * Map flat `slides[]` into `cover_slide` + `body_slides` + `cta_slide` for Handlebars templates.
 * - 1 slide: cover only + empty CTA shell (renderer still emits a CTA `.slide` → 2 DOM slides).
 * - 2+ slides: first = cover, last = CTA, middle = body_slides (may be empty when N===2).
 */
export function splitFlatSlidesToTemplateShape(
  allSlides: Record<string, unknown>[],
  opts?: { skipPanelDefaults?: boolean }
): {
  cover_slide: Record<string, unknown>;
  body_slides: Record<string, unknown>[];
  cta_slide: Record<string, unknown>;
} {
  if (allSlides.length === 0) {
    return { cover_slide: {}, body_slides: [], cta_slide: {} };
  }
  const skipPanels = opts?.skipPanelDefaults === true;
  const first = allSlides[0]!;
  const tf = textFromSlide(first);
  const coverBodyRaw = tf.body || String(first.body ?? "").trim();
  const coverBody = shortenCoverBody(coverBodyRaw);
  const coverHeadline = coverHeadlineFallback(tf.headline || String(first.headline ?? "").trim(), coverBody);
  const cover_slide = {
    ...first,
    headline: coverHeadline || tf.headline || first.headline,
    body: coverBody || tf.body || first.body,
  };
  const cover_slide_with_panel = skipPanels
    ? cover_slide
    : ensurePanelFields(cover_slide, {
        title: "Quick note",
        body: "Save this. You’ll want it when you’re overthinking later.",
      });
  if (allSlides.length === 1) {
    return { cover_slide: cover_slide_with_panel, body_slides: [], cta_slide: {} };
  }
  const last = allSlides[allSlides.length - 1]!;
  const tl = textFromSlide(last);
  const mid = allSlides.slice(1, -1);
  const body_slides = mid.map((s) => {
    const t = textFromSlide(s);
    const slideIdx0 = Number((s as Record<string, unknown>)?.index);
    const idx =
      Number.isFinite(slideIdx0) && slideIdx0 >= 0
        ? slideIdx0
        : 1 + mid.indexOf(s);
    return {
      ...s,
      headline: t.headline || s.headline,
      body: t.body || s.body,
      ...(skipPanels
        ? {}
        : ensurePanelFields(s as Record<string, unknown>, {
            title: "Micro-action",
            body: deriveMicroActionPanelBody(
              t.headline || String(s.headline ?? ""),
              t.body || String(s.body ?? ""),
              idx
            ),
          })),
    };
  });
  const rawHandle = String((last as Record<string, unknown>).handle ?? "").trim();
  const handleLooksValid =
    /^@[a-z0-9_.]{2,}$/i.test(rawHandle) ||
    // tolerate "instagram.com/name" style in `handle` fields (normalize elsewhere)
    /instagram\.com\/[a-z0-9_.]{2,}/i.test(rawHandle);
  const cta_slide = {
    ...last,
    headline: tl.headline || last.headline,
    // CTA panel copy should come from the slide body (or headline if body missing).
    body: tl.body || tl.headline || last.body || last.headline,
    // Only populate the template "handle line" when the source actually looks like a handle.
    ...(handleLooksValid ? { handle: rawHandle } : {}),
  };
  return { cover_slide: cover_slide_with_panel, body_slides, cta_slide };
}

/** Pass merged `{ ...candidate_data, ...generated_output, ...render }` from the job pipeline when available. */
export function carouselSlideCount(renderBase: Record<string, unknown>): number {
  const slides = slidesFromGeneratedOutput(renderBase);
  const n = slides.length;

  if (shouldMaterializeCarouselTemplateShape(renderBase)) {
    if (n === 0) {
      const sc = Number(renderBase.slide_count);
      if (Number.isFinite(sc) && sc >= 1) return Math.min(20, Math.floor(sc));
      return 1;
    }
    return n === 1 ? 2 : n;
  }

  const bs = usableSlideArray(renderBase.body_slides);
  if (bs && bs.length > 0) {
    return 1 + bs.length + 1;
  }

  if (n > 0) return n;
  const sc = Number(renderBase.slide_count);
  if (Number.isFinite(sc) && sc >= 1) return Math.min(20, Math.floor(sc));
  return 1;
}

/** Shown on the last carousel slide when the model leaves CTA copy empty. */
export const DEFAULT_CAROUSEL_CTA_COPY = "Follow for more · Save this · Share with someone who needs it";

export type CarouselRenderCtaOptions = {
  /** Strategy `instagram_handle`: username, @name, or instagram.com/… URL. */
  instagramHandle?: string | null;
  /** Overrides DEFAULT_CAROUSEL_CTA_COPY when CTA text is missing. */
  defaultCtaCopy?: string;
  /** `caf_core.projects.display_name` or slug — injected as `project_display_name` for cover branding. */
  projectDisplayName?: string | null;
};

function resolveCarouselCtaFields(
  base: Record<string, unknown>,
  templateShape: Record<string, unknown>,
  allSlides: Record<string, unknown>[],
  opts?: CarouselRenderCtaOptions
): { cta_text: string; cta_handle: string; cta_slide: Record<string, unknown> } {
  const coerceText = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
    if (typeof v === "object" && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      // If an LLM returned an object where a string was expected, try to recover readable text.
      const tf = textFromSlide(rec);
      const pick = tf.body.trim() || tf.headline.trim();
      if (pick) return pick;
      const raw = rec.text ?? rec.content ?? rec.body ?? rec.headline ?? rec.title ?? rec.heading;
      if (typeof raw === "string") return raw.trim();
      return "";
    }
    return "";
  };

  const defaultCopy = (opts?.defaultCtaCopy ?? DEFAULT_CAROUSEL_CTA_COPY).trim();
  const projectHandle = formatInstagramHandleForCta(opts?.instagramHandle ?? null);

  const rawShapeCta =
    templateShape.cta_slide && typeof templateShape.cta_slide === "object" && !Array.isArray(templateShape.cta_slide)
      ? (templateShape.cta_slide as Record<string, unknown>)
      : base.cta_slide && typeof base.cta_slide === "object" && !Array.isArray(base.cta_slide)
        ? (base.cta_slide as Record<string, unknown>)
        : null;
  const fromShape = rawShapeCta ? { ...rawShapeCta } : ({} as Record<string, unknown>);

  /**
   * Some decks (notably mimic/listicle carousels) do not have a real CTA frame.
   * In those cases, the template still renders a terminal "CTA" DOM node, but the
   * desired UX is "last content slide" (headline + one supporting line), not a
   * generic "Follow / Save / Share" CTA.
   *
   * When the last slide looks like content (no CTA verbs, no @handle), prefer:
   * - CTA headline = last slide headline/title
   * - CTA sub line  = last slide body/subtitle
   */
  const contentStyleCtaFromShape = (() => {
    const t = textFromSlide(fromShape);
    const h = t.headline.trim();
    const b = t.body.trim();
    if (!h || !b) return null;
    const combined = `${h}\n${b}`.trim();
    if (looksLikeCarouselCtaSlideText(combined)) return null;
    // Treat short, uppercase headings as content titles (e.g. "LIBRA", "TIP 7").
    // Avoid triggering on normal sentence-case headings ("How to X") where templates expect CTA behavior.
    const words = h.split(/\s+/).filter(Boolean);
    const looksLikeLabel =
      h.length >= 3 &&
      h.length <= 18 &&
      words.length <= 2 &&
      /[A-Z]/.test(h) &&
      h === h.toUpperCase() &&
      !/[.!?]$/.test(h) &&
      !/\d/.test(h);
    if (!looksLikeLabel) return null;
    return { headline: stripAirQuotesFromSlideCopy(h), body: stripAirQuotesFromSlideCopy(b) };
  })();

  // Prefer CTA copy from the last slide object (review UI edits this), then fall back to legacy `cta_text`.
  let ctaText =
    contentStyleCtaFromShape?.headline ??
    (coerceText(fromShape.body) ||
      textFromSlide(fromShape).body.trim() ||
      textFromSlide(fromShape).headline.trim());
  if (!ctaText) ctaText = coerceText(base.cta_text);
  // With a single usable row, the DOM is still cover + CTA panel; that row is the cover — do not reuse it as CTA copy.
  if (!ctaText && allSlides.length > 1) {
    const last = allSlides[allSlides.length - 1]!;
    const tl = textFromSlide(last);
    ctaText = String(tl.headline || tl.body || "").trim();
  }
  if (!ctaText) ctaText = defaultCopy;
  ctaText = stripAirQuotesFromSlideCopy(ctaText);
  // Last-resort guardrail: never let non-text objects stringify into templates.
  if (ctaText.trim() === "[object Object]") ctaText = defaultCopy;

  // CTA slide UX: templates often render `cta_text` as a large headline. If the generator puts a long
  // paragraph in the last slide body, it becomes unreadable. Prefer a short imperative line instead.
  const looksTooLongForCtaHeadline = (t: string): boolean => {
    const s = String(t ?? "").trim();
    if (!s) return false;
    if (s.includes("\n")) return true;
    // Many templates style CTA as a large headline; keep it punchy.
    if (s.length > 90) return true;
    // Multiple sentences tends to read like a paragraph (esp. with periods).
    const sentenceish = (s.match(/[.!?](?:\s|$)/g) ?? []).length;
    return sentenceish >= 2;
  };
  const shortenCtaHeadline = (t: string): string => {
    const s = String(t ?? "").trim().replace(/\s+/g, " ");
    if (!s) return "";
    const firstSentence = s.split(/(?<=[.!?])\s+/)[0]?.trim() ?? s;
    const max = 110;
    const clipped = firstSentence.length > max ? `${firstSentence.slice(0, max).trimEnd()}…` : firstSentence;
    return clipped;
  };
  const originalCtaText = ctaText;
  if (looksTooLongForCtaHeadline(ctaText)) {
    const last = allSlides.length > 0 ? (allSlides[allSlides.length - 1]! as Record<string, unknown>) : null;
    const lastHeadline = last ? textFromSlide(last).headline.trim() : "";
    const candidate = shortenCtaHeadline(lastHeadline || ctaText);
    ctaText = candidate || defaultCopy;
  }

  let ctaHandle = String(base.cta_handle ?? "").trim();
  if (!ctaHandle) {
    ctaHandle = String(fromShape.handle ?? "").trim();
  }
  if (!ctaHandle && allSlides.length > 1) {
    const last = allSlides[allSlides.length - 1]!;
    const h = String(last.handle ?? "").trim();
    if (h) ctaHandle = h;
    else {
      const tl = textFromSlide(last);
      const b = String(tl.body ?? "").trim();
      if (b.startsWith("@")) ctaHandle = b;
    }
  }
  if (!ctaHandle && projectHandle) ctaHandle = projectHandle;

  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripHandleFromText = (t: string, handle: string): string => {
    const raw = String(t ?? "").trim();
    const h = String(handle ?? "").trim();
    if (!raw || !h) return raw;
    // Remove the handle token anywhere (common drift: "@brand" appended to CTA headline).
    const re = new RegExp(`(?:^|\\s)${escapeRegex(h)}(?:\\s|$)`, "gi");
    return raw.replace(re, " ").replace(/\s{2,}/g, " ").trim();
  };

  // Requirement: CTA headline must NOT include the @handle. Handle belongs in CTA body text.
  if (ctaHandle) {
    ctaText = stripHandleFromText(ctaText, ctaHandle);
    if (!ctaText) ctaText = defaultCopy;
  }

  // Ensure CTA body text always exists and ends with the @handle when available.
  // Templates should render `cta_slide.sub` as the CTA body line.
  let subText = coerceText(fromShape.sub);
  if (!subText) {
    if (contentStyleCtaFromShape?.body) {
      subText = contentStyleCtaFromShape.body;
    } else {
    // When we shortened the CTA headline, preserve the full copy here; otherwise use the default CTA copy.
      subText = originalCtaText && originalCtaText !== ctaText ? originalCtaText : defaultCopy;
    }
  }
  subText = stripAirQuotesFromSlideCopy(subText);
  subText = stripHandleFromText(subText, ctaHandle);
  if (ctaHandle) {
    subText = `${subText} ${ctaHandle}`.trim();
  }

  const { handle: _oldHandle, ...fromShapeNoHandle } = fromShape;
  const cta_slide = {
    ...fromShapeNoHandle,
    body: ctaText,
    sub: subText,
  };

  // Templates such as `carousel_sns_bold_text` render `cta_text` and `cta_handle` inline; avoid a second visible handle.
  let effHandle = ctaHandle;
  if (effHandle && ctaText.includes(effHandle)) {
    effHandle = "";
  }

  // Keep `cta_handle` for backward compatibility, but templates should prefer `cta_slide.sub`
  // so the handle appears in the CTA body line (not in the headline).
  return { cta_text: ctaText, cta_handle: effHandle, cta_slide };
}

/**
 * After we have usable slide rows, drop other deck-shaped fields so `pickBestSlideDeck` / `slide_count`
 * cannot pick empty stubs or inflate PNG count past real copy. Same shape as job-pipeline carousel render.
 */
export function carouselRenderBaseForPipeline(
  baseRender: Record<string, unknown>,
  usableSlides: Record<string, unknown>[]
): Record<string, unknown> {
  const o: Record<string, unknown> = { ...baseRender, slides: usableSlides };
  delete o.body_slides;
  delete o.cover_slide;
  delete o.cta_slide;
  delete o.slide_count;
  if (o.structure_variables && typeof o.structure_variables === "object" && !Array.isArray(o.structure_variables)) {
    const sv = { ...(o.structure_variables as Record<string, unknown>) };
    delete sv.slide_count;
    if (Object.keys(sv).length > 0) o.structure_variables = sv;
    else delete o.structure_variables;
  }
  delete o.slide_deck;
  delete o.variation;
  delete o.variations;
  delete o.carousel;
  delete o.items;
  const content = o.content;
  if (content && typeof content === "object" && !Array.isArray(content) && "carousel" in content) {
    const c = { ...(content as Record<string, unknown>) };
    delete c.carousel;
    if (Object.keys(c).length > 0) o.content = c;
    else delete o.content;
  }
  return o;
}

/**
 * Legacy `generated_output.cover` is sometimes an object `{ headline, cover_subtitle, kicker }`.
 * Templates that do `{{#if cover}}{{cover}}` stringify it as "[object Object]". Sync string fields from `cover_slide`.
 */
export function synchronizeCoverRootStringFields(ctx: Record<string, unknown>): void {
  let headline = "";
  let subtitle = "";

  const cs = ctx.cover_slide;
  if (cs && typeof cs === "object" && !Array.isArray(cs)) {
    const rec = cs as Record<string, unknown>;
    headline = String(rec.headline ?? rec.title ?? "").trim();
    subtitle = String(rec.body ?? "").trim();
  }

  const cov = ctx.cover;
  if (cov != null && typeof cov === "object" && !Array.isArray(cov)) {
    const rec = cov as Record<string, unknown>;
    if (!headline) headline = String(rec.headline ?? rec.title ?? "").trim();
    if (!subtitle) subtitle = String(rec.cover_subtitle ?? rec.subtitle ?? rec.body ?? "").trim();
  } else if (typeof cov === "string" && cov.trim()) {
    if (!headline) headline = cov.trim();
  }

  const existingSub = ctx.cover_subtitle;
  if (typeof existingSub === "string" && existingSub.trim() && !subtitle) subtitle = existingSub.trim();

  if (headline) ctx.cover = headline;
  else if (ctx.cover != null && typeof ctx.cover === "object") delete ctx.cover;

  if (subtitle) ctx.cover_subtitle = subtitle;
}

/**
 * Merge base render context with one slide highlighted for multi-slide templates.
 * `ctaOptions` fills last-slide CTA copy and @handle from project strategy when the LLM omits them.
 */
export async function inlineRemoteImageUrlForRenderer(
  url: string,
  config?: import("../config.js").AppConfig
): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  let buf: Buffer;
  let mimeType = "image/png";
  if (config) {
    const { downloadBufferFromUrl } = await import("./supabase-storage.js");
    buf = await downloadBufferFromUrl(config, trimmed);
    if (/\.jpe?g(?:\?|$)/i.test(trimmed)) mimeType = "image/jpeg";
  } else {
    const res = await fetch(trimmed, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Failed to inline carousel background (${res.status}): ${trimmed.slice(0, 120)}`);
    }
    mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || mimeType;
    buf = Buffer.from(await res.arrayBuffer());
  }
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

export interface WithInlinedBackgroundImageOptions {
  /** When set, Supabase public URLs download via service-role storage (not anonymous GET). */
  config?: import("../config.js").AppConfig;
  /** Mimic template_bg: refuse plain-paper fallback when inline fails. */
  strict?: boolean;
}

/** Puppeteer renderer blocks https:// CSS backgrounds — inline as data: URI before POST /render-binary. */
export async function withInlinedBackgroundImage(
  base: Record<string, unknown>,
  opts?: WithInlinedBackgroundImageOptions
): Promise<Record<string, unknown>> {
  const bg = typeof base.background_image_url === "string" ? base.background_image_url.trim() : "";
  if (!bg || bg.startsWith("data:")) return base;
  try {
    return { ...base, background_image_url: await inlineRemoteImageUrlForRenderer(bg, opts?.config) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts?.strict) {
      throw new Error(
        `Mimic background plate inline failed — refusing plain-paper composite: ${msg}`
      );
    }
    console.warn(
      "[carousel-render] background inline failed; renderer may show plain paper:",
      msg
    );
    return base;
  }
}

export function buildSlideRenderContext(
  base: Record<string, unknown>,
  allSlides: Record<string, unknown>[],
  slideIndex1Based: number,
  ctaOptions?: CarouselRenderCtaOptions
): Record<string, unknown> {
  const slides = ensureCarouselHasCtaSlide(allSlides, ctaOptions);
  // Some Flow_Carousel_Copy generations leak placeholder thread labels ("Template", "Thread") into slide.name.
  // Treat them as empty so templates can fall back to `handle` (project IG).
  const sanitizeThreadName = (name: unknown): string => {
    const t = String(name ?? "").trim();
    if (!t) return "";
    const lower = t.toLowerCase();
    if (lower === "template" || lower === "thread") return "";
    return t;
  };
  for (const s of slides) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const rec = s as Record<string, unknown>;
    if (rec.name != null) {
      const sn = sanitizeThreadName(rec.name);
      if (sn) rec.name = sn;
      else delete rec.name;
    }
  }
  const totalDomSlides = carouselSlideCount({ ...base, slides });
  let current: Record<string, unknown>;
  if (slides.length === 1 && slideIndex1Based === totalDomSlides && totalDomSlides > 1) {
    current = {};
  } else {
    current = pickSlideByCarouselIndex(slides, slideIndex1Based);
  }
  const currentRec = current as Record<string, unknown>;
  let { headline, body } = textFromSlide(currentRec);
  if (slideHasPositionedTextBlocks(currentRec)) {
    headline = "";
    body = "";
  }
  const templateShape =
    shouldMaterializeCarouselTemplateShape(base) && slides.length > 0
      ? splitFlatSlidesToTemplateShape(slides, {
          skipPanelDefaults: isMimicFullBleedCarouselRenderBase(base),
        })
      : {};
  // Some generators provide `cover_slide.name` (or `cover_slide.status`) as whitespace or placeholders.
  // Normalize here so templates can reliably fall back to `handle` or defaults.
  const sanitizeCoverSlide = (cs: unknown): Record<string, unknown> => {
    if (!cs || typeof cs !== "object" || Array.isArray(cs)) return {};
    const rec: Record<string, unknown> = { ...(cs as Record<string, unknown>) };
    if (rec.name != null) {
      const sn = sanitizeThreadName(rec.name);
      if (sn) rec.name = sn;
      else delete rec.name;
    }
    if (rec.status != null) {
      const st = String(rec.status ?? "").trim();
      if (st) rec.status = st;
      else delete rec.status;
    }
    return rec;
  };
  const sanitizedBaseCoverSlide =
    base.cover_slide && typeof base.cover_slide === "object" && !Array.isArray(base.cover_slide)
      ? sanitizeCoverSlide(base.cover_slide)
      : null;
  const sanitizedTemplateCoverSlide =
    (templateShape as Record<string, unknown>).cover_slide &&
    typeof (templateShape as Record<string, unknown>).cover_slide === "object" &&
    !Array.isArray((templateShape as Record<string, unknown>).cover_slide)
      ? sanitizeCoverSlide((templateShape as Record<string, unknown>).cover_slide)
      : null;
  const mergedCoverSlide =
    sanitizedBaseCoverSlide || sanitizedTemplateCoverSlide
      ? {
          ...(sanitizedBaseCoverSlide ?? {}),
          ...(sanitizedTemplateCoverSlide ?? {}),
        }
      : null;
  const cta = resolveCarouselCtaFields(base, templateShape, slides, ctaOptions);
  const projectDisplayName = String(ctaOptions?.projectDisplayName ?? "").trim();
  const baseRec = base as Record<string, unknown>;
  const renderRec =
    baseRec.render && typeof baseRec.render === "object" && !Array.isArray(baseRec.render)
      ? (baseRec.render as Record<string, unknown>)
      : null;
  const rawFontScale = baseRec.font_scale ?? renderRec?.font_scale;
  const fontScaleNum = Number(rawFontScale);
  const font_scale =
    Number.isFinite(fontScaleNum) && fontScaleNum > 0 ? Math.min(1.25, Math.max(0.75, fontScaleNum)) : 1;

  /**
   * Persisted `render.carousel_*` must not beat live reviewer overrides: preview payloads put px on the
   * root object while still carrying nested `render` from the job — merge render first, root last.
   */
  const typoPatch = {
    ...pickCarouselTypographyPatchForRender(renderRec),
    ...pickCarouselTypographyPatchForRender(baseRec),
  };

  const out: Record<string, unknown> = {
    ...base,
    ...templateShape,
    ...(mergedCoverSlide ? { cover_slide: mergedCoverSlide } : {}),
    cta_text: cta.cta_text,
    ...(cta.cta_handle ? { cta_handle: cta.cta_handle } : {}),
    cta_slide: cta.cta_slide,
    font_scale,
    ...typoPatch,
    slides,
    slide_index: slideIndex1Based,
    current_slide: current,
    headline,
    body,
    handle: String(current.handle ?? base.cta_handle ?? cta.cta_handle ?? ""),
    ...(projectDisplayName ? { project_display_name: projectDisplayName } : {}),
    ...(typeof baseRec.background_image_url === "string" && baseRec.background_image_url.trim()
      ? { background_image_url: baseRec.background_image_url.trim() }
      : {}),
  };

  synchronizeCoverRootStringFields(out);

  return out;
}

/** Copy fields for renderer / DocAI — always derived from slide row, never cleared for positioned blocks. */
export function slideHeadlineBodyForRender(slide: Record<string, unknown>): { headline: string; body: string } {
  return textFromSlide(unwrapMimicSlideRow(slide));
}

/**
 * When DocAI layers are unavailable, restore headline/body on render ctx and template-shaped fields
 * (`cover_slide` / `body_slides` / `cta_slide`) so carousel_mimic_bg HBS fallback is not blank.
 */
export function applySlideCopyToRenderContext(
  ctx: Record<string, unknown>,
  slideIndex1Based: number,
  copy: { headline: string; body: string }
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...ctx,
    headline: copy.headline,
    body: copy.body,
  };

  const want = Math.max(1, Math.floor(slideIndex1Based));
  const total = carouselSlideCount(next);

  if (want === 1) {
    if (next.cover_slide && typeof next.cover_slide === "object" && !Array.isArray(next.cover_slide)) {
      next.cover_slide = {
        ...(next.cover_slide as Record<string, unknown>),
        headline: copy.headline,
        body: copy.body,
      };
    }
    if (copy.headline) next.cover = copy.headline;
    if (copy.body) next.cover_subtitle = copy.body;
    synchronizeCoverRootStringFields(next);
    return next;
  }

  if (want === total && total > 1) {
    if (next.cta_slide && typeof next.cta_slide === "object" && !Array.isArray(next.cta_slide)) {
      next.cta_slide = {
        ...(next.cta_slide as Record<string, unknown>),
        body: copy.headline || copy.body,
        ...(copy.body ? { sub: copy.body } : {}),
      };
    }
    if (copy.headline) next.cta_text = copy.headline;
    return next;
  }

  const bodySlides = Array.isArray(next.body_slides) ? [...next.body_slides] : [];
  const bodyIdx = want - 2;
  if (bodyIdx >= 0 && bodyIdx < bodySlides.length) {
    const item = bodySlides[bodyIdx];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      bodySlides[bodyIdx] = {
        ...(item as Record<string, unknown>),
        headline: copy.headline,
        body: copy.body,
      };
      next.body_slides = bodySlides;
    }
  }
  return next;
}

export function templateNameFromPayload(generationPayload: Record<string, unknown>): string {
  const gen = pickGeneratedOutputOrEmptyFromPayload(generationPayload);
  const render = (gen.render as Record<string, unknown>) ?? (generationPayload.render as Record<string, unknown>) ?? {};
  return String(
    render.html_template_name ?? render.template_key ?? generationPayload.template ?? "default"
  );
}

/**
 * Non-empty template name from payload when the author explicitly chose something other than the generic default.
 * (Renderer accepts names with or without `.hbs`.)
 */
export function explicitCarouselTemplateBaseName(generationPayload: Record<string, unknown>): string | null {
  const raw = templateNameFromPayload(generationPayload).trim();
  if (!raw) return null;
  const base = raw.replace(/\.hbs$/i, "").trim();
  if (!base || base.toLowerCase() === "default") return null;
  return base;
}

/** Payload key: after NEEDS_EDIT + “change template”, next render avoids re-picking the same `.hbs`. */
export const CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY = "carousel_template_exclude_for_next_render";

function normalizeCarouselTemplateBase(name: string): string {
  return name.replace(/\.hbs$/i, "").trim().toLowerCase();
}

/** Stable index into a pool of size `n` from a seed string (FNV-1a 32-bit). */
function stablePoolIndexFromSeed(poolSize: number, seed: string): number {
  if (!Number.isFinite(poolSize) || poolSize <= 0) return 0;
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % poolSize;
}

function normalizeTemplateAllowlistBases(allowlist: string[] | undefined): string[] {
  if (!allowlist || allowlist.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of allowlist) {
    const base = normalizeCarouselTemplateBase(String(raw ?? ""));
    if (!base) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

/**
 * Reviewer asked for a different carousel layout on the next full generation/render pass.
 * Prefer explicit `overrides_json.carousel_rework_change_template` from Review (default: keep).
 * Legacy: tag `carousel_template_change` / `change_template`, or notes containing “change template”.
 */
export function reviewRequestsCarouselTemplateChange(review: {
  rejection_tags?: unknown;
  notes?: string | null;
  overrides_json?: Record<string, unknown> | null;
}): boolean {
  const ov = review.overrides_json;
  if (ov && typeof ov === "object") {
    if (ov.carousel_rework_change_template === false) return false;
    if (ov.carousel_rework_change_template === true) return true;
  }
  const tags = Array.isArray(review.rejection_tags)
    ? (review.rejection_tags as unknown[]).map((t) => String(t).toLowerCase().trim())
    : [];
  if (
    tags.some(
      (t) =>
        t === "carousel_template_change" ||
        t === "change_template" ||
        t.includes("change_template") ||
        /\bchange\s+template\b/.test(t)
    )
  ) {
    return true;
  }
  const notes = (review.notes ?? "").toLowerCase();
  return /\bchange\s+template\b/.test(notes);
}

/**
 * Removes explicit template selection from payload (and nested `generated_output.render` if present)
 * so the next render pass can pick again. Returns the previous explicit base name for exclusion.
 */
export function stripExplicitCarouselTemplateSelection(gp: Record<string, unknown>): string | null {
  const prev = explicitCarouselTemplateBaseName(gp);
  delete gp.template;
  const stripRender = (holder: Record<string, unknown>): void => {
    const rawRender = holder.render;
    if (!rawRender || typeof rawRender !== "object" || Array.isArray(rawRender)) return;
    const render = rawRender as Record<string, unknown>;
    delete render.html_template_name;
    delete render.template_key;
    if (Object.keys(render).length === 0) delete holder.render;
  };
  stripRender(gp);
  const gen = gp.generated_output;
  if (gen && typeof gen === "object" && !Array.isArray(gen)) stripRender(gen as Record<string, unknown>);
  return prev;
}

export function setCarouselTemplateExcludeForNextRender(
  gp: Record<string, unknown>,
  excludeBase: string | null
): void {
  const k = CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY;
  if (!excludeBase?.trim()) {
    delete gp[k];
    return;
  }
  gp[k] = excludeBase.replace(/\.hbs$/i, "").trim();
}

/**
 * Use the payload template when set; otherwise `GET {renderer}/templates` and pick uniformly at random
 * from available `.hbs` options (local templates folder + optional remote list from the renderer).
 */
export async function pickCarouselTemplateForRender(
  rendererBaseUrl: string,
  generationPayload: Record<string, unknown>,
  opts?: {
    /**
     * Project-pinned templates (names with or without `.hbs`). When provided, implicit/random selection is
     * restricted to this allowlist instead of the renderer's full template library.
     */
    allowedTemplates?: string[];
    /**
     * When no explicit template is set, pick deterministically from the pool so the same job does not
     * flip between layouts across re-renders (implicit selection used to be uniformly random).
     */
    implicitPickSeed?: string | null;
  }
): Promise<string> {
  const explicit = explicitCarouselTemplateBaseName(generationPayload);
  if (explicit) return explicit;

  const excludeRaw = generationPayload[CAROUSEL_TEMPLATE_EXCLUDE_FOR_NEXT_RENDER_KEY];
  const exclude =
    typeof excludeRaw === "string" && excludeRaw.trim()
      ? normalizeCarouselTemplateBase(excludeRaw)
      : "";

  const allowedBases = normalizeTemplateAllowlistBases(opts?.allowedTemplates);
  const allowedSet = allowedBases.length ? new Set(allowedBases) : null;

  const base = rendererBaseUrl.replace(/\/$/, "");
  let templates: string[] = [];
  try {
    const res = await fetch(`${base}/templates`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const d = (await res.json()) as { templates?: string[] };
      templates = (d.templates ?? []).filter((t) => typeof t === "string" && t.endsWith(".hbs"));
    }
  } catch {
    // fall through to default
  }

  // If the project has pinned templates, prefer them even when the renderer's list is missing/unreachable.
  if (templates.length === 0) {
    if (allowedBases.length > 0) return allowedBases[randomInt(allowedBases.length)]!;
    return "default";
  }

  let pool = templates;
  if (allowedSet) {
    const filtered = templates.filter((t) => allowedSet.has(normalizeCarouselTemplateBase(t)));
    // If none of the renderer-reported templates intersect the project pins, fall back to the pins anyway.
    // (The renderer still might support them even if it didn't list them, e.g. remote list disabled.)
    pool = filtered.length > 0 ? filtered : allowedBases.map((b) => `${b}.hbs`);
  }
  if (exclude) {
    const filtered = pool.filter((t) => normalizeCarouselTemplateBase(t) !== exclude);
    if (filtered.length > 0) pool = filtered;
  }

  const seed = typeof opts?.implicitPickSeed === "string" ? opts.implicitPickSeed.trim() : "";
  const idx =
    seed.length > 0 ? stablePoolIndexFromSeed(pool.length, seed) : randomInt(pool.length);
  const pick = pool[idx]!;
  return pick.replace(/\.hbs$/i, "");
}
