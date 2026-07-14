import { describe, expect, it } from "vitest";
import { shouldShowMimicOriginalReference } from "@/lib/flow-kind";

describe("shouldShowMimicOriginalReference", () => {
  it("includes manual mimic, why mimic, and mimic video/image", () => {
    expect(shouldShowMimicOriginalReference("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL")).toBe(true);
    expect(shouldShowMimicOriginalReference("FLOW_WHY_MIMIC_CAROUSEL")).toBe(true);
    expect(shouldShowMimicOriginalReference("FLOW_TOP_PERFORMER_MIMIC_VIDEO")).toBe(true);
    expect(shouldShowMimicOriginalReference("FLOW_TOP_PERFORMER_MIMIC_IMAGE")).toBe(true);
  });

  it("excludes visual-first and new_visual execution mode", () => {
    expect(shouldShowMimicOriginalReference("FLOW_VISUAL_FIRST_CAROUSEL")).toBe(false);
    expect(
      shouldShowMimicOriginalReference("FLOW_WHY_MIMIC_CAROUSEL", {
        mimic_v1: { execution_mode: "new_visual" },
      })
    ).toBe(false);
  });
});
