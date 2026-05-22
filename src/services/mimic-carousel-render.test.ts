import { describe, expect, it } from "vitest";
import { slideVisionHints, mimicCarouselNeedsBackgroundPlate } from "./mimic-carousel-render.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

function baseMimic(visualGuideline: Record<string, unknown>): MimicPayloadV1 {
  return {
    schema_version: 1,
    mode: "carousel_visual",
    classified_at: "2026-01-01T00:00:00.000Z",
    source_insights_id: "ins_a",
    analysis_tier: "top_performer_carousel",
    reference_items: [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/a.jpg",
      },
    ],
    twist_brief: { visual_only: true, legal_note: "pattern only" },
    visual_guideline: visualGuideline,
  };
}

describe("slideVisionHints", () => {
  it("reads layout and visual cues from visual_guideline.slides", () => {
    const mimic = baseMimic({
      slides: [
        {
          slide_index: 2,
          layout_template: "center stack",
          visual_description: "Soft gradient with icon row",
        },
      ],
    });
    expect(slideVisionHints(mimic, 2)).toEqual({
      layout: "center stack",
      visual: "Soft gradient with icon row",
    });
  });

  it("returns empty hints when slide metadata is missing", () => {
    expect(slideVisionHints(baseMimic({ slides: null }), 1)).toEqual({});
  });
});

describe("mimicCarouselNeedsBackgroundPlate", () => {
  it("skips bg extract for full-bleed carousel_visual decks", () => {
    const mimic = baseMimic({});
    mimic.slide_plans = [
      { slide_index: 1, reference_index: 1, render_mode: "full_bleed" },
      { slide_index: 2, reference_index: 2, render_mode: "full_bleed" },
    ];
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(false);
  });

  it("requires bg plate for template_bg and hbs slides", () => {
    const mimic = baseMimic({});
    mimic.mode = "template_bg";
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(true);

    mimic.mode = "carousel_visual";
    mimic.slide_plans = [{ slide_index: 3, reference_index: 1, render_mode: "hbs" }];
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(true);
  });
});
