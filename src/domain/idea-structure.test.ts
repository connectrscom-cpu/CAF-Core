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

  it("maps hook-first niche video to FLOW_VID_HOOK_FIRST target", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "video",
      content_lens: "niche",
      video_style: "hook_first",
      execution_profile: "hook_first",
      title: "Shock fridge reveal → meal prep tip",
    });
    expect(row.target_flow_type).toBe("FLOW_VID_HOOK_FIRST");
    expect(row.video_style).toBe("hook_first");
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

  it("maps generic post idea to FLOW_TEXT", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "post",
      content_lens: "niche",
      platform: "LinkedIn",
      title: "Governance insight",
    });
    expect(row.target_flow_type).toBe("FLOW_TEXT");
  });

  it("maps linkedin_text idea to FLOW_LINKEDIN_TEXT_POST", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "linkedin_text",
      content_lens: "niche",
      title: "Vault insight post",
    });
    expect(row.target_flow_type).toBe("FLOW_LINKEDIN_TEXT_POST");
    expect(row.platform).toBe("LinkedIn");
  });

  it("maps reddit_post idea to FLOW_REDDIT_POST", () => {
    const row = applyIdeaStructureToPlannerRow({
      format: "reddit_post",
      content_lens: "niche",
      title: "AMA thread idea",
    });
    expect(row.target_flow_type).toBe("FLOW_REDDIT_POST");
    expect(row.platform).toBe("Reddit");
  });

  it("default quotas use generic post/thread buckets", () => {
    const q = defaultIdeaGenerationQuotas(40, false);
    expect(q.buckets.niche_post).toBeGreaterThan(0);
    expect(q.buckets.niche_thread).toBeGreaterThan(0);
    expect(q.buckets.niche_linkedin_text ?? 0).toBe(0);
  });
});
