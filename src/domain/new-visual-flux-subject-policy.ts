/**
 * Subject-first visual policy for New Visual Carousel Flux prompts.
 * Prevents abstract wallpaper / zodiac-template backgrounds in favor of concrete scenes.
 */

const ZODIAC_SIGN_NAMES = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;

const ZODIAC_LITERAL_SUBJECTS: Record<(typeof ZODIAC_SIGN_NAMES)[number], string> = {
  aries: "a photoreal ram or bold adventure scene with fire/warmth energy — real animal or person, not a glyph",
  taurus: "a bull in pasture, farm still life, or tactile earth-tone lifestyle scene — real subject, not a symbol",
  gemini: "two expressive people in conversation or motion (partners/friends), dynamic social scene — not twin zodiac icons",
  cancer: "a vivid crab on shoreline, cozy home ritual, or nurturing kitchen scene — real crab or human moment, not crab clipart",
  leo: "a lion in golden-hour light or confident portrait with warm spotlight — real lion or charismatic person",
  virgo: "botanical detail, person arranging flowers/food, or meticulous craft scene — tactile and grounded",
  libra: "elegant balanced lifestyle portrait or still life with real objects (scales, flowers, mirror) — not abstract balance graphics",
  scorpio: "dramatic macro scorpion on sand, moody intimate portrait, or deep-water scene — never neon purple line-art scorpion",
  sagittarius: "archer on horseback, wide travel landscape, or campfire under open sky — adventurous and cinematic",
  capricorn: "mountain goat on cliffs or ambitious outdoor climb — real animal or athlete in nature",
  aquarius: "person with water, rain, or creative pour in lifestyle/editorial scene — not constellation jug graphics",
  pisces: "two fish in vivid underwater light or fish market color — real fish, not cartoon pair icons",
};

export const NEW_VISUAL_SUBJECT_FIRST_RULES =
  "Hero-subject-first composition: one clear focal subject (person, object, food, hands, interior detail, or landscape vista) must dominate 40–70% of the frame with cinematic lighting, depth, and texture. " +
  "Think scroll-stopping Instagram editorial — vivid, specific, and on-message.";

export const NEW_VISUAL_BANNED_VISUAL_PATTERNS =
  "FORBIDDEN as the primary visual: flat gradient or starfield wallpaper; constellation maps; zodiac wheels; repeating cosmic line-art; silk/velvet texture backdrops with floating symbols; generic purple galaxy templates; ornamental borders with no real scene; clipart icons; empty abstract patterns; generic stock-photo clichés (smiling person at camera for no reason, unrelated pets, luxury hero product when slide argues a problem). " +
  "Motifs may appear only as subtle accents inside a real photographed or illustrated scene — never as the whole image.";

export const NEW_VISUAL_SAFE_ZONE_HINT =
  "Reserve a slightly softer, lower-contrast band in the center third for HTML text overlay — but keep rich environmental detail, depth, and subject matter around it. Never output a flat empty gradient plate.";

export const NEW_VISUAL_SERIES_COHESION_HINT =
  "This slide belongs to a multi-slide deck — match the same color grade, lighting family, and editorial tone as sibling slides; vary subject and framing, not random unrelated genres.";

/** True when copy explicitly calls for animals — otherwise pets are off-limits as hero subjects. */
export function copyMentionsAnimals(text: string): boolean {
  return /\b(pets?|dogs?|cats?|puppies|kittens?|animals?|wildlife|horse|birds?|aquarium|zoo)\b/i.test(text);
}

function extractZodiacSigns(text: string): (typeof ZODIAC_SIGN_NAMES)[number][] {
  const lower = text.toLowerCase();
  const found = new Set<(typeof ZODIAC_SIGN_NAMES)[number]>();
  for (const sign of ZODIAC_SIGN_NAMES) {
    const re = new RegExp(`\\b${sign}\\b`, "i");
    if (re.test(lower)) found.add(sign);
  }
  return [...found];
}

function astrologyTopicWithoutSigns(text: string): boolean {
  return /\b(zodiac|astrolog|horoscope|cosmic|constellation|star\s*sign|birth\s*chart)\b/i.test(text);
}

function copyImpliesProblemOrFriction(text: string): boolean {
  return /\b(burnout|bored|boring|stuck|overwhelm|stress|stressed|tired|repetitive|repetition|same\s+(?:meal|dish|recipe)|takeout|waste|forgotten|never\s+know|mental\s+load|decision\s+fatigue|problem|pain|friction|struggle|avoid|mistake|wrong)\b/i.test(
    text
  );
}

function copyImpliesProcessOrHowTo(text: string): boolean {
  return /\b(step\s*\d|steps?\b|tip|tips|hack|hacks|plan|planning|prep|prepare|build|mix|rotate|strategy|how\s+to|simple\s+way|flexible|map|link|double\s+duty|organize|system|framework|checklist|list|ingredient\s+bases?|staples?)\b/i.test(
    text
  );
}

function copyImpliesSocialScene(text: string): boolean {
  return /\b(friends?|family|gather|gathering|share|sharing|together|community|dinner\s+party|group|hosting)\b/i.test(text);
}

function copyImpliesOutcomeOrRelief(text: string): boolean {
  return /\b(relief|easier|better|simpler|save\s+time|less\s+stress|enjoy|satisfaction|discover|ready\s+to|start|follow|save|shop)\b/i.test(
    text
  );
}

/**
 * Semantic fallback when copy LLM did not provide visual_direction.
 * Project-agnostic — infers scene type from slide copy, never random pet rotation.
 */
export function inferSemanticSubjectCueFromCopy(opts: {
  copyTheme?: string | null;
  slidePurpose?: string;
  slideIndex?: number;
}): string {
  const blob = String(opts.copyTheme ?? "").trim();
  const purpose = opts.slidePurpose ?? "content";

  if (purpose === "hook") {
    return "Hook slide: maximum scroll-stop energy — one bold, specific subject tied to the deck topic with dramatic lighting; concept-first, not generic stock.";
  }
  if (purpose === "cta") {
    return "Closing slide: memorable outcome or relief moment tied to the deck promise — warm, aspirational, specific; not a generic crowd stock photo.";
  }

  if (copyImpliesProblemOrFriction(blob)) {
    return (
      "Problem/friction slide: visualize the pain or tension the copy describes (repetition, mess, overwhelm, sameness, empty planning) — " +
      "do NOT show the aspirational opposite (e.g. no gourmet hero food when copy is about burnout or boredom)."
    );
  }
  if (copyImpliesProcessOrHowTo(blob)) {
    return (
      "How-to/process slide: show hands, tools, ingredients, lists, containers, or planning in action — " +
      "illustrate the method or system; no decorative unrelated subjects."
    );
  }
  if (copyImpliesSocialScene(blob)) {
    return "Social/community slide: intimate group meal or shared table moment with real interaction — not a staged corporate stock crowd.";
  }
  if (copyImpliesOutcomeOrRelief(blob)) {
    return "Outcome slide: calm, organized, or satisfying visual payoff that matches the copy promise — specific and earned, not generic luxury stock.";
  }

  const idx = opts.slideIndex ?? 1;
  const humanSubjects = [
    "environmental portrait of a person actively engaged with the slide topic (not smiling at camera)",
    "close-up of tactile objects or materials central to the slide message",
    "overhead or detail shot of tools, ingredients, or props arranged with intentional composition",
    "dynamic hands-on action moment — movement, interaction, or workflow",
    "intimate interior or workspace vignette with a clear focal prop tied to the message",
  ];
  const subject = humanSubjects[(idx - 1) % humanSubjects.length]!;
  const animalGuard = copyMentionsAnimals(blob)
    ? ""
    : " No random pets or wildlife unless copy mentions animals.";
  return `Content slide: ${subject} — photoreal or high-end editorial; concept supports the slide argument.${animalGuard}`;
}

/**
 * Turn slide copy / deck hints into literal scene direction so Flux paints subjects, not wallpaper.
 */
export function inferLiteralSubjectCueFromCopyTheme(opts: {
  copyTheme?: string | null;
  deckConcept?: string | null;
  thesis?: string | null;
  slidePurpose?: string;
  slideIndex?: number;
  /** When set, subject policy defers to the copy-authored scene brief. */
  visualDirection?: string | null;
}): string | null {
  if (String(opts.visualDirection ?? "").trim()) {
    return "Follow the scene brief exactly — primary creative direction is visual_direction; stay on-message with the slide copy.";
  }

  const blob = [opts.copyTheme, opts.deckConcept, opts.thesis].filter(Boolean).join(" ");
  if (!blob.trim()) return null;

  const signs = extractZodiacSigns(blob);
  if (signs.length >= 2) {
    const a = ZODIAC_LITERAL_SUBJECTS[signs[0]!];
    const b = ZODIAC_LITERAL_SUBJECTS[signs[1]!];
    return (
      `Literal scene direction (not symbols): combine ${a} AND ${b} in one cohesive cinematic environment that expresses their pairing — ` +
      "real animals, people, objects, or landscapes with depth; absolutely no zodiac wheel, constellation chart, or neon glyph overlay as the main visual."
    );
  }
  if (signs.length === 1) {
    const subject = ZODIAC_LITERAL_SUBJECTS[signs[0]!];
    return `Literal scene direction (not symbols): ${subject} — full environment, story, and lighting; no zodiac icon or star-map wallpaper.`;
  }

  if (astrologyTopicWithoutSigns(blob)) {
    return (
      "Astrology-themed deck: show real lifestyle scenes — people, animals, objects, or landscapes that evoke the mood — " +
      "never constellation graphics, starfields, or zodiac clipart as the background."
    );
  }

  return inferSemanticSubjectCueFromCopy({
    copyTheme: opts.copyTheme,
    slidePurpose: opts.slidePurpose,
    slideIndex: opts.slideIndex,
  });
}

export function buildNewVisualFluxSubjectBlock(input: {
  copyTheme?: string | null;
  deckConcept?: string | null;
  thesis?: string | null;
  slidePurpose?: string;
  slideIndex?: number;
  visualDirection?: string | null;
}): string {
  const parts = [NEW_VISUAL_SUBJECT_FIRST_RULES, NEW_VISUAL_BANNED_VISUAL_PATTERNS];
  const cue = inferLiteralSubjectCueFromCopyTheme(input);
  if (cue) parts.push(cue);
  return parts.join(" ");
}
