import { describe, expect, it } from "vitest";
import {
  enforceVisualFirstCarouselVisualDirection,
  extractVisualFirstSlideVisualFields,
  VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS,
} from "./visual-first-carousel-visual-direction.js";
import { enforceVisualFirstCarouselCopyBudget } from "./visual-first-carousel-copy-budget.js";

describe("visual-first-carousel-visual-direction", () => {
  it("extracts and truncates visual fields from slide rows", () => {
    const fields = extractVisualFirstSlideVisualFields({
      visual_direction: "A".repeat(400),
      visual_metaphor: "repetition",
      must_avoid: ["random pets", "stock smile"],
    });
    expect(fields.visual_direction?.length).toBeLessThanOrEqual(VISUAL_FIRST_VISUAL_DIRECTION_MAX_CHARS + 4);
    expect(fields.visual_metaphor).toBe("repetition");
    expect(fields.must_avoid).toMatch(/random pets/);
  });

  it("synthesizes visual_direction when copy LLM omits it", () => {
    const out = enforceVisualFirstCarouselVisualDirection({
      slides: [{ headline: "Meal prep tips", body: "Mix and match bases." }],
    });
    const slide = (out.slides as Record<string, unknown>[])[0]!;
    expect(String(slide.visual_direction ?? "").length).toBeGreaterThan(20);
    expect(String(slide.visual_direction ?? "")).toMatch(/Meal prep tips|concept-first/i);
  });

  it("enforceVisualFirstCarouselCopyBudget also applies visual direction", () => {
    const out = enforceVisualFirstCarouselCopyBudget({
      slides: [
        {
          headline: "Intro",
          body: "Short body.",
          visual_direction: "Hero kitchen scene with organized prep stations, warm morning light.",
        },
        { headline: "Follow for more", body: "Save this.", cta: "Follow us" },
      ],
    });
    const slides = out.slides as Record<string, unknown>[];
    expect(String(slides[0]?.visual_direction ?? "")).toMatch(/prep stations/i);
    expect(String(slides[1]?.visual_direction ?? "").length).toBeGreaterThan(10);
  });
});
