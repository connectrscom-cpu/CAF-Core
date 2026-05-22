import { describe, expect, it } from "vitest";
import {
  mergeCarouselInsightChunks,
  normalizeCarouselInsightsLlmJson,
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

  it("keeps flat mini-shaped payloads unchanged", () => {
    const input = {
      slide_arc: "Hook to CTA",
      format_pattern: "educational",
      why_it_worked: "Timely theme",
      cta_clarity: "Download guide",
      risk_flags: [],
      slides: [{ slide_index: 1, on_screen_text_transcript: "Line 1", text_density: "medium" }],
    };
    const out = normalizeCarouselInsightsLlmJson(input);
    expect(out?.format_pattern).toBe("educational");
    expect(out?.slides).toEqual(input.slides);
  });
});

describe("mergeCarouselInsightChunks", () => {
  it("merges deck chunk with slide-only follow-up chunks", () => {
    const merged = mergeCarouselInsightChunks([
      {
        format_pattern: "listicle",
        why_it_worked: "Strong arc",
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
    ]);
    expect(merged.format_pattern).toBe("listicle");
    expect(merged.why_it_worked).toBe("Strong arc");
    expect(merged.slides).toHaveLength(4);
    expect((merged.slides as Record<string, unknown>[])[3]?.on_screen_text_transcript).toBe("Four");
  });
});
