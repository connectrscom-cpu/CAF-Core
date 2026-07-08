import { describe, expect, it } from "vitest";
import {
  buildContentDisplayV1,
  pickCandidateDisplayTitle,
  pickTitleFromGeneratedOutput,
} from "./content-display-metadata.js";
import {
  enforceVisualFirstCarouselCopyBudget,
  VISUAL_FIRST_BODY_MAX_CHARS,
} from "./visual-first-carousel-copy-budget.js";

describe("content-display-metadata", () => {
  it("builds title from candidate content_idea", () => {
    const display = buildContentDisplayV1({
      candidateData: { content_idea: "Zodiac style moments for July" },
      flowType: "FLOW_VISUAL_FIRST_CAROUSEL",
      platform: "Instagram",
    });
    expect(display.title).toBe("Zodiac style moments for July");
    expect(display.flow_label).toBe("Brand-style carousel");
  });

  it("prefers generated deck headline over empty top-level title", () => {
    const title = pickTitleFromGeneratedOutput({
      slides: [{ headline: "Aries — bold red energy" }],
    });
    expect(title).toBe("Aries — bold red energy");
  });

  it("pickCandidateDisplayTitle skips opaque ids when summary exists", () => {
    expect(
      pickCandidateDisplayTitle({
        idea_id: "idea_12",
        summary: "Style moments by sign",
      })
    ).toBe("Style moments by sign");
  });
});

describe("visual-first-carousel-copy-budget", () => {
  it("clamps long body copy and ensures final-slide cta", () => {
    const longBody = "A".repeat(240);
    const out = enforceVisualFirstCarouselCopyBudget({
      slides: [
        { headline: "Intro", body: longBody },
        { headline: "Aries", body: longBody },
        { headline: "Follow us", body: longBody },
      ],
    });
    const slides = out.slides as Record<string, unknown>[];
    expect(String(slides[1]?.body ?? "").length).toBeLessThanOrEqual(VISUAL_FIRST_BODY_MAX_CHARS + 4);
    expect(String(slides[2]?.cta ?? "").length).toBeGreaterThan(0);
  });
});
