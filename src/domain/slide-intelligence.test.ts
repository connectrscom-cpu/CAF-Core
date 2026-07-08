import { describe, expect, it } from "vitest";
import {
  buildWhyMimicPromptBlock,
  compressNarrativeSpine,
  deckThesisContradictsSlideEvidence,
  deriveSlideIntelligenceFromAnalysis,
  describeDeckSeriesPattern,
  detectSignAsFoodSeries,
  detectZodiacRisingSeries,
  detectZodiacTextYourFriendSeries,
  parseSlideIntelligenceBundle,
  pickOrDeriveSlideIntelligence,
  resolveDeckStrategicThesis,
  resolveSlideIntelligenceForOutputSlide,
  slideIntelligenceCues,
  SLIDE_INTELLIGENCE_SCHEMA,
  synthesizeDeckStrategicThesisFromSlides,
  WHY_ANALYSIS_SCHEMA,
} from "./slide-intelligence.js";

const LONG_DECK_WHY =
  "Strong information gap on the cover and concrete proof before the ask — builds trust before CTA. The deck sequences education with social proof so the audience feels informed before the follow prompt, using curiosity on slide one and credibility beats before the close.";

const LONG_SLIDE_WHY_1 =
  "Opens with sign identity and sets meme expectation for the carousel series. The hook names the audience tribe immediately so scrollers self-select, and the visual tone signals humor without needing to read every line.";

const LONG_SLIDE_WHY_2 =
  "Delivers a relatable quarantine joke beat that deepens the humor arc. It rewards swipers who committed on slide one with a payoff that feels shareable while keeping the same astrological frame.";

const carouselAesthetic = {
  slide_arc: "problem → agitation → solution → proof → cta",
  cover_vs_body: "cover is bold claim; body explains steps",
  format_pattern: "listicle",
  why_it_worked: LONG_DECK_WHY,
  deck_as_whole_summary: "Educational listicle with a credibility close.",
  slides: [
    {
      slide_index: 1,
      slide_purpose: "Cover hook with a surprising claim",
      image_or_photo_role: "bold background gradient",
      visual_description:
        "High-contrast headline over an abstract gradient background with cool teal-to-violet wash, soft grain, and generous negative space for overlay text.",
      text_density: "low",
      on_screen_text_transcript: "Nobody tells you this about X",
    },
    {
      slide_index: 2,
      slide_purpose: "Step one explanation",
      image_or_photo_role: "screenshot of dashboard",
      text_density: "high",
    },
    {
      slide_index: 3,
      slide_purpose: "Proof with testimonial data",
      visual_description: "Customer testimonial portrait beside a bold stat callout on a clean neutral background with accent color highlights.",
    },
    {
      slide_index: 4,
      slide_purpose: "Call to action: follow for more",
    },
  ],
};

const zodiacFoodAesthetic = {
  slide_arc: "cover → body → cta",
  format_pattern: "education | story",
  why_it_worked:
    "The carousel uses education and story beats to keep food lovers swiping through sign-themed dishes.",
  deck_as_whole_summary:
    "Shown are five different pictures of pasta with cheese that appear to be made in a classical Italian style from what can be seen from one of the pictures provided. The carousel of food images shows pictures of pasta during the day taken in different places. The aesthetic and color consistency is evident because the pasta is red in each of the four pictures provided.",
  slides: [
    {
      slide_index: 1,
      slide_purpose: "Cover hook",
      on_screen_text_transcript: "taurus as food",
      visual_description:
        "Collage of pasta dishes in tomato-based sauces on decorative plates with warm daylight tones and overlay-safe negative space.",
    },
    {
      slide_index: 2,
      slide_purpose: "Body content",
      on_screen_text_transcript: "aries as food",
      visual_description:
        "Fried chicken tenders, a slider, and golden french fries arranged on a warm red-toned surface with generous negative space for overlay text.",
    },
    {
      slide_index: 7,
      slide_purpose: "Body content",
      on_screen_text_transcript: "libra as food",
      visual_description:
        "Four-panel collage of crispy french fries with herbs, dipping sauce, and parchment-lined baskets in bright warm lighting.",
    },
  ],
};

const zodiacRisingAesthetic = {
  slide_arc: "cover → list beats → cta",
  why_it_worked: "Astrology meme carousel with rising-sign identity hooks.",
  deck_as_whole_summary: "Each slide is a four-panel meme grid with a rising-sign banner.",
  slides: Array.from({ length: 6 }, (_, i) => ({
    slide_index: i + 1,
    slide_purpose: "Body content",
    on_screen_text_transcript:
      i === 0
        ? "LEO RISING — NEW MOON IN GEMINI VIBES · meme quotes"
        : `${["VIRGO", "SCORPIO", "ARIES", "TAURUS", "GEMINI"][i - 1]} RISING — NEW MOON IN GEMINI VIBES · meme quotes`,
    visual_description: "Four-panel meme collage with centered rising-sign banner and quote overlays.",
  })),
};

describe("compressNarrativeSpine", () => {
  it("collapses consecutive duplicate roles", () => {
    expect(compressNarrativeSpine(["body", "body", "body", "hook", "cta"])).toBe("body×3 → hook → cta");
  });
});

describe("zodiac text-your-friend series", () => {
  const zodiacTextFriendAesthetic = {
    slides: [
      {
        slide_index: 1,
        slide_purpose: "hook",
        on_screen_text_transcript: "how you should text your aries friend Lowkey us",
        visual_description: "googly-eye stuffed animals on white background",
      },
      {
        slide_index: 2,
        slide_purpose: "content",
        on_screen_text_transcript: "how you should text your taurus friend",
        visual_description: "bowl of strawberries on steps",
      },
      {
        slide_index: 3,
        slide_purpose: "content",
        on_screen_text_transcript: "how you should text your gemini friend",
        visual_description: "flower brain illustration",
      },
    ],
  };

  it("detects uniform text-your-friend series from transcripts", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacTextFriendAesthetic });
    expect(detectZodiacTextYourFriendSeries(bundle!.slides)).toEqual(["aries", "taurus", "gemini"]);
    expect(describeDeckSeriesPattern(bundle!.slides)).toContain("text-your-friend");
  });

  it("does not label slide 1 as cover for uniform sign series", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacTextFriendAesthetic });
    expect(bundle!.slides[0]!.slide_role).toBe("list_item");
    expect(bundle!.slides[0]!.slide_role).not.toBe("cover");
    expect(bundle!.slides.every((s) => s.slide_role === "list_item")).toBe(true);
  });
});

describe("zodiac rising series", () => {
  it("detects rising-sign meme series from on-screen transcripts", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacRisingAesthetic });
    expect(detectZodiacRisingSeries(bundle!.slides)).toEqual(["leo", "virgo", "scorpio", "aries", "taurus", "gemini"]);
    expect(describeDeckSeriesPattern(bundle!.slides)).toContain("Zodiac rising meme series");
  });

  it("classifies rising-sign slides as list_item beats, not generic body", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacRisingAesthetic });
    expect(bundle!.slides[1]!.slide_role).toBe("list_item");
    expect(compressNarrativeSpine(bundle!.why_analysis!.narrative_spine)).toContain("list_item×");
  });

  it("synthesizes a rising-sign deck thesis when upstream summary is thin", () => {
    const slides = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacRisingAesthetic })!.slides;
    const thesis = synthesizeDeckStrategicThesisFromSlides(slides, {
      narrative_spine: slides.map((s) => s.slide_role).filter(Boolean) as string[],
    });
    expect(thesis).not.toBeNull();
    expect(thesis!.toLowerCase()).toContain("rising");
    expect(thesis!.toLowerCase()).toContain("leo");
  });
});

describe("resolveDeckStrategicThesis", () => {
  it("combines deck-wide Nemotron fields into a long strategic thesis", () => {
    const thesis = resolveDeckStrategicThesis({
      why_it_worked:
        "The carousel wins by pairing a curiosity hook on slide one with escalating proof slides before a soft CTA — each swipe reveals a new beat in the same visual language.",
      deck_as_whole_summary:
        "A cohesive educational meme arc: hook, relatable body beats, credibility proof, then follow CTA. Slides build on each other rather than repeating the same message.",
      slide_arc: "hook → list items → proof → cta",
      cover_vs_body: "cover is bold claim; body explains with humor",
    });
    expect(thesis).not.toBeNull();
    expect(String(thesis).length).toBeGreaterThanOrEqual(240);
  });
});

describe("deck strategic thesis reconciliation", () => {
  it("detects zodiac-as-food on-screen series", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacFoodAesthetic });
    expect(detectSignAsFoodSeries(bundle!.slides)).toEqual(["taurus", "aries", "libra"]);
  });

  it("flags upstream pasta-only deck summary when slides show varied foods", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacFoodAesthetic });
    const upstream = resolveDeckStrategicThesis({
      why_it_worked: zodiacFoodAesthetic.why_it_worked,
      deck_as_whole_summary: zodiacFoodAesthetic.deck_as_whole_summary,
      slide_arc: zodiacFoodAesthetic.slide_arc,
    });
    expect(deckThesisContradictsSlideEvidence(upstream, bundle!.slides)).toBe(true);
  });

  it("replaces overfit deck thesis with a zodiac-as-food series thesis", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacFoodAesthetic });
    const thesis = bundle!.why_analysis!.strategic_thesis ?? "";
    expect(thesis.toLowerCase()).toContain("zodiac-as-food");
    expect(thesis.toLowerCase()).not.toContain("red in each of the four pictures");
    expect(thesis.toLowerCase()).not.toMatch(/\bfive different pictures of pasta\b/);
  });

  it("synthesizes a zodiac-as-food thesis from per-slide transcripts", () => {
    const slides = deriveSlideIntelligenceFromAnalysis({ aesthetic: zodiacFoodAesthetic })!.slides;
    const thesis = synthesizeDeckStrategicThesisFromSlides(slides, {
      narrative_spine: ["cover", "body", "body"],
    });
    expect(thesis).not.toBeNull();
    expect(thesis!.toLowerCase()).toContain("zodiac-as-food");
    expect(thesis!.toLowerCase()).toContain("taurus");
    expect(thesis!.toLowerCase()).toContain("different dishes");
  });
});

describe("deriveSlideIntelligenceFromAnalysis", () => {
  it("derives per-slide roles, a why_analysis spine, and honest confidence", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: carouselAesthetic,
      insights_id: "ins_abc_1_carousel",
      analysis_tier: "top_performer_carousel",
      rowLevel: { primary_emotion: "curiosity", hook_type: "information_gap", why_it_worked: "row level why" },
    });

    expect(bundle).not.toBeNull();
    expect(bundle!.schema_version).toBe(SLIDE_INTELLIGENCE_SCHEMA);
    expect(bundle!.provider).toBe("heuristic");
    expect(bundle!.slides).toHaveLength(4);

    const [cover, step, proof, cta] = bundle!.slides;
    expect(cover.slide_role).toBe("cover");
    expect(cover.psychological_trigger).toBe("information_gap");
    expect(cover.emotion).toBe("curiosity");
    expect(cover.why_it_works).toContain("information gap");
    expect(step.slide_role).toBe("list_item");
    expect(step.visual_role).toBe("product_demo");
    expect(proof.slide_role).toBe("proof");
    expect(proof.persuasion_mechanism).toContain("social proof");
    expect(cta.slide_role).toBe("cta");

    // explicit upstream fields => higher confidence than pure position inference
    expect(cover.confidence).toBeGreaterThan(0.5);

    const why = bundle!.why_analysis!;
    expect(why.schema_version).toBe(WHY_ANALYSIS_SCHEMA);
    expect(why.narrative_spine).toEqual(["cover", "list_item", "proof", "cta"]);
    expect(why.dominant_mechanism).toBe("information_gap");
    expect(why.strategic_thesis).toContain("information gap");
    expect(why.slide_count).toBe(4);
  });

  it("uses explicit per-slide why_it_works from aesthetic slides", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: {
        why_it_worked: "deck-level why",
        slides: [
          { slide_index: 1, slide_purpose: "hook", why_it_works: LONG_SLIDE_WHY_1 },
          { slide_index: 2, slide_purpose: "content", why_it_works: LONG_SLIDE_WHY_2 },
        ],
      },
    });
    expect(bundle!.slides[0].why_it_works).toBe(LONG_SLIDE_WHY_1);
    expect(bundle!.slides[1].why_it_works).toBe(LONG_SLIDE_WHY_2);
    expect(bundle!.slides[1].why_it_works).not.toBe("deck-level why");
  });

  it("does not invent symbolism on the heuristic path but normalizes explicit symbols", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: {
        slides: [
          {
            slide_index: 1,
            slide_purpose: "cover",
            symbolic_elements: [
              { element: "castle", denotation: "a stone fortress", connotations: ["exclusivity", "mystery", "aspiration"] },
              "fog",
            ],
          },
        ],
      },
    });
    const sym = bundle!.slides[0].symbolic_elements;
    expect(sym[0].element).toBe("castle");
    expect(sym[0].connotations).toEqual(["exclusivity", "mystery", "aspiration"]);
    expect(sym[1]).toEqual({ element: "fog", denotation: null, connotations: [] });
  });

  it("handles single-image media kind", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: { slide_purpose: "single image post", why_it_worked: "clean visual" },
      mediaKind: "image",
    });
    expect(bundle!.slides).toHaveLength(1);
    expect(bundle!.media_kind).toBe("image");
  });

  it("returns null when there is no usable analysis", () => {
    expect(deriveSlideIntelligenceFromAnalysis({ aesthetic: {} })).toBeNull();
    expect(deriveSlideIntelligenceFromAnalysis({ aesthetic: null })).toBeNull();
  });
});

describe("parseSlideIntelligenceBundle / round-trip", () => {
  it("round-trips a derived bundle through JSON", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: carouselAesthetic });
    const round = parseSlideIntelligenceBundle(JSON.parse(JSON.stringify(bundle)));
    expect(round).not.toBeNull();
    expect(round!.slides.map((s) => s.slide_role)).toEqual(
      bundle!.slides.map((s) => s.slide_role)
    );
    expect(round!.why_analysis!.narrative_spine).toEqual(bundle!.why_analysis!.narrative_spine);
  });

  it("rejects non-SIL payloads", () => {
    expect(parseSlideIntelligenceBundle(null)).toBeNull();
    expect(parseSlideIntelligenceBundle({ schema_version: "something_else" })).toBeNull();
  });
});

describe("pickOrDeriveSlideIntelligence", () => {
  it("prefers a stored bundle and falls back to derivation", () => {
    const stored = deriveSlideIntelligenceFromAnalysis({ aesthetic: carouselAesthetic });
    const fromStore = pickOrDeriveSlideIntelligence(stored, { aesthetic: {} });
    expect(fromStore!.slides).toHaveLength(4);

    const fromFallback = pickOrDeriveSlideIntelligence(null, { aesthetic: carouselAesthetic });
    expect(fromFallback!.slides).toHaveLength(4);
  });
});

describe("slideIntelligenceCues", () => {
  it("produces prompt-ready cues", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: carouselAesthetic });
    const cues = slideIntelligenceCues(bundle);
    expect(cues.some((c) => c.startsWith("Why it works:"))).toBe(true);
    expect(cues.some((c) => c.startsWith("Narrative spine:"))).toBe(true);
  });
});

describe("buildWhyMimicPromptBlock", () => {
  it("emits a strategic-function block with deck intent and per-slide lines", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: carouselAesthetic,
      rowLevel: { primary_emotion: "curiosity", hook_type: "information_gap" },
    });
    const block = buildWhyMimicPromptBlock(bundle);
    expect(block).not.toBeNull();
    expect(block!).toContain("preserve the strategic FUNCTION");
    expect(block!).toContain("Strategic intent");
    expect(block!).toMatch(/Slide 1 \[cover\]/);
    expect(block!).toMatch(/Slide 4 \[cta\]/);
    expect(block!).toMatch(/Imagery:/);
  });

  it("returns null for an empty bundle", () => {
    expect(buildWhyMimicPromptBlock(null)).toBeNull();
  });
});

describe("resolveSlideIntelligenceForOutputSlide", () => {
  it("finds Nemotron row by source deck index when output slide differs", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({ aesthetic: carouselAesthetic });
    const gemini = bundle.slides.find((s) => s.slide_index === 3);
    expect(gemini).toBeTruthy();
    const resolved = resolveSlideIntelligenceForOutputSlide(bundle, 3, 3);
    expect(resolved?.slide_index).toBe(3);
    expect(resolved?.on_screen_text_transcript).toBe(gemini?.on_screen_text_transcript);
  });
});
