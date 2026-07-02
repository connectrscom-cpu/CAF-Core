import { describe, expect, it } from "vitest";
import {
  marketerRenderFailureHeadline,
  parseFailedSlideFromError,
  resolveSlideRenderStatuses,
} from "./slide-render-status";

describe("parseFailedSlideFromError", () => {
  it("extracts slide index from renderer message", () => {
    expect(
      parseFailedSlideFromError("Renderer slide 5 request failed: TypeError: fetch failed")
    ).toBe(5);
  });
});

describe("marketerRenderFailureHeadline", () => {
  it("hides raw TypeError in headline", () => {
    const headline = marketerRenderFailureHeadline({ failedSlide: 5, kind: "text_reprint" });
    expect(headline).toContain("Slide 5");
    expect(headline).not.toContain("TypeError");
  });
});

describe("resolveSlideRenderStatuses", () => {
  it("marks failed slide from reprint error", () => {
    const states = resolveSlideRenderStatuses({
      slideCount: 5,
      taskAssets: [{ position: 0, public_url: "https://a/1.png", kind: "image" }],
      textOverlayReprint: {
        active: false,
        failed: true,
        status: "failed",
        error: "Renderer slide 5 request failed: TypeError: fetch failed",
        requested_at: null,
        completed_at: null,
        slide_indices: "all slides",
      },
    });
    expect(states[4].status).toBe("failed");
    expect(states[0].status).toBe("ready");
  });
});
