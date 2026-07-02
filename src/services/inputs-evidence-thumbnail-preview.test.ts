import { describe, expect, it } from "vitest";
import {
  evidenceThumbnailFromPayload,
  isLikelySocialPostPageUrl,
  pickBrowserPreviewFromInspectionMedia,
} from "./inputs-evidence-thumbnail-preview.js";

describe("isLikelySocialPostPageUrl", () => {
  it("flags instagram permalinks", () => {
    expect(isLikelySocialPostPageUrl("https://www.instagram.com/p/ABC123/")).toBe(true);
  });

  it("allows cdn image urls", () => {
    expect(isLikelySocialPostPageUrl("https://scontent.cdninstagram.com/v/t51.2885-15/x.jpg")).toBe(false);
  });
});

describe("evidenceThumbnailFromPayload", () => {
  it("prefers display_url over post permalink", () => {
    expect(
      evidenceThumbnailFromPayload({
        url: "https://www.instagram.com/p/ABC123/",
        display_url: "https://scontent.cdninstagram.com/v/t51.2885-15/x.jpg",
      })
    ).toBe("https://scontent.cdninstagram.com/v/t51.2885-15/x.jpg");
  });

  it("uses first carousel slide when present", () => {
    expect(
      evidenceThumbnailFromPayload({
        carousel_slide_urls: "https://cdn.example.com/s1.jpg|https://cdn.example.com/s2.jpg",
      })
    ).toBe("https://cdn.example.com/s1.jpg");
  });
});

describe("pickBrowserPreviewFromInspectionMedia", () => {
  it("skips vision_fetch post permalinks", () => {
    expect(
      pickBrowserPreviewFromInspectionMedia({
        items: [
          {
            role: "carousel_slide",
            vision_fetch_url: "https://www.instagram.com/p/ABC/",
            public_url: "https://storage.example.com/slide_01.jpg",
          },
        ],
      })
    ).toBe("https://storage.example.com/slide_01.jpg");
  });
});
