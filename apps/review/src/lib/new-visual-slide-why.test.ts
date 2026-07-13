import { describe, expect, it } from "vitest";
import {
  buildNewVisualSlideWhyContext,
  isNewVisualCarouselMimic,
  newVisualSlideRole,
} from "./new-visual-slide-why";

describe("new-visual-slide-why", () => {
  it("detects new visual mimic payloads", () => {
    expect(
      isNewVisualCarouselMimic({
        execution_mode: "new_visual",
        mode: "carousel_visual",
        reference_items: [],
      })
    ).toBe(true);
    expect(
      isNewVisualCarouselMimic({
        mode: "carousel_visual",
        reference_items: [{ slide_index: 1 }],
      })
    ).toBe(false);
  });

  it("resolves slide roles", () => {
    expect(newVisualSlideRole(1, 5)).toBe("hook");
    expect(newVisualSlideRole(3, 5)).toBe("content");
    expect(newVisualSlideRole(5, 5)).toBe("cta");
  });

  it("builds per-slide strategy from idea + generated slides", () => {
    const ctx = buildNewVisualSlideWhyContext({
      generationPayload: {
        candidate_data: {
          title: "Meal Planning Made Easy",
          thesis: "Weeknight dinners without stress",
          novelty_angle: "Joyful systems over rigid meal prep",
          key_points: ["Batch prep", "Theme nights"],
        },
        generated_output: {
          slides: [
            {
              slide_index: 1,
              headline: "Hook line",
              visual_direction: "Warm kitchen hero with organized ingredients.",
              visual_metaphor: "calm control",
            },
          ],
        },
      },
      mimicV1: {
        execution_mode: "new_visual",
        mode: "carousel_visual",
        reference_items: [],
        visual_guideline: { deck_concept: "Meal Planning Made Easy" },
      },
      slideIndex: 1,
      slideCount: 5,
      generatedOnScreenText: "Hook line",
    });

    expect(ctx?.deckConcept).toBe("Meal Planning Made Easy");
    expect(ctx?.slideRole).toBe("hook");
    expect(ctx?.visualDirection).toContain("Warm kitchen hero");
    expect(ctx?.generatedCopy).toBe("Hook line");
  });
});
