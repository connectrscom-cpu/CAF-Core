import { describe, expect, it } from "vitest";
import {
  isBvsTextCarouselOverlayRender,
  isCarouselMimicOverlayRenderJob,
  isStandardCarouselFlow,
  BVS_TEXT_CAROUSEL_EXECUTION_MODE,
} from "./bvs-text-carousel-flow.js";
import { buildBvsSlice } from "./bvs-v1.js";

describe("bvs-text-carousel-flow", () => {
  it("detects standard carousel flow type", () => {
    expect(isStandardCarouselFlow("FLOW_CAROUSEL")).toBe(true);
    expect(isStandardCarouselFlow("Flow_Carousel_Copy")).toBe(true);
    expect(isStandardCarouselFlow("FLOW_VISUAL_FIRST_CAROUSEL")).toBe(false);
  });

  it("detects BVS overlay render on FLOW_CAROUSEL with mimic_v1", () => {
    const payload = {
      bvs_v1: buildBvsSlice(true, 1, { schema_version: "brand_bible_v1", palette: ["#112233"] } as never),
      mimic_v1: {
        schema_version: 1,
        execution_mode: BVS_TEXT_CAROUSEL_EXECUTION_MODE,
        mode: "template_bg",
        bvs_enabled: true,
        source_insights_id: "bvs_text_carousel",
      },
    };
    expect(isBvsTextCarouselOverlayRender("FLOW_CAROUSEL", payload)).toBe(true);
    expect(isCarouselMimicOverlayRenderJob("FLOW_CAROUSEL", payload)).toBe(true);
    expect(isCarouselMimicOverlayRenderJob("FLOW_VISUAL_FIRST_CAROUSEL", payload)).toBe(true);
  });

  it("returns false when BVS off or mimic missing", () => {
    expect(isBvsTextCarouselOverlayRender("FLOW_CAROUSEL", { candidate_data: {} })).toBe(false);
    expect(
      isBvsTextCarouselOverlayRender("FLOW_CAROUSEL", {
        bvs_v1: buildBvsSlice(false, null, null),
      })
    ).toBe(false);
  });
});
