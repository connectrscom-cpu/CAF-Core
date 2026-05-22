import { describe, expect, it } from "vitest";
import {
  findCarouselSlidesNeedingRetry,
  findMissingCarouselSlideIndices,
  findWeakCarouselSlideIndices,
  isWeakCarouselSlide,
  mergeCarouselInsightChunks,
  normalizeCarouselInsightsLlmJson,
  remapChunkSlideIndices,
  sanitizeCarouselSlides,
} from "./carousel-insights-llm-normalize.js";

describe("normalizeCarouselInsightsLlmJson", () => {
  it("unwraps deck.slides and hoists deck-wide fields", () => {
    const out = normalizeCarouselInsightsLlmJson({
      deck: {
        slide_arc: "List progression",
        format_pattern: "listicle",
        why_it_worked: "Clear hooks",
        cta_clarity: "Link in bio",
        slides: [
          {
            slide_index: 1,
            on_screen_text_transcript: "VERY STRONG BREW",
            text_density: "70% text coverage",
          },
        ],
      },
    });
    expect(out?.format_pattern).toBe("listicle");
    expect(out?.why_it_worked).toBe("Clear hooks");
    expect(out?.cta_clarity).toBe("Link in bio");
    expect(Array.isArray(out?.slides)).toBe(true);
    expect((out?.slides as unknown[]).length).toBe(1);
    expect((out?.slides as Record<string, unknown>[])[0]?.text_density).toBe("high");
  });

  it("maps hook_type and cta_type aliases", () => {
    const out = normalizeCarouselInsightsLlmJson({
      hook_type: "mixed",
      cta_type: "Comment your sign",
      slides: [{ slide_index: 1, on_screen_text_transcript: "Aries" }],
    });
    expect(out?.format_pattern).toBe("mixed");
    expect(out?.cta_clarity).toBe("Comment your sign");
  });

  it("strips garbage keys from deck_visual_system", () => {
    const out = normalizeCarouselInsightsLlmJson({
      format_pattern: "mixed",
      deck_visual_system: {
        overall_aesthetic: "meme grid",
        mlm_data: { should: "disappear" },
      },
      slides: [{ slide_index: 1, on_screen_text_transcript: "Aries" }],
    });
    const dvs = out?.deck_visual_system as Record<string, unknown>;
    expect(dvs.overall_aesthetic).toBe("meme grid");
    expect(dvs.mlm_data).toBeUndefined();
  });

  it("strips garbage from replication_blueprint and root mlm_data", () => {
    const out = normalizeCarouselInsightsLlmJson({
      format_pattern: "promo",
      mlm_data: { summary: "bad" },
      replication_blueprint: {
        steps_to_remake: ["step"],
        classifier_input: "drop me",
      },
      slides: [{ slide_index: 1, on_screen_text_transcript: "Buy" }],
    });
    expect(out?.mlm_data).toBeUndefined();
    const bp = out?.replication_blueprint as Record<string, unknown>;
    expect(bp.steps_to_remake).toEqual(["step"]);
    expect(bp.classifier_input).toBeUndefined();
  });
});

describe("sanitizeCarouselSlides", () => {
  it("drops out-of-range indices and keeps richer duplicate OCR", () => {
    const out = sanitizeCarouselSlides(
      [
        { slide_index: 1, on_screen_text_transcript: "short" },
        { slide_index: 1, on_screen_text_transcript: "much longer transcript on slide one" },
        { slide_index: 99, on_screen_text_transcript: "wrong deck" },
        { slide_index: 2, on_screen_text_transcript: "two" },
      ],
      3
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.slide_index).toBe(1);
    expect(out[0]?.on_screen_text_transcript).toBe("much longer transcript on slide one");
    expect(out[1]?.slide_index).toBe(2);
  });

  it("prefers non-hallucinated duplicate slide_index", () => {
    const out = sanitizeCarouselSlides(
      [
        {
          slide_index: 9,
          on_screen_text_transcript: "Want a closer look at my @FashionNova?",
          visual_description: "product collage",
        },
        {
          slide_index: 9,
          on_screen_text_transcript: "Gemini: slow down and listen to your body this week.",
          visual_description: "text on green background",
        },
      ],
      12
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.on_screen_text_transcript).toContain("Gemini");
  });
});

describe("findMissingCarouselSlideIndices", () => {
  it("returns gaps in 1..N", () => {
    expect(
      findMissingCarouselSlideIndices(
        [{ slide_index: 1 }, { slide_index: 3 }, { slide_index: 12 }],
        5
      )
    ).toEqual([2, 4, 5]);
  });
});

describe("weak slide detection", () => {
  it("flags FashionNova hallucinations and hashtag-only bleed", () => {
    expect(
      isWeakCarouselSlide({
        slide_index: 9,
        on_screen_text_transcript: "Want a closer look at my @FashionNova?",
      })
    ).toBe(true);
    expect(
      isWeakCarouselSlide({
        slide_index: 5,
        on_screen_text_transcript: "#moonomens #astrology",
      })
    ).toBe(true);
    expect(
      isWeakCarouselSlide({
        slide_index: 3,
        on_screen_text_transcript: "Aries: take a breath before you reply.",
        visual_description: "white text centered on dark green background",
      })
    ).toBe(false);
  });

  it("findCarouselSlidesNeedingRetry unions missing and weak indices", () => {
    const slides = [
      { slide_index: 1, on_screen_text_transcript: "Hook slide text here" },
      { slide_index: 3, on_screen_text_transcript: "#moonomens #astrology" },
    ];
    expect(findWeakCarouselSlideIndices(slides, 4)).toEqual([2, 3, 4]);
    expect(findCarouselSlidesNeedingRetry(slides, 4)).toEqual([2, 3, 4]);
  });
});

describe("remapChunkSlideIndices", () => {
  it("remaps local 1..k indices to global chunk range", () => {
    const out = remapChunkSlideIndices(
      {
        slides: [
          { slide_index: 1, on_screen_text_transcript: "Five" },
          { slide_index: 2, on_screen_text_transcript: "Six" },
        ],
      },
      5,
      2
    );
    expect((out?.slides as Record<string, unknown>[])[0]?.slide_index).toBe(5);
    expect((out?.slides as Record<string, unknown>[])[1]?.slide_index).toBe(6);
  });

  it("preserves already-global indices", () => {
    const out = remapChunkSlideIndices(
      {
        slides: [
          { slide_index: 9, on_screen_text_transcript: "Nine" },
          { slide_index: 10, on_screen_text_transcript: "Ten" },
        ],
      },
      9,
      2
    );
    expect((out?.slides as Record<string, unknown>[])[0]?.slide_index).toBe(9);
    expect((out?.slides as Record<string, unknown>[])[1]?.slide_index).toBe(10);
  });
});

describe("mergeCarouselInsightChunks", () => {
  it("merges deck chunk with slide-only follow-up chunks", () => {
    const merged = mergeCarouselInsightChunks(
      [
        {
          format_pattern: "listicle",
          why_it_worked: "Strong arc",
          primary_emotion: "curiosity",
          slides: [
            { slide_index: 1, on_screen_text_transcript: "One" },
            { slide_index: 2, on_screen_text_transcript: "Two" },
          ],
        },
        {
          slides: [
            { slide_index: 3, on_screen_text_transcript: "Three" },
            { slide_index: 4, on_screen_text_transcript: "Four" },
          ],
        },
      ],
      4
    );
    expect(merged.format_pattern).toBe("listicle");
    expect(merged.why_it_worked).toBe("Strong arc");
    expect(merged.primary_emotion).toBe("curiosity");
    expect(merged.slides).toHaveLength(4);
    expect((merged.slides as Record<string, unknown>[])[3]?.on_screen_text_transcript).toBe("Four");
  });

  it("hoists deck fields from later chunks when first chunk is slides-only", () => {
    const merged = mergeCarouselInsightChunks([
      {
        slides: [{ slide_index: 1, on_screen_text_transcript: "Cover" }],
      },
      {
        format_pattern: "story",
        why_it_worked: "Relatable hook",
        slides: [{ slide_index: 2, on_screen_text_transcript: "Body" }],
      },
    ]);
    expect(merged.format_pattern).toBe("story");
    expect(merged.why_it_worked).toBe("Relatable hook");
    expect(merged.slides).toHaveLength(2);
  });
});
