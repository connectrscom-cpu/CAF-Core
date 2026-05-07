import { describe, expect, it } from "vitest";
import { editorialOverrideRequestsCarouselRerender } from "./editorial-copy-apply.js";

describe("editorialOverrideRequestsCarouselRerender", () => {
  it("is true when slides JSON string includes carousel px", () => {
    expect(
      editorialOverrideRequestsCarouselRerender({
        final_slides_json_override: JSON.stringify({
          slides: [{ headline: "A", body: "B" }],
          carousel_body_font_px: 64,
        }),
      })
    ).toBe(true);
  });

  it("is true when slides JSON string includes font_scale only", () => {
    expect(
      editorialOverrideRequestsCarouselRerender({
        final_slides_json_override: JSON.stringify({ font_scale: 1.1, slides: [] }),
      })
    ).toBe(true);
  });

  it("is false when only slide copy changes", () => {
    expect(
      editorialOverrideRequestsCarouselRerender({
        final_slides_json_override: JSON.stringify({
          slides: [{ headline: "New", body: "Copy" }],
        }),
      })
    ).toBe(false);
  });

  it("reads object-shaped override from API", () => {
    expect(
      editorialOverrideRequestsCarouselRerender({
        final_slides_json_override: {
          carousel_headline_font_px: 80,
          slides: [],
        },
      })
    ).toBe(true);
  });
});
