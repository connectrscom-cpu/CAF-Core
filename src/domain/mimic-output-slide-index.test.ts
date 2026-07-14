import { describe, expect, it } from "vitest";
import { sourceSlideIndexForMimicOutput } from "./mimic-output-slide-index.js";

describe("sourceSlideIndexForMimicOutput", () => {
  it("prefers slide_plans.source_slide_index over positional reference_items offset", () => {
    const mimic = {
      slide_plans: [
        { slide_index: 1, source_slide_index: 2 },
        { slide_index: 2, source_slide_index: 3 },
        { slide_index: 3, source_slide_index: 3 },
      ],
      reference_items: [
        { index: 2, source_slide_index: 2 },
        { index: 3, source_slide_index: 4 },
        { index: 4, source_slide_index: 4 },
      ],
    };
    expect(sourceSlideIndexForMimicOutput(mimic, 3)).toBe(3);
  });

  it("prefers reference_items row keyed to output slide before positional offset", () => {
    const mimic = {
      reference_items: [
        { index: 1, source_slide_index: 1 },
        { index: 3, source_slide_index: 3 },
        { index: 4, source_slide_index: 4 },
      ],
    };
    expect(sourceSlideIndexForMimicOutput(mimic, 3)).toBe(3);
    expect(sourceSlideIndexForMimicOutput(mimic, 2)).toBe(3);
  });

  it("falls back to reference_items[output-1].source_slide_index when plan is absent", () => {
    const mimic = {
      reference_items: [
        { index: 1, source_slide_index: 1 },
        { index: 3, source_slide_index: 3 },
        { index: 4, source_slide_index: 4 },
      ],
    };
    expect(sourceSlideIndexForMimicOutput(mimic, 2)).toBe(3);
  });

  it("returns output index when no mapping metadata exists", () => {
    expect(sourceSlideIndexForMimicOutput({ reference_items: [] }, 5)).toBe(5);
  });
});
