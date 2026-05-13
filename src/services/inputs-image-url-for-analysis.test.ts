import { describe, expect, it } from "vitest";
import {
  extractHttpsImageUrlsFromLooseString,
  finalizeHttpsImageUrlForOpenAiVision,
  isVideoLikeEvidence,
  normalizeRedditExternalImageHost,
  parseHttpsImageUrlsFromEvidenceCell,
  pickPrimaryImageUrlForDeepAnalysis,
  sanitizeOneHttpsImageUrl,
  trimTrailingJunkFromImageUrl,
  tryLenientSingleHttpsImageUrlFromSocialCdn,
} from "./inputs-image-url-for-analysis.js";

describe("inputs-image-url-for-analysis", () => {
  it("parseHttpsImageUrlsFromEvidenceCell accepts a plain http:// image cell", () => {
    expect(parseHttpsImageUrlsFromEvidenceCell("http://example.com/w.jpg", 3)).toEqual([
      "https://example.com/w.jpg",
    ]);
  });

  it("parseHttpsImageUrlsFromEvidenceCell falls back to lenient Instagram CDN /v/t… paths", () => {
    const ig =
      "https://scontent.cdninstagram.com/v/t51.2885-15/1234567890_9876543210_n?_nc_ht=scontent.cdninstagram.com";
    expect(sanitizeOneHttpsImageUrl(ig)).toBeNull();
    expect(tryLenientSingleHttpsImageUrlFromSocialCdn(ig)).toBeTruthy();
    expect(parseHttpsImageUrlsFromEvidenceCell(ig, 2)).toEqual([ig]);
  });

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

  it("pickPrimaryImageUrlForDeepAnalysis rewrites Reddit external-i host for vision fetch", () => {
    expect(
      pickPrimaryImageUrlForDeepAnalysis("reddit_post", {
        media_url: "https://external-i.redd.it/hL8F2DuvWqpsZ-1seOZDozwRfMZt5MycBCtd2tkh534.jpeg",
      })
    ).toBe("https://i.redd.it/hL8F2DuvWqpsZ-1seOZDozwRfMZt5MycBCtd2tkh534.jpeg");
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

  it("finalizeHttpsImageUrlForOpenAiVision strips trailing period and normalizes Reddit preview host", () => {
    const withDot =
      "https://external-i.redd.it/hL8F2DuvWqpsZ-1seOZDozwRfMZt5MycBCtd2tkh534.jpeg.";
    expect(finalizeHttpsImageUrlForOpenAiVision(withDot)).toBe(
      "https://i.redd.it/hL8F2DuvWqpsZ-1seOZDozwRfMZt5MycBCtd2tkh534.jpeg"
    );
    expect(trimTrailingJunkFromImageUrl("https://x.com/a.png).")).toBe("https://x.com/a.png");
    expect(normalizeRedditExternalImageHost("https://external-preview.redd.it/z.jpg")).toBe(
      "https://i.redd.it/z.jpg"
    );
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
