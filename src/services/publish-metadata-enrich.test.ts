import { describe, expect, it } from "vitest";
import { enrichGeneratedOutputForReview } from "./publish-metadata-enrich.js";

describe("enrichGeneratedOutputForReview", () => {
  it("truncates carousel slides to maxSlides, keeping first and last", () => {
    const out = enrichGeneratedOutputForReview(
      "Flow_Carousel_Copy",
      {
        structure_variables: { slide_count: 28 },
        slides: Array.from({ length: 6 }, (_, i) => ({ headline: `H${i + 1}` })),
      },
      { maxSlides: 4 }
    );
    expect(Array.isArray(out.slides)).toBe(true);
    const slides = out.slides as Array<{ headline?: string }>;
    expect(slides.map((s) => s.headline)).toEqual(["H1", "H2", "H3", "H6"]);
    expect((out.structure_variables as { slide_count?: number }).slide_count).toBe(4);
  });

  it("truncates variations[0].slides when present", () => {
    const out = enrichGeneratedOutputForReview(
      "Flow_Carousel_Copy",
      {
        structure_variables: { slide_count: 10 },
        variations: [
          { variation_name: "V1", slides: [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }] },
        ],
      },
      { maxSlides: 3 }
    );
    const v0 = (out.variations as Array<{ slides?: unknown[] }>)[0]!;
    expect((v0.slides ?? []).length).toBe(3);
    expect((out.structure_variables as { slide_count?: number }).slide_count).toBe(3);
  });
});

