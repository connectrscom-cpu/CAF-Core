/**
 * Slide Intelligence Layer (SIL) — `slide_intelligence_v1`.
 *
 * A normalized, provider-agnostic description of *what each slide is doing* and
 * *why it works*, plus a deck-level `why_analysis_v1` synthesis. This is the
 * reusable "Why Mimic" core: it is computed once per reference (upstream),
 * carried on the signal pack, and projected per job. It is intentionally NOT a
 * fork of `MimicCarouselSlideGuideline` (`mimic-carousel-package.ts`) — it
 * normalizes the same upstream analysis into mechanism/intent terms.
 *
 * Two derivation paths are supported behind one schema:
 *  - `heuristic` (this module, zero added cost): derive from the Nemotron /
 *    Document AI analysis already stored in `aesthetic_analysis_json` + the
 *    row-level mechanism columns (`why_it_worked`, `primary_emotion`, …).
 *  - richer providers (`nemotron` / `openai`, future): a dedicated pass that
 *    fills the symbolic/curiosity fields the heuristic path leaves sparse.
 *
 * Everything carries `provider`, `confidence`, and `evidence_refs` so the
 * output is explainable and reviewable (and correctable from Review).
 */

import {
  isDeckThesisEchoOnSlide,
  isSlideIntelligenceStrategicThesisSufficient,
  isSlideIntelligenceVisualDescriptionSufficient,
  isSlideIntelligenceWhyItWorksSufficient,
  type SlideIntelligenceTextQualityOpts,
} from "./mimic-slide-analysis-quality.js";

export const SLIDE_INTELLIGENCE_SCHEMA = "slide_intelligence_v1" as const;
export const WHY_ANALYSIS_SCHEMA = "why_analysis_v1" as const;

/** Where on the job payload the per-job projection of SIL lives (inside `mimic_v1`). */
export const SLIDE_INTELLIGENCE_SLICE_KEY = "slide_intelligence" as const;
export const WHY_ANALYSIS_SLICE_KEY = "why_analysis" as const;

export type SlideIntelligenceProvider =
  | "nemotron"
  | "openai"
  | "document_ai_derived"
  | "heuristic";

export type SlideIntelligenceMediaKind = "carousel" | "image" | "video";

export interface SlideSymbolicElement {
  /** The depicted thing (e.g. "castle"). */
  element: string;
  /** Literal description (e.g. "a stone fortress on a hill"). */
  denotation: string | null;
  /** Strategic meanings (e.g. ["exclusivity", "mystery", "aspiration"]). */
  connotations: string[];
}

export interface SlideIntelligenceEvidenceRefs {
  insights_id: string | null;
  analysis_tier: string | null;
  /** Which stored field the row was derived from (audit/explainability). */
  source_field: string | null;
  /** Indices into the reference `text_blocks[]` this row drew on, when relevant. */
  text_block_indices?: number[];
}

export interface SlideIntelligenceV1 {
  schema_version: typeof SLIDE_INTELLIGENCE_SCHEMA;
  slide_index: number;
  source_slide_index: number | null;
  /** Role in the funnel: cover | hook | context | proof | list_item | objection | cta | body | … */
  slide_role: string | null;
  /** What the imagery does: background_mood | focal_subject | diagram | social_proof | … */
  visual_role: string | null;
  psychological_trigger: string | null;
  emotion: string | null;
  attention_device: string | null;
  curiosity_mechanism: string | null;
  persuasion_mechanism: string | null;
  /** This slide's job in the deck arc. */
  narrative_function: string | null;
  /** Reference frame imagery — composition, subjects, palette, mood (for reinterpretation, not copy). */
  visual_description: string | null;
  /** Archived on-screen copy transcript (meaning anchor; output must rephrase). */
  on_screen_text: string | null;
  symbolic_elements: SlideSymbolicElement[];
  why_it_works: string | null;
  provider: SlideIntelligenceProvider;
  evidence_refs: SlideIntelligenceEvidenceRefs;
  /** 0..1 — lower for heuristic-inferred fields, higher for explicit upstream fields. */
  confidence: number;
}

export interface WhyAnalysisV1 {
  schema_version: typeof WHY_ANALYSIS_SCHEMA;
  /** Ordered slide roles forming the persuasion spine. */
  narrative_spine: string[];
  dominant_mechanism: string | null;
  secondary_mechanisms: string[];
  /** Brand-neutral reason the *set* works — held constant during Brand Translation. */
  strategic_thesis: string | null;
  arc_summary: string | null;
  provider: SlideIntelligenceProvider;
  confidence: number;
  slide_count: number;
}

export interface SlideIntelligenceBundleV1 {
  schema_version: typeof SLIDE_INTELLIGENCE_SCHEMA;
  generated_at: string;
  media_kind: SlideIntelligenceMediaKind;
  provider: SlideIntelligenceProvider;
  source_insights_id: string | null;
  analysis_tier: string | null;
  slides: SlideIntelligenceV1[];
  why_analysis: WhyAnalysisV1 | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, max = 900): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function strList(v: unknown, max: number, cap = 120): string[] {
  const out: string[] = [];
  for (const x of asArray(v)) {
    const s = str(x, cap);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

/** Deck-level strategic thesis from Nemotron deck-wide fields (combination of slides, not slide 1 alone). */
export function resolveDeckStrategicThesis(input: {
  why_it_worked?: string | null;
  deck_as_whole_summary?: string | null;
  slide_arc?: string | null;
  cover_vs_body?: string | null;
  visual_consistency?: string | null;
}): string | null {
  const deckWhy = str(input.why_it_worked, 900);
  const deckSummary = str(input.deck_as_whole_summary, 900);
  const arc = str(input.slide_arc, 400);
  const coverVsBody = str(input.cover_vs_body, 400);
  const visualConsistency = str(input.visual_consistency, 400);

  const candidates: string[] = [];
  if (deckWhy && isSlideIntelligenceStrategicThesisSufficient(deckWhy)) candidates.push(deckWhy);
  if (deckSummary && isSlideIntelligenceStrategicThesisSufficient(deckSummary)) candidates.push(deckSummary);
  if (deckWhy && deckSummary) {
    const combined = `${deckWhy} ${deckSummary}`.replace(/\s+/g, " ").trim();
    if (isSlideIntelligenceStrategicThesisSufficient(combined)) candidates.push(combined);
  }
  if (arc && deckSummary) {
    const combined = `Arc: ${arc}. ${deckSummary}`;
    if (isSlideIntelligenceStrategicThesisSufficient(combined)) candidates.push(combined);
  }
  if (arc && coverVsBody && deckWhy) {
    const combined = `${deckWhy} Hook vs body: ${coverVsBody}. Arc: ${arc}.`;
    if (isSlideIntelligenceStrategicThesisSufficient(combined)) candidates.push(combined);
  }
  if (deckSummary && visualConsistency) {
    const combined = `${deckSummary} Visual system: ${visualConsistency}`;
    if (isSlideIntelligenceStrategicThesisSufficient(combined)) candidates.push(combined);
  }
  if (deckWhy) candidates.push(deckWhy);
  if (deckSummary) candidates.push(deckSummary);

  for (const c of candidates) {
    if (isSlideIntelligenceStrategicThesisSufficient(c)) return c;
  }
  return null;
}

const SIGN_AS_FOOD_ON_SCREEN = /^([a-z][a-z\s-]{1,20}?)\s+as\s+food\b/i;

/** `how you should text your {sign} friend` iMessage-meme series (uniform beats, no cover). */
const ZODIAC_TEXT_YOUR_FRIEND_ON_SCREEN =
  /\bhow you should text your\s+([a-z][a-z\s-]{0,18}?)\s+friend\b/i;

/** Common food nouns for detecting when a deck thesis overfits one dish. */
const FOOD_TERM_RE =
  /\b(pasta|penne|rigatoni|spaghetti|linguine|fettuccine|macaroni|fries|french fries|chicken|burger|pizza|taco|sushi|ramen|noodles|steak|salad|sandwich|toast|eggs|bacon|cheese|bread|soup|curry|rice|dumpling|waffle|pancake|donut|doughnut|cake|cookie|seafood|fish|shrimp|lobster|crab)\b/gi;

function slideEvidenceText(slide: SlideIntelligenceV1): string {
  return [slide.on_screen_text, slide.visual_description, slide.narrative_function]
    .filter(Boolean)
    .join(" ");
}

function extractFoodTerms(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(FOOD_TERM_RE)) {
    const term = m[0].toLowerCase().replace(/\s+/g, " ");
    if (!out.includes(term)) out.push(term);
  }
  return out;
}

/** Detect `{sign} as food` on-screen series (e.g. zodiac-as-food carousels). */
export function detectSignAsFoodSeries(slides: SlideIntelligenceV1[]): string[] | null {
  const signs: string[] = [];
  for (const slide of slides) {
    const text = slide.on_screen_text?.trim();
    if (!text) continue;
    const match = text.match(SIGN_AS_FOOD_ON_SCREEN);
    if (match) {
      const sign = match[1].trim().toLowerCase();
      if (sign && !signs.includes(sign)) signs.push(sign);
    }
  }
  return signs.length >= 2 ? signs : null;
}

/** Detect `how you should text your {sign} friend` uniform meme series. */
export function detectZodiacTextYourFriendSeries(slides: SlideIntelligenceV1[]): string[] | null {
  const signs: string[] = [];
  for (const slide of slides) {
    const text = slide.on_screen_text?.trim();
    if (!text) continue;
    const match = text.match(ZODIAC_TEXT_YOUR_FRIEND_ON_SCREEN);
    if (match) {
      const sign = match[1].trim().toLowerCase().replace(/\s+/g, " ");
      if (sign && !signs.includes(sign)) signs.push(sign);
    }
  }
  return signs.length >= 2 ? signs : null;
}

/** True when every beat shares the same swipeable sign-series format (no distinct cover slide). */
export function isUniformSignSeriesDeck(slides: SlideIntelligenceV1[]): boolean {
  return (
    detectZodiacTextYourFriendSeries(slides) != null ||
    detectZodiacRisingSeries(slides) != null ||
    detectSignAsFoodSeries(slides) != null
  );
}

/** Uniform sign series decks must not treat slide 1 as cover when reference has no cover beat. */
function reconcileRolesForUniformSignSeries(slides: SlideIntelligenceV1[]): SlideIntelligenceV1[] {
  if (!isUniformSignSeriesDeck(slides)) return slides;
  return slides.map((slide) => {
    if (slide.slide_role === "cta") return slide;
    if (slide.slide_role === "cover" || slide.slide_role === "hook") {
      return { ...slide, slide_role: "list_item" };
    }
    return slide;
  });
}

const ZODIAC_RISING_ON_SCREEN = /\b([a-z][a-z\s-]{0,18}?)\s+rising\b/i;

/** Detect `{sign} rising` meme-grid series (e.g. rising-sign astrology carousels). */
export function detectZodiacRisingSeries(slides: SlideIntelligenceV1[]): string[] | null {
  const signs: string[] = [];
  for (const slide of slides) {
    const text = slide.on_screen_text?.trim();
    if (!text) continue;
    const match = text.match(ZODIAC_RISING_ON_SCREEN);
    if (match) {
      const sign = match[1].trim().toLowerCase().replace(/\s+/g, " ");
      if (sign && !signs.includes(sign)) signs.push(sign);
    }
  }
  return signs.length >= 2 ? signs : null;
}

/** Collapse consecutive duplicate roles for readable deck arc (`body×9 → hook → cta`). */
export function compressNarrativeSpine(roles: string[]): string {
  const trimmed = roles.map((r) => String(r ?? "").trim()).filter(Boolean);
  if (trimmed.length === 0) return "";
  const parts: string[] = [];
  let prev = trimmed[0]!;
  let count = 1;
  for (let i = 1; i < trimmed.length; i++) {
    const role = trimmed[i]!;
    if (role === prev) {
      count += 1;
    } else {
      parts.push(count > 1 ? `${prev}×${count}` : prev);
      prev = role;
      count = 1;
    }
  }
  parts.push(count > 1 ? `${prev}×${count}` : prev);
  return parts.join(" → ");
}

/** Human label when slides form a recognizable swipeable series. */
export function describeDeckSeriesPattern(slides: SlideIntelligenceV1[]): string | null {
  const textFriend = detectZodiacTextYourFriendSeries(slides);
  if (textFriend) {
    const examples = textFriend.slice(0, 4).map(titleCaseWord).join(", ");
    return `Zodiac text-your-friend series (${examples}${textFriend.length > 4 ? ", …" : ""})`;
  }
  const food = detectSignAsFoodSeries(slides);
  if (food) {
    const examples = food.slice(0, 4).map(titleCaseWord).join(", ");
    return `Zodiac-as-food series (${examples}${food.length > 4 ? ", …" : ""})`;
  }
  const rising = detectZodiacRisingSeries(slides);
  if (rising) {
    const examples = rising.slice(0, 4).map(titleCaseWord).join(", ");
    return `Zodiac rising meme series (${examples}${rising.length > 4 ? ", …" : ""})`;
  }
  return null;
}

function thesisClaimsFixedSlideGallery(thesis: string, slideCount: number): boolean {
  const match = thesis.match(/\b(\d+)\s+(?:different\s+)?(?:pictures?|photos?|images?|slides?)\b/i);
  if (!match) return false;
  const claimed = Number(match[1]);
  if (!Number.isFinite(claimed) || claimed < 2) return false;
  return claimed < slideCount - 1;
}

/** True when deck-wide Nemotron thesis narrows to one subject but slides show a series or varied foods. */
export function deckThesisContradictsSlideEvidence(
  thesis: string | null | undefined,
  slides: SlideIntelligenceV1[]
): boolean {
  const t = String(thesis ?? "").trim();
  if (!t || slides.length < 2) return false;

  const signSeries = detectSignAsFoodSeries(slides);
  if (signSeries) {
    const thesisFoods = extractFoodTerms(t);
    if (thesisFoods.length > 0) return true;
    if (/\b(?:same|each|every|all)\b.+\b(?:pasta|dish|food|picture|photo|image|red)\b/i.test(t)) return true;
  }

  const risingSeries = detectZodiacRisingSeries(slides);
  if (risingSeries) {
    if (!/\b(?:rising|zodiac|astrology|horoscope|sign)\b/i.test(t)) return true;
    if (thesisClaimsFixedSlideGallery(t, slides.length)) return true;
  }

  if (thesisClaimsFixedSlideGallery(t, slides.length)) return true;

  const thesisFoods = extractFoodTerms(t);
  if (thesisFoods.length === 0) return false;

  const slideFoodSets = slides.map((s) => extractFoodTerms(slideEvidenceText(s)));
  const slidesMatchingThesisFood = slideFoodSets.filter((set) =>
    thesisFoods.some((food) => set.some((s) => s.includes(food) || food.includes(s)))
  ).length;

  if (slidesMatchingThesisFood < Math.ceil(slides.length * 0.5)) return true;

  const allSlideFoods = [...new Set(slideFoodSets.flat())];
  if (allSlideFoods.length >= 3 && thesisFoods.length === 1 && slidesMatchingThesisFood <= 2) {
    return true;
  }

  return false;
}

function titleCaseWord(word: string): string {
  return word.length > 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word;
}

function padThesisToMinLength(thesis: string, opts?: SlideIntelligenceTextQualityOpts): string {
  let out = thesis.trim();
  if (isSlideIntelligenceStrategicThesisSufficient(out, opts)) return out;
  const tail =
    " Preserve the recurring on-screen format and persuasion arc while varying imagery per slide — do not collapse the deck into a single repeated dish or subject.";
  out = `${out}${out.endsWith(".") ? "" : "."}${tail}`;
  return out;
}

/** Rebuild deck thesis from per-slide transcripts and imagery when upstream deck summary overfits. */
export function synthesizeDeckStrategicThesisFromSlides(
  slides: SlideIntelligenceV1[],
  context: {
    narrative_spine?: string[];
    arc_summary?: string | null;
    visual_consistency?: string | null;
  },
  opts?: SlideIntelligenceTextQualityOpts
): string | null {
  if (slides.length < 2) return null;

  const total = slides.length;
  const spine =
    context.narrative_spine?.filter(Boolean).join(" → ") ??
    slides.map((s) => s.slide_role).filter(Boolean).join(" → ");
  const signSeries = detectSignAsFoodSeries(slides);
  const risingSeries = detectZodiacRisingSeries(slides);

  if (risingSeries) {
    const examples = risingSeries.slice(0, 4).map(titleCaseWord).join(", ");
    const sentences = [
      `A swipeable zodiac-rising meme carousel: each slide spotlights one rising sign with a multi-panel meme grid (e.g. ${examples}), so viewers self-select by sign identity and share relatable quotes.`,
      `On-screen copy follows a consistent "{sign} rising" banner while meme panels change per slide — different emotional beats and quotes, not one repeated scene.`,
      `The deck wins on series recognition and relatability: sign-spotting keeps swipers engaged through ${total} beats${spine ? ` (${spine})` : ""}, with fresh meme energy per rising sign instead of a single-subject gallery.`,
    ];
    if (context.arc_summary) sentences.push(`Arc: ${context.arc_summary}.`);
    const thesis = padThesisToMinLength(sentences.join(" "), opts);
    return isSlideIntelligenceStrategicThesisSufficient(thesis, opts) ? thesis : null;
  }

  if (signSeries) {
    const examples = signSeries.slice(0, 4).map(titleCaseWord).join(", ");
    const sentences = [
      `A swipeable zodiac-as-food carousel: each slide pairs one astrological sign with a distinct food metaphor (e.g. ${examples}), so viewers self-select and share by sign identity.`,
      `On-screen copy follows a consistent "{sign} as food" formula while imagery changes per slide — different dishes, compositions, and moods rather than one repeated ingredient.`,
      `The deck wins on series recognition and humor: sign-spotting keeps swipers engaged through ${total} beats${spine ? ` (${spine})` : ""}, with visual variety across foods instead of a single-subject gallery.`,
    ];
    if (context.visual_consistency) {
      sentences.push(`Visual through-line: ${context.visual_consistency}.`);
    }
    const thesis = padThesisToMinLength(sentences.join(" "), opts);
    return isSlideIntelligenceStrategicThesisSufficient(thesis, opts) ? thesis : null;
  }

  const allFoods = [...new Set(slides.flatMap((s) => extractFoodTerms(slideEvidenceText(s))))];
  if (allFoods.length >= 2) {
    const examples = allFoods.slice(0, 5).join(", ");
    const onScreenSamples = [
      ...new Set(slides.map((s) => s.on_screen_text?.trim()).filter(Boolean) as string[]),
    ].slice(0, 3);
    const formatNote =
      onScreenSamples.length >= 2
        ? ` On-screen copy stays in a recurring format (e.g. "${onScreenSamples[0]}", "${onScreenSamples[1]}") while the food subject changes each swipe.`
        : "";
    const sentences = [
      `A multi-beat food carousel where each slide features a different dish or food style (${examples}), linked by a recurring caption pattern rather than one repeated ingredient.${formatNote}`,
      `Slides build retention through visual variety — viewers swipe to discover the next food beat — while holding a consistent overlay structure across ${total} frames${spine ? ` (${spine})` : ""}.`,
      `The strategic function is serial discovery: diverse food imagery with a unifying series format, not a single-subject montage mistaken for the whole deck.`,
    ];
    if (context.arc_summary) sentences.push(`Arc: ${context.arc_summary}.`);
    const thesis = padThesisToMinLength(sentences.join(" "), opts);
    return isSlideIntelligenceStrategicThesisSufficient(thesis, opts) ? thesis : null;
  }

  return null;
}

function reconcileNarrativeSpineInBundle(bundle: SlideIntelligenceBundleV1): SlideIntelligenceBundleV1 {
  const why = bundle.why_analysis;
  if (!why || bundle.slides.length < 2) return bundle;

  const fromSlides = bundle.slides.map((s) => s.slide_role).filter((r): r is string => !!r);
  if (fromSlides.length < 2) return bundle;

  const stored = why.narrative_spine ?? [];
  const storedLooksAbbreviated =
    stored.length > 0 &&
    stored.length < fromSlides.length &&
    stored.every((role) => fromSlides.includes(role));
  const shouldReplace = stored.length === 0 || stored.length < fromSlides.length || storedLooksAbbreviated;
  if (!shouldReplace) return bundle;

  return {
    ...bundle,
    why_analysis: {
      ...why,
      narrative_spine: fromSlides,
      slide_count: Math.max(why.slide_count, fromSlides.length),
    },
  };
}

function reconcileDeckStrategicThesisInBundle(
  bundle: SlideIntelligenceBundleV1,
  opts?: SlideIntelligenceTextQualityOpts
): SlideIntelligenceBundleV1 {
  const why = bundle.why_analysis;
  if (!why || bundle.slides.length < 2) return bundle;

  const upstreamThesis = why.strategic_thesis;
  const needsThesis =
    !isSlideIntelligenceStrategicThesisSufficient(upstreamThesis, opts) ||
    deckThesisContradictsSlideEvidence(upstreamThesis, bundle.slides);
  if (!needsThesis) return bundle;

  const fromSlides = synthesizeDeckStrategicThesisFromSlides(
    bundle.slides,
    {
      narrative_spine: why.narrative_spine,
      arc_summary: why.arc_summary,
    },
    opts
  );
  if (!fromSlides) return bundle;

  return {
    ...bundle,
    why_analysis: {
      ...why,
      strategic_thesis: fromSlides,
      provider: why.provider === "heuristic" ? "heuristic" : why.provider,
    },
  };
}

function normalizeProvider(v: unknown): SlideIntelligenceProvider {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "nemotron" || s === "openai" || s === "document_ai_derived") return s;
  return "heuristic";
}

/**
 * Map a free-text slide purpose / position to a coarse role. Tolerant by design:
 * upstream `slide_purpose` strings vary, so we keyword-match and fall back to
 * position heuristics (first = cover, last = cta).
 */
function inferSlideRole(
  purpose: string | null,
  index: number,
  total: number,
  transcript?: string | null
): string | null {
  const p = (purpose ?? "").toLowerCase();
  const t = (transcript ?? "").toLowerCase();
  const combined = `${p} ${t}`;
  if (/\bcta\b|call.?to.?action|follow|comment|save|share|link in bio/.test(combined)) return "cta";
  if (ZODIAC_TEXT_YOUR_FRIEND_ON_SCREEN.test(combined)) return "list_item";
  if (/cover|title|intro|opening|hook/.test(combined)) return index === 1 ? "cover" : "hook";
  if (/proof|result|testimonial|case study|stat|data|evidence/.test(combined)) return "proof";
  if (/objection|myth|mistake|warning|avoid|don.?t/.test(combined)) return "objection";
  if (/step|tip|item|list|number|reason|way/.test(combined)) return "list_item";
  if (/context|background|why|problem|explain/.test(combined)) return "context";
  if (/\b(?:meme|collage|grid|panel|2x2|four.?panel)\b/.test(combined)) return "list_item";
  if (ZODIAC_RISING_ON_SCREEN.test(combined) || /\b(?:moon in|new moon|vibes)\b/.test(combined)) {
    return "list_item";
  }
  if (SIGN_AS_FOOD_ON_SCREEN.test(combined)) return "list_item";
  if (p) return "body";
  if (index === 1) return "cover";
  if (total > 1 && index === total) return "cta";
  return total > 1 ? "body" : null;
}

function inferVisualRole(
  imageRole: string | null,
  visualDescription: string | null
): string | null {
  const r = (imageRole ?? "").toLowerCase();
  const d = (visualDescription ?? "").toLowerCase();
  if (/diagram|chart|graph|table|infographic/.test(r + d)) return "diagram";
  if (/screenshot|ui|dashboard|app/.test(r + d)) return "product_demo";
  if (/testimonial|review|comment|dm|chat/.test(r + d)) return "social_proof";
  if (/portrait|face|person|talking|selfie|creator/.test(r + d)) return "focal_subject";
  if (/background|texture|gradient|pattern|scene|landscape|abstract/.test(r + d)) return "background_mood";
  if (r) return r.slice(0, 60);
  return null;
}

/** Light keyword detection so the heuristic path is honest rather than empty. */
function detectMechanism(
  text: string,
  kind: "attention" | "curiosity" | "persuasion"
): string | null {
  const t = text.toLowerCase();
  if (kind === "attention") {
    if (/bold|large|contrast|color|arrow|highlight/.test(t)) return "visual contrast";
    if (/text|headline|caption|word/.test(t)) return "text-forward hook";
    return null;
  }
  if (kind === "curiosity") {
    if (/secret|nobody|hidden|reveal|surprising|truth|mistake|why|what if/.test(t))
      return "information gap";
    if (/\?$|how to|the one|number \d/.test(t)) return "open loop";
    return null;
  }
  // persuasion
  if (/proof|result|testimonial|data|stat|study/.test(t)) return "social proof / authority";
  if (/free|now|limited|today|fast|easy/.test(t)) return "urgency / low-friction";
  if (/you|your/.test(t)) return "personal relevance";
  return null;
}

/**
 * Parse explicit symbolic elements when an upstream provider supplied them.
 * The heuristic path does not invent symbolism — that is the job of a richer
 * provider and of Brand Translation. We only normalize what is already present.
 */
function parseSymbolicElements(raw: unknown): SlideSymbolicElement[] {
  const out: SlideSymbolicElement[] = [];
  for (const item of asArray(raw)) {
    if (typeof item === "string") {
      const element = str(item, 80);
      if (element) out.push({ element, denotation: null, connotations: [] });
      continue;
    }
    const o = asRecord(item);
    if (!o) continue;
    const element = str(o.element ?? o.symbol ?? o.name, 80);
    if (!element) continue;
    out.push({
      element,
      denotation: str(o.denotation ?? o.literal ?? o.description, 200),
      connotations: strList(o.connotations ?? o.meanings ?? o.meaning, 8, 60),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function synthesizeVisualDescription(input: {
  visual_description: string | null;
  image_or_photo_role: string | null;
  layout_template: string | null;
  graphic_elements: string | null;
  slide_purpose: string | null;
  visual_role: string | null;
}): string | null {
  if (isSlideIntelligenceVisualDescriptionSufficient(input.visual_description)) {
    return input.visual_description;
  }
  const parts = [
    input.visual_description,
    input.image_or_photo_role ? `Photo role: ${input.image_or_photo_role}` : null,
    input.layout_template ? `Layout: ${input.layout_template}` : null,
    input.graphic_elements ? `Graphics: ${input.graphic_elements}` : null,
    input.visual_role ? `Visual job: ${input.visual_role}` : null,
    input.slide_purpose ? `Scene purpose: ${input.slide_purpose}` : null,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  const joined = parts.join(". ").replace(/\.\s*\./g, ".").trim();
  return joined || null;
}

function synthesizeSlideWhyItWorks(
  input: {
    slide_index: number;
    slide_role: string | null;
    narrative_function: string | null;
    visual_description: string | null;
    on_screen_text: string | null;
    visual_role: string | null;
    psychological_trigger: string | null;
    persuasion_mechanism: string | null;
    curiosity_mechanism: string | null;
    attention_device: string | null;
    emotion: string | null;
  },
  totalSlides: number,
  opts?: SlideIntelligenceTextQualityOpts & { strategicThesis?: string | null }
): string | null {
  const role = input.slide_role ?? "body";
  const sentences: string[] = [];

  const risingBeat = input.on_screen_text?.match(ZODIAC_RISING_ON_SCREEN);
  const foodBeat = input.on_screen_text?.match(SIGN_AS_FOOD_ON_SCREEN);
  const textFriendBeat = input.on_screen_text?.match(ZODIAC_TEXT_YOUR_FRIEND_ON_SCREEN);
  if (textFriendBeat) {
    sentences.push(
      `This ${role} beat spotlights ${titleCaseWord(textFriendBeat[1].trim())} in the text-your-friend meme format — preserve sign-specific relatability and the iMessage-style humor arc, not literal chat UI or quoted message text.`
    );
  } else if (risingBeat) {
    sentences.push(
      `This ${role} beat spotlights ${titleCaseWord(risingBeat[1].trim())} rising — preserve sign-specific relatability and the meme-grid emotional arc, not literal faces, quotes, or panel layout.`
    );
  } else if (foodBeat) {
    sentences.push(
      `This ${role} beat pairs ${titleCaseWord(foodBeat[1].trim())} with a food metaphor — preserve the sign-to-food joke and swipeable series format, not the literal dish photo.`
    );
  }

  sentences.push(
    `This ${role} slide (slide ${input.slide_index} of ${totalSlides}) must keep its narrative job${
      input.narrative_function ? ` — ${input.narrative_function}` : ""
    }.`
  );

  if (input.visual_description) {
    const vis = input.visual_description.trim();
    sentences.push(
      `Reference imagery: ${vis.charAt(0).toLowerCase()}${vis.slice(1)}. New variants should pair fresh visuals with the same persuasion function — do not copy the literal scene.`
    );
  }

  const mechanisms = [
    input.psychological_trigger,
    input.persuasion_mechanism,
    input.curiosity_mechanism,
    input.attention_device,
  ].filter((m): m is string => !!m && m.trim().length > 0);

  if (mechanisms.length > 0) {
    sentences.push(
      `Mechanisms to preserve: ${mechanisms.join("; ")}${input.emotion ? `, targeting ${input.emotion}` : ""}.`
    );
  } else if (input.on_screen_text) {
    sentences.push(
      `On-screen copy anchors on "${input.on_screen_text.slice(0, 100)}${input.on_screen_text.length > 100 ? "…" : ""}" — rephrase while holding the same slide-level idea.`
    );
  }

  if (input.visual_role) {
    sentences.push(`Visual role in the frame: ${input.visual_role}.`);
  }

  const draft = sentences.join(" ");
  if (isSlideIntelligenceWhyItWorksSufficient(draft, opts)) return draft;
  const tail =
    " Preserve this slide's persuasion function while inventing fresh copy and imagery — do not echo the deck thesis verbatim or copy reference subjects literally.";
  const padded = `${draft}${tail}`;
  return padded.length > 0 ? padded : null;
}

function ensureMinVisualDescription(
  visual: string | null,
  slide: Pick<SlideIntelligenceV1, "slide_index" | "slide_role" | "visual_role" | "narrative_function">,
  total: number,
  opts?: SlideIntelligenceTextQualityOpts
): string | null {
  let v = String(visual ?? "").trim();
  if (isSlideIntelligenceVisualDescriptionSufficient(v, opts)) return v || null;
  const extras = [
    slide.visual_role ? `Visual role: ${slide.visual_role}.` : null,
    slide.narrative_function ? `Supports narrative job: ${slide.narrative_function}.` : null,
    `Art-only Instagram carousel ${slide.slide_role ?? "body"} plate (slide ${slide.slide_index} of ${total}) with smooth overlay-safe regions and no readable text in the frame.`,
  ];
  for (const extra of extras) {
    if (!extra) continue;
    v = v ? `${v} ${extra}` : extra;
    if (isSlideIntelligenceVisualDescriptionSufficient(v, opts)) return v;
  }
  return v || null;
}

/**
 * Ensure every slide carries slide-specific `why_it_works` + `visual_description`.
 */
export function enrichSlideIntelligenceBundle(
  bundle: SlideIntelligenceBundleV1,
  opts?: SlideIntelligenceTextQualityOpts
): SlideIntelligenceBundleV1 {
  const thesis = bundle.why_analysis?.strategic_thesis ?? null;
  const whyOpts = { ...opts, strategicThesis: thesis };
  const total = Math.max(bundle.slides.length, 1);

  const slides = bundle.slides.map((slide) => {
    const visual_description = ensureMinVisualDescription(
      synthesizeVisualDescription({
        visual_description: slide.visual_description,
        image_or_photo_role: null,
        layout_template: null,
        graphic_elements: null,
        slide_purpose: slide.narrative_function,
        visual_role: slide.visual_role,
      }) ?? slide.visual_description,
      slide,
      total,
      opts
    );

    let why_it_works = slide.why_it_works;
    if (isDeckThesisEchoOnSlide(why_it_works, thesis)) why_it_works = null;
    if (!isSlideIntelligenceWhyItWorksSufficient(why_it_works, whyOpts)) {
      why_it_works =
        synthesizeSlideWhyItWorks(
          {
            slide_index: slide.slide_index,
            slide_role: slide.slide_role,
            narrative_function: slide.narrative_function,
            visual_description,
            on_screen_text: slide.on_screen_text,
            visual_role: slide.visual_role,
            psychological_trigger: slide.psychological_trigger,
            persuasion_mechanism: slide.persuasion_mechanism,
            curiosity_mechanism: slide.curiosity_mechanism,
            attention_device: slide.attention_device,
            emotion: slide.emotion,
          },
          total,
          whyOpts
        ) ?? why_it_works;
    }

    let confidence = slide.confidence;
    if (isSlideIntelligenceWhyItWorksSufficient(why_it_works, whyOpts)) confidence += 0.05;
    if (isSlideIntelligenceVisualDescriptionSufficient(visual_description, opts)) confidence += 0.05;

    return {
      ...slide,
      visual_description,
      why_it_works,
      confidence: clampConfidence(confidence),
    };
  });

  const withSpine = reconcileNarrativeSpineInBundle({ ...bundle, slides });
  return reconcileDeckStrategicThesisInBundle(withSpine, opts);
}

export interface DeriveSlideIntelligenceInput {
  /** `aesthetic_analysis_json` for the reference (carousel/image tier). */
  aesthetic: Record<string, unknown> | null | undefined;
  insights_id?: string | null;
  analysis_tier?: string | null;
  mediaKind?: SlideIntelligenceMediaKind;
  /** Row-level mechanism columns (deck-wide), used as fallbacks per slide. */
  rowLevel?: {
    why_it_worked?: string | null;
    primary_emotion?: string | null;
    secondary_emotion?: string | null;
    hook_type?: string | null;
  };
}

/**
 * Derive a Slide Intelligence bundle from already-captured analysis. Deterministic,
 * zero added LLM cost. Returns null when there is no usable analysis.
 */
export function deriveSlideIntelligenceFromAnalysis(
  input: DeriveSlideIntelligenceInput
): SlideIntelligenceBundleV1 | null {
  const aesthetic = asRecord(input.aesthetic) ?? {};
  const row = input.rowLevel ?? {};
  const mediaKind: SlideIntelligenceMediaKind = input.mediaKind ?? "carousel";
  const insightsId = str(input.insights_id, 200);
  const analysisTier = str(input.analysis_tier, 80);

  const deckWhy = str(aesthetic.why_it_worked, 600) ?? str(row.why_it_worked, 600);
  const deckSummary = str(aesthetic.deck_as_whole_summary, 600);
  const arc = str(aesthetic.slide_arc, 400) ?? str(aesthetic.cover_vs_body, 400);
  const coverVsBody = str(aesthetic.cover_vs_body, 400);
  const visualConsistency = str(aesthetic.visual_consistency, 400);
  const deckEmotion = str(row.primary_emotion, 80);
  const deckHook = str(row.hook_type, 120) ?? str(aesthetic.format_pattern, 120);

  const rawSlides = asArray(aesthetic.slides)
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => s != null);

  const slideRecords = rawSlides.length > 0 ? rawSlides : mediaKind === "image" ? [aesthetic] : [];
  const total = slideRecords.length;

  const slides: SlideIntelligenceV1[] = slideRecords.map((s, i) => {
    const index = Number(s.slide_index) > 0 ? Number(s.slide_index) : i + 1;
    const purpose = str(s.slide_purpose, 300);
    const visualDescription = str(s.visual_description, 400);
    const imageRole = str(s.image_or_photo_role, 120);
    const layoutTemplate = str(s.layout_template, 200);
    const graphicElements = str(s.graphic_elements, 200);
    const transcript = str(s.on_screen_text_transcript, 400);
    const density = str(s.text_density, 60);
    const slideWhyRaw = str(s.why_it_works ?? s.why_it_worked, 900);
    const slideWhy =
      isSlideIntelligenceWhyItWorksSufficient(slideWhyRaw, { strategicThesis: deckWhy }) ? slideWhyRaw : null;
    const slideEmotion = str(s.emotion ?? s.primary_emotion, 80);

    const role = inferSlideRole(purpose, index, total, transcript);
    const visualRole = inferVisualRole(imageRole, visualDescription);
    const mechanismText = [purpose, visualDescription, transcript, density].filter(Boolean).join(" ");

    // confidence: explicit upstream fields raise it; pure position inference is low.
    let confidence = 0.3;
    if (purpose) confidence += 0.25;
    if (slideWhy) confidence += 0.15;
    if (visualDescription || imageRole) confidence += 0.1;
    if (slideEmotion || deckEmotion) confidence += 0.1;

    return {
      schema_version: SLIDE_INTELLIGENCE_SCHEMA,
      slide_index: index,
      source_slide_index: Number(s.source_slide_index) > 0 ? Number(s.source_slide_index) : null,
      slide_role: role,
      visual_role: visualRole,
      psychological_trigger:
        index === 1 ? deckHook ?? detectMechanism(mechanismText, "curiosity") : detectMechanism(mechanismText, "curiosity"),
      emotion: slideEmotion ?? deckEmotion,
      attention_device: detectMechanism([visualDescription, density].filter(Boolean).join(" "), "attention"),
      curiosity_mechanism: detectMechanism(mechanismText, "curiosity"),
      persuasion_mechanism: detectMechanism(mechanismText, "persuasion"),
      narrative_function: purpose ?? (role ? `${role} slide` : null),
      visual_description: synthesizeVisualDescription({
        visual_description: visualDescription,
        image_or_photo_role: imageRole,
        layout_template: layoutTemplate,
        graphic_elements: graphicElements,
        slide_purpose: purpose,
        visual_role: visualRole,
      }),
      on_screen_text: transcript,
      symbolic_elements: parseSymbolicElements(s.symbolic_elements ?? s.symbolism),
      why_it_works: slideWhy,
      provider: "heuristic",
      evidence_refs: {
        insights_id: insightsId,
        analysis_tier: analysisTier,
        source_field: rawSlides.length > 0 ? "aesthetic_analysis_json.slides" : "aesthetic_analysis_json",
      },
      confidence: clampConfidence(confidence),
    };
  });

  const reconciledSlides = reconcileRolesForUniformSignSeries(slides);

  const narrativeSpine = reconciledSlides
    .map((s) => s.slide_role)
    .filter((r): r is string => !!r);

  const secondary = strList(
    [str(row.secondary_emotion, 80), str(aesthetic.cover_vs_body, 80)].filter(Boolean),
    4,
    80
  );

  const why_analysis: WhyAnalysisV1 | null =
    deckWhy || deckSummary || arc || deckHook || deckEmotion
      ? {
          schema_version: WHY_ANALYSIS_SCHEMA,
          narrative_spine: narrativeSpine,
          dominant_mechanism: deckHook ?? deckEmotion,
          secondary_mechanisms: secondary,
          strategic_thesis: resolveDeckStrategicThesis({
            why_it_worked: deckWhy,
            deck_as_whole_summary: deckSummary,
            slide_arc: arc,
            cover_vs_body: coverVsBody,
            visual_consistency: visualConsistency,
          }),
          arc_summary: arc,
          provider: "heuristic",
          confidence: clampConfidence(
            reconciledSlides.length
              ? reconciledSlides.reduce((a, s) => a + s.confidence, 0) / reconciledSlides.length
              : 0.4
          ),
          slide_count: reconciledSlides.length,
        }
      : null;

  if (reconciledSlides.length === 0 && !why_analysis) return null;

  return enrichSlideIntelligenceBundle({
    schema_version: SLIDE_INTELLIGENCE_SCHEMA,
    generated_at: new Date().toISOString(),
    media_kind: mediaKind,
    provider: "heuristic",
    source_insights_id: insightsId,
    analysis_tier: analysisTier,
    slides: reconciledSlides,
    why_analysis,
  });
}

/** Tolerant reader for a stored / projected SIL bundle. */
export function parseSlideIntelligenceBundle(raw: unknown): SlideIntelligenceBundleV1 | null {
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== SLIDE_INTELLIGENCE_SCHEMA) return null;

  const slides: SlideIntelligenceV1[] = asArray(rec.slides)
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => s != null)
    .map((s, i) => {
      const index = Number(s.slide_index) > 0 ? Number(s.slide_index) : i + 1;
      const ev = asRecord(s.evidence_refs) ?? {};
      return {
        schema_version: SLIDE_INTELLIGENCE_SCHEMA,
        slide_index: index,
        source_slide_index: Number(s.source_slide_index) > 0 ? Number(s.source_slide_index) : null,
        slide_role: str(s.slide_role, 80),
        visual_role: str(s.visual_role, 80),
        psychological_trigger: str(s.psychological_trigger, 200),
        emotion: str(s.emotion, 80),
        attention_device: str(s.attention_device, 200),
        curiosity_mechanism: str(s.curiosity_mechanism, 200),
        persuasion_mechanism: str(s.persuasion_mechanism, 200),
        narrative_function: str(s.narrative_function, 300),
        visual_description: str(s.visual_description, 900),
        on_screen_text: str(s.on_screen_text ?? s.on_screen_text_transcript, 400),
        symbolic_elements: parseSymbolicElements(s.symbolic_elements),
        why_it_works: str(s.why_it_works, 900),
        provider: normalizeProvider(s.provider),
        evidence_refs: {
          insights_id: str(ev.insights_id, 200),
          analysis_tier: str(ev.analysis_tier, 80),
          source_field: str(ev.source_field, 120),
          text_block_indices: asArray(ev.text_block_indices)
            .filter((n) => typeof n === "number" && Number.isFinite(n))
            .map(Number),
        },
        confidence: clampConfidence(Number(s.confidence)),
      };
    });

  const whyRec = asRecord(rec.why_analysis);
  const why_analysis: WhyAnalysisV1 | null =
    whyRec && whyRec.schema_version === WHY_ANALYSIS_SCHEMA
      ? {
          schema_version: WHY_ANALYSIS_SCHEMA,
          narrative_spine: strList(whyRec.narrative_spine, 24, 80),
          dominant_mechanism: str(whyRec.dominant_mechanism, 200),
          secondary_mechanisms: strList(whyRec.secondary_mechanisms, 8, 200),
          strategic_thesis: str(whyRec.strategic_thesis, 600),
          arc_summary: str(whyRec.arc_summary, 400),
          provider: normalizeProvider(whyRec.provider),
          confidence: clampConfidence(Number(whyRec.confidence)),
          slide_count: Number(whyRec.slide_count) || slides.length,
        }
      : null;

  if (slides.length === 0 && !why_analysis) return null;

  return enrichSlideIntelligenceBundle({
    schema_version: SLIDE_INTELLIGENCE_SCHEMA,
    generated_at: str(rec.generated_at, 40) ?? new Date().toISOString(),
    media_kind:
      rec.media_kind === "image" || rec.media_kind === "video" ? rec.media_kind : "carousel",
    provider: normalizeProvider(rec.provider),
    source_insights_id: str(rec.source_insights_id, 200),
    analysis_tier: str(rec.analysis_tier, 80),
    slides,
    why_analysis,
  });
}

/**
 * Read a SIL bundle from storage if present, else derive it on the fly from the
 * supplied analysis. Mirrors the `pickTopPerformerKnowledgeForStep` pattern of
 * rebuilding from legacy fields when the v1 slice is absent.
 */
export function pickOrDeriveSlideIntelligence(
  stored: unknown,
  fallback: DeriveSlideIntelligenceInput,
  opts?: SlideIntelligenceTextQualityOpts
): SlideIntelligenceBundleV1 | null {
  const parsed = parseSlideIntelligenceBundle(stored);
  const base = parsed ?? deriveSlideIntelligenceFromAnalysis(fallback);
  if (!base) return null;
  return enrichSlideIntelligenceBundle(base, opts);
}

/** Resolve SIL row for an output slide (Nemotron rows are keyed by source-deck index after promo drops). */
export function resolveSlideIntelligenceForOutputSlide(
  bundle: SlideIntelligenceBundleV1,
  outputSlideIndex1Based: number,
  sourceSlideIndex1Based?: number | null
): SlideIntelligenceV1 | null {
  const sourceIdx =
    sourceSlideIndex1Based != null && sourceSlideIndex1Based > 0
      ? sourceSlideIndex1Based
      : outputSlideIndex1Based;
  return (
    bundle.slides.find((s) => s.slide_index === sourceIdx) ??
    (sourceIdx !== outputSlideIndex1Based
      ? bundle.slides.find((s) => s.source_slide_index === sourceIdx)
      : null) ??
    bundle.slides.find((s) => s.slide_index === outputSlideIndex1Based) ??
    bundle.slides[outputSlideIndex1Based - 1] ??
    null
  );
}

/** Short prompt-ready cues from a bundle (for creation pack / planner). */
export function slideIntelligenceCues(bundle: SlideIntelligenceBundleV1 | null): string[] {
  if (!bundle) return [];
  const cues: string[] = [];
  const why = bundle.why_analysis;
  if (why?.strategic_thesis) cues.push(`Why it works: ${why.strategic_thesis}`);
  if (why?.dominant_mechanism) cues.push(`Dominant mechanism: ${why.dominant_mechanism}`);
  if (why?.narrative_spine.length) cues.push(`Narrative spine: ${compressNarrativeSpine(why.narrative_spine)}`);
  return cues;
}

/**
 * A prompt block that tells the copy LLM to preserve the *strategic function* of
 * each slide rather than just its surface text. This is the Why Mimic upgrade to
 * the semantic-fidelity contract: "same job", not only "same idea".
 * Returns null when the bundle carries no usable signal.
 */
export function buildWhyMimicPromptBlock(
  bundle: SlideIntelligenceBundleV1 | null | undefined,
  opts?: { maxSlides?: number }
): string | null {
  if (!bundle) return null;
  const why = bundle.why_analysis;
  const maxSlides = Math.max(1, opts?.maxSlides ?? 14);

  const lines: string[] = [];
  if (why?.strategic_thesis) lines.push(`- Strategic intent (keep constant): ${why.strategic_thesis}`);
  if (why?.arc_summary) lines.push(`- Deck arc: ${why.arc_summary}`);
  if (why?.dominant_mechanism) lines.push(`- Dominant mechanism: ${why.dominant_mechanism}`);
  if (why?.secondary_mechanisms?.length)
    lines.push(`- Supporting mechanisms: ${why.secondary_mechanisms.join(", ")}`);
  const seriesPattern = describeDeckSeriesPattern(bundle.slides);
  if (seriesPattern) lines.push(`- Series pattern: ${seriesPattern}`);
  if (why?.narrative_spine?.length)
    lines.push(`- Narrative spine: ${compressNarrativeSpine(why.narrative_spine)}`);

  const slideLines: string[] = [];
  for (const s of bundle.slides.slice(0, maxSlides)) {
    const role = s.slide_role ? `[${s.slide_role}]` : "";
    const mech = [s.psychological_trigger, s.persuasion_mechanism, s.curiosity_mechanism]
      .filter(Boolean)
      .join("; ");
    const visual = s.visual_description ? ` Imagery: ${s.visual_description}` : "";
    const whyLine = s.why_it_works ? ` Why: ${s.why_it_works}` : "";
    const detail = [s.narrative_function, mech].filter(Boolean).join(" · ");
    if (!detail && !whyLine && !visual && !role) continue;
    slideLines.push(`  - Slide ${s.slide_index} ${role}: ${detail}${visual}${whyLine}`.replace(/\s+/g, " ").trim());
  }

  if (lines.length === 0 && slideLines.length === 0) return null;

  const parts = [
    "Why this reference works (Why Mimic — preserve the strategic FUNCTION and imagery job of each slide; invent fresh subjects and scenes):",
    ...lines,
  ];
  if (slideLines.length > 0) {
    parts.push(
      "Per-slide narrative + imagery to preserve while you invent fresh copy and visuals:",
      ...slideLines
    );
  }
  return parts.join("\n").trim();
}
