import { describe, expect, it } from "vitest";
import { isNewVisualCarouselIdea, newVisualCarouselLaneLabel } from "./visual-first-carousel-idea";

describe("visual-first-carousel-idea", () => {
  it("detects visual_first and mixed carousel ideas", () => {
    expect(isNewVisualCarouselIdea({ format: "carousel", carousel_style: "visual_first" })).toBe(true);
    expect(isNewVisualCarouselIdea({ format: "carousel", execution_profile: "mixed" })).toBe(true);
    expect(
      isNewVisualCarouselIdea({ format: "carousel", target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL" })
    ).toBe(true);
  });

  it("rejects text-heavy carousels and non-carousel formats", () => {
    expect(isNewVisualCarouselIdea({ format: "carousel", carousel_style: "text_heavy" })).toBe(false);
    expect(isNewVisualCarouselIdea({ format: "video", carousel_style: "visual_first" })).toBe(false);
  });

  it("labels the new visual lane", () => {
    expect(newVisualCarouselLaneLabel({ carousel_style: "visual_first" })).toBe("New visual");
    expect(newVisualCarouselLaneLabel({ execution_profile: "mixed" })).toBe("New visual · mixed");
  });
});
