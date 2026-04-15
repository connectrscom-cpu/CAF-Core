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

const HEADLINE_KEYS = [
  "headline",
  "title",
  "heading",
  "slide_headline",
  "hook",
  "slide_hook",
  "main_title",
  "hero",
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

function textFromSlide(o: Record<string, unknown>): { headline: string; body: string } {
  const headline = HEADLINE_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
  let body = BODY_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
  if (body == null || String(body).trim() === "") {
    const fromBullets = bulletsToBody(o);
    if (fromBullets) body = fromBullets;
  }
  return {
    headline: stripStandaloneEmojiLines(String(headline ?? "").trim()),
    body: stripStandaloneEmojiLines(String(body ?? "").trim()),
  };
}

/** True if this slide would show meaningful text in the renderer (not just slide_role). */
export function slideHasRenderableContent(s: Record<string, unknown>): boolean {
  const { headline, body } = textFromSlide(s);
  return headline.length > 0 || body.length > 0;
}

function normalizeItemSlide(r: Record<string, unknown>): Record<string, unknown> {
  const tf = textFromSlide(r);
  return {
    ...r,
    ...(tf.headline ? { headline: tf.headline } : {}),
    ...(tf.body ? { body: tf.body } : {}),
    slide_role: r.slide_role ?? "body",
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

function slideDeckTextScore(slides: Record<string, unknown>[]): number {
  let t = 0;
  for (const s of slides) {
    const x = textFromSlide(s);
    t += x.headline.length + x.body.length;
  }
  return t;
}

type CarouselDeckId =
  | "slides"
  | "slide_deck"
  | "variation"
  | "variations"
  | "structure_slides"
  | "variation_content"
  | "carousel"
  | "items"
  | "content_slides"
  | "content_carousel";

/** Lower = preferred when total text is within `TIE_BAND_CHARS` (canonical LLM path vs parallel fields). */
const DECK_PRIORITY: Record<CarouselDeckId, number> = {
  slides: 0,
  slide_deck: 0,
  variation: 0,
  structure_slides: 0,
  variation_content: 0,
  content_slides: 0,
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

/**
 * Prefer much richer copy; when totals are close, prefer `slides` > `variations` > `carousel` > `items`
 * so planner `items` or a slightly longer `carousel[]` does not beat the main `slides[]`.
 */
function pickBestSlideDeck(tagged: TaggedSlideDeck[]): Record<string, unknown>[] {
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

  return out;
}

/**
 * Normalize generated carousel JSON into an ordered list of slide records for Handlebars.
 * Chooses the **richest** deck when multiple arrays exist (e.g. planner `items` stubs vs LLM `slides`),
 * so merged `candidate_data` does not shadow full `generated_output`.
 * Fallback: legacy cover/body/cta keys.
 */
export function slidesFromGeneratedOutput(gen: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = collectRenderableSlideDecks(gen);
  if (candidates.length === 0) return legacyCoverBodyCtaSlides(gen);
  if (candidates.length === 1) return candidates[0]!.slides;
  return pickBestSlideDeck(candidates);
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
  if (slides.length > 2) return slides; // conservative: don't mutate multi-slide decks

  const last = slides[slides.length - 1] ?? {};
  const tl = textFromSlide(last as Record<string, unknown>);
  const lastText = `${tl.headline}\n${tl.body}`.trim();
  if (looksLikeCarouselCtaSlideText(lastText)) return slides;

  const handle = formatInstagramHandleForCta(ctaOptions?.instagramHandle ?? null);
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
 * Map flat `slides[]` into `cover_slide` + `body_slides` + `cta_slide` for Handlebars templates.
 * - 1 slide: cover only + empty CTA shell (renderer still emits a CTA `.slide` → 2 DOM slides).
 * - 2+ slides: first = cover, last = CTA, middle = body_slides (may be empty when N===2).
 */
export function splitFlatSlidesToTemplateShape(
  allSlides: Record<string, unknown>[]
): {
  cover_slide: Record<string, unknown>;
  body_slides: Record<string, unknown>[];
  cta_slide: Record<string, unknown>;
} {
  if (allSlides.length === 0) {
    return { cover_slide: {}, body_slides: [], cta_slide: {} };
  }
  const first = allSlides[0]!;
  const tf = textFromSlide(first);
  const coverBody = tf.body || String(first.body ?? "").trim();
  const coverHeadline = coverHeadlineFallback(tf.headline || String(first.headline ?? "").trim(), coverBody);
  const cover_slide = {
    ...first,
    headline: coverHeadline || tf.headline || first.headline,
    body: coverBody || tf.body || first.body,
  };
  if (allSlides.length === 1) {
    return { cover_slide, body_slides: [], cta_slide: {} };
  }
  const last = allSlides[allSlides.length - 1]!;
  const tl = textFromSlide(last);
  const mid = allSlides.slice(1, -1);
  const body_slides = mid.map((s) => {
    const t = textFromSlide(s);
    return { ...s, headline: t.headline || s.headline, body: t.body || s.body };
  });
  const cta_slide = {
    ...last,
    headline: tl.headline || last.headline,
    body: tl.headline,
    handle: tl.body,
  };
  return { cover_slide, body_slides, cta_slide };
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
};

/** Normalize handle for carousel overlays (always leading @ when non-empty). */
export function formatInstagramHandleForCta(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m?.[1]) s = m[1]!;
  s = s.replace(/^@+/, "").replace(/\s+/g, "");
  if (!s) return "";
  return `@${s}`;
}

function resolveCarouselCtaFields(
  base: Record<string, unknown>,
  templateShape: Record<string, unknown>,
  allSlides: Record<string, unknown>[],
  opts?: CarouselRenderCtaOptions
): { cta_text: string; cta_handle: string; cta_slide: Record<string, unknown> } {
  const defaultCopy = (opts?.defaultCtaCopy ?? DEFAULT_CAROUSEL_CTA_COPY).trim();
  const projectHandle = formatInstagramHandleForCta(opts?.instagramHandle ?? null);

  const rawShapeCta =
    templateShape.cta_slide && typeof templateShape.cta_slide === "object" && !Array.isArray(templateShape.cta_slide)
      ? (templateShape.cta_slide as Record<string, unknown>)
      : base.cta_slide && typeof base.cta_slide === "object" && !Array.isArray(base.cta_slide)
        ? (base.cta_slide as Record<string, unknown>)
        : null;
  const fromShape = rawShapeCta ? { ...rawShapeCta } : ({} as Record<string, unknown>);

  let ctaText = String(base.cta_text ?? "").trim();
  if (!ctaText) {
    ctaText = String(fromShape.body ?? textFromSlide(fromShape).headline ?? "").trim();
  }
  // With a single usable row, the DOM is still cover + CTA panel; that row is the cover — do not reuse it as CTA copy.
  if (!ctaText && allSlides.length > 1) {
    const last = allSlides[allSlides.length - 1]!;
    const tl = textFromSlide(last);
    ctaText = String(tl.headline || tl.body || "").trim();
  }
  if (!ctaText) ctaText = defaultCopy;

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

  const cta_slide = {
    ...fromShape,
    body: ctaText,
    ...(ctaHandle ? { handle: ctaHandle } : {}),
  };

  return { cta_text: ctaText, cta_handle: ctaHandle, cta_slide };
}

/**
 * Merge base render context with one slide highlighted for multi-slide templates.
 * `ctaOptions` fills last-slide CTA copy and @handle from project strategy when the LLM omits them.
 */
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
  const idx =
    slides.length === 1 && slideIndex1Based === totalDomSlides && totalDomSlides > 1
      ? -1
      : Math.max(0, Math.min(slides.length - 1, slideIndex1Based - 1));
  const current = idx >= 0 ? (slides[idx] ?? {}) : {};
  const { headline, body } = textFromSlide(current);
  const templateShape =
    shouldMaterializeCarouselTemplateShape(base) && slides.length > 0 ? splitFlatSlidesToTemplateShape(slides) : {};
  const cta = resolveCarouselCtaFields(base, templateShape, slides, ctaOptions);

  const out: Record<string, unknown> = {
    ...base,
    ...templateShape,
    cta_text: cta.cta_text,
    ...(cta.cta_handle ? { cta_handle: cta.cta_handle } : {}),
    cta_slide: cta.cta_slide,
    slides,
    slide_index: slideIndex1Based,
    current_slide: current,
    headline,
    body,
    handle: String(current.handle ?? base.cta_handle ?? cta.cta_handle ?? ""),
  };

  return out;
}

export function templateNameFromPayload(generationPayload: Record<string, unknown>): string {
  const gen = (generationPayload.generated_output as Record<string, unknown>) ?? {};
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

/**
 * Use the payload template when set; otherwise `GET {renderer}/templates` and pick uniformly at random
 * from available `.hbs` options (local templates folder + optional remote list from the renderer).
 */
export async function pickCarouselTemplateForRender(
  rendererBaseUrl: string,
  generationPayload: Record<string, unknown>
): Promise<string> {
  const explicit = explicitCarouselTemplateBaseName(generationPayload);
  if (explicit) return explicit;

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

  if (templates.length === 0) return "default";

  const pick = templates[randomInt(templates.length)]!;
  return pick.replace(/\.hbs$/i, "");
}
