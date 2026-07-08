import { describe, expect, it } from "vitest";
import {
  applyIdeaStructureToPlannerRow,
  defaultIdeaGenerationQuotas,
  PRODUCT_ANGLE_TO_FLOW_TYPE,
  resolveTargetFlowTypeFromIdea,
  totalBucketCount,
} from "./idea-structure.js";

describe("idea-structure", () => {
  it("default quotas sum to target", () => {
    const q = defaultIdeaGenerationQuotas(35, true);
    expect(totalBucketCount(q)).toBe(35);
    expect(q.buckets.product_video_problem).toBeGreaterThanOrEqual(0);
    expect(q.buckets.product_video).toBeUndefined();
  });

  it("maps product video angle to FLOW_PRODUCT_* target", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "video",
      content_lens: "product",
      product_angle: "feature",
      execution_profile: "prompt_avatar",
      title: "Feature walkthrough",
    });
    expect(row.target_flow_type).toBe(PRODUCT_ANGLE_TO_FLOW_TYPE.feature);
    expect(row.video_style).toBe("prompt_avatar");
  });

  it("resolveTargetFlowTypeFromIdea returns null for niche video", () => {
    expect(
      resolveTargetFlowTypeFromIdea({
        format: "video",
        content_lens: "niche",
        video_style: "no_avatar",
      })
    ).toBeNull();
  });

  it("defaults use_brand_visual_system for visual-first carousel lane", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "carousel",
      carousel_style: "visual_first",
      visual_first_carousel_lane: true,
      content_idea: "Zodiac style moments",
    });
    expect(row.use_brand_visual_system).toBe(true);
  });
});
