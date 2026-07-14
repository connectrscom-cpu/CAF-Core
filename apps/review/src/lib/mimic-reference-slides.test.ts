import { describe, expect, it } from "vitest";
import { mimicReferenceUrlForSlide } from "@/lib/mimic-reference-slides";

describe("mimicReferenceUrlForSlide", () => {
  it("prefers reference item keyed to output slide index", () => {
    const mimicV1 = {
      reference_items: [
        {
          index: 3,
          source_slide_index: 3,
          public_url: "https://cdn.example.com/ref-slide-3.jpg",
        },
        {
          index: 4,
          source_slide_index: 4,
          public_url: "https://cdn.example.com/ref-slide-4.jpg",
        },
      ],
    };
    expect(mimicReferenceUrlForSlide(mimicV1, 3, 12)).toBe(
      "https://cdn.example.com/ref-slide-3.jpg"
    );
  });

  it("does not cycle reference_items array position when index lookup misses", () => {
    const mimicV1 = {
      reference_items: [
        { index: 4, source_slide_index: 4, public_url: "https://cdn.example.com/ref-slide-4.jpg" },
      ],
    };
    expect(mimicReferenceUrlForSlide(mimicV1, 3, 12)).toBeUndefined();
  });
});
