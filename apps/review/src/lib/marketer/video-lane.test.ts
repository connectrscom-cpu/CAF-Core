import { describe, expect, it } from "vitest";
import {
  flowTypeForVideoIntent,
  isVideoTopPerformerItem,
  resolveRecommendedVideoIntent,
} from "./video-lane";

describe("resolveRecommendedVideoIntent", () => {
  it("maps talking_head to script avatar", () => {
    expect(resolveRecommendedVideoIntent("talking_head")).toBe("script_avatar");
  });

  it("maps b_roll to no avatar", () => {
    expect(resolveRecommendedVideoIntent("b_roll")).toBe("no_avatar");
  });
});

describe("isVideoTopPerformerItem", () => {
  it("detects video via videoIntent", () => {
    expect(isVideoTopPerformerItem({ videoIntent: "prompt_avatar" })).toBe(true);
  });

  it("detects video via format pattern", () => {
    expect(isVideoTopPerformerItem({ format: "product_demo" })).toBe(true);
  });
});

describe("flowTypeForVideoIntent", () => {
  it("maps script avatar to FLOW_VID_SCRIPT", () => {
    expect(flowTypeForVideoIntent("script_avatar")).toBe("FLOW_VID_SCRIPT");
  });

  it("maps hook_first to FLOW_VID_HOOK_FIRST", () => {
    expect(flowTypeForVideoIntent("hook_first")).toBe("FLOW_VID_HOOK_FIRST");
  });
});
