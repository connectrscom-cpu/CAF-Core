import { describe, expect, it } from "vitest";
import {
  isDarkCelestialDeck,
  mimicSlideLayoutPatch,
  mimicSlideTypographyPatch,
  parseRelativeScaleHeadlinePx,
} from "./mimic-slide-typography.js";

describe("mimic-slide-typography", () => {
  it("detects dark celestial decks from deck_visual_system", () => {
    expect(
      isDarkCelestialDeck({
        deck_visual_system: {
          overall_aesthetic: "dark, celestial, reflective",
          repeated_template: "centered text over celestial backgrounds",
        },
      })
    ).toBe(true);
  });

  it("maps relative_scale tiers to headline px", () => {
    expect(parseRelativeScaleHeadlinePx("headline lg vs slide")).toBe(80);
    expect(parseRelativeScaleHeadlinePx("12% of slide height")).toBe(120);
  });

  it("centers text when deck says centered text over backgrounds", () => {
    const layout = mimicSlideLayoutPatch(
      {
        deck_visual_system: {
          repeated_template: "centered text over celestial backgrounds; similar layout across slides",
        },
      },
      2
    );
    expect(layout.mimic_text_align).toBe("center");
    expect(layout.mimic_page_justify).toBe("center");
  });

  it("derives typography patch from per-slide vision analysis", () => {
    const patch = mimicSlideTypographyPatch(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              typography: {
                relative_scale: "lg",
                text_placement: "center band",
              },
            },
          ],
          deck_visual_system: { overall_aesthetic: "dark, celestial" },
        },
      },
      1,
      3
    );
    expect(patch.carousel_headline_font_px).toBe(80);
    expect(patch.carousel_body_font_px).toBeGreaterThan(30);
    expect(patch.mimic_text_align).toBe("center");
  });
});
