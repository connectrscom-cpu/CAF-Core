import { describe, expect, it } from "vitest";
import { slideIndicesFromEditsSummary } from "./CarouselSlideReworkPicker";

describe("slideIndicesFromEditsSummary", () => {
  it("parses Slide N from edits summary", () => {
    expect(slideIndicesFromEditsSummary(["Caption", "Slide 3", "Slide 7"])).toEqual([3, 7]);
  });
});
