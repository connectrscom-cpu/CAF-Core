import { describe, expect, it } from "vitest";
import {
  extractHttpsImageUrlsFromLooseString,
  isVideoLikeEvidence,
  pickPrimaryImageUrlForDeepAnalysis,
  sanitizeOneHttpsImageUrl,
} from "./inputs-image-url-for-analysis.js";

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

  it("sanitizeOneHttpsImageUrl splits double-pasted URLs (][) for OpenAI", () => {
    const bad =
      "https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png][https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png";
    expect(sanitizeOneHttpsImageUrl(bad)).toBe(
      "https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png"
    );
    expect(extractHttpsImageUrlsFromLooseString(bad, 4)).toHaveLength(1);
    const twoDistinct =
      "https://a.example/x.png][https://b.example/y.jpg";
    expect(extractHttpsImageUrlsFromLooseString(twoDistinct, 4)).toEqual([
      "https://a.example/x.png",
      "https://b.example/y.jpg",
    ]);
  });

  it("pickPrimaryImageUrlForDeepAnalysis uses sanitized og_image on scraped_page", () => {
    const bad =
      "https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png][https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png";
    expect(
      pickPrimaryImageUrlForDeepAnalysis("scraped_page", {
        og_image: bad,
      })
    ).toBe("https://cafeastrology.com/wp-content/uploads/2015/06/sqsagittarius3.png");
  });
});
