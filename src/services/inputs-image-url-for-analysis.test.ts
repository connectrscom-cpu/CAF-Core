import { describe, expect, it } from "vitest";
import { isVideoLikeEvidence, pickPrimaryImageUrlForDeepAnalysis } from "./inputs-image-url-for-analysis.js";

describe("inputs-image-url-for-analysis", () => {
  it("skips TikTok entirely", () => {
    expect(pickPrimaryImageUrlForDeepAnalysis("tiktok_video", { url: "https://example.com/a.jpg" })).toBeNull();
  });

  it("picks Reddit jpg media_url", () => {
    expect(
      pickPrimaryImageUrlForDeepAnalysis("reddit_post", {
        media_url: "https://i.redd.it/abc.jpg",
      })
    ).toMatch(/^https:\/\/i\.redd\.it\//);
  });

  it("skips Instagram video", () => {
    expect(
      pickPrimaryImageUrlForDeepAnalysis("instagram_post", {
        media_type: "Video",
        post_url: "https://www.instagram.com/reel/xyz/",
      })
    ).toBeNull();
  });

  it("isVideoLikeEvidence for reel URL on Facebook", () => {
    expect(
      isVideoLikeEvidence("facebook_post", {
        url: "https://www.facebook.com/reel/123/",
        isVideo: "FALSE",
      })
    ).toBe(true);
  });
});
