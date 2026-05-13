import { describe, expect, it } from "vitest";
import { deriveEvidenceDisplayKind, deriveEvidencePostFormat } from "./inputs-evidence-post-format.js";

describe("deriveEvidencePostFormat", () => {
  it("classifies TikTok as video", () => {
    expect(deriveEvidencePostFormat("tiktok_video", {})).toBe("video");
  });

  it("classifies IG reel as video before carousel", () => {
    expect(
      deriveEvidencePostFormat("instagram_post", {
        media_type: "Reel",
        carousel_slide_urls: ["https://a/1.jpg", "https://a/2.jpg"],
      })
    ).toBe("video");
  });

  it("classifies IG carousel when not video-like", () => {
    expect(
      deriveEvidencePostFormat("instagram_post", {
        media_type: "carousel",
        images: [{ display_url: "https://cdn/1.jpg" }, { display_url: "https://cdn/2.jpg" }],
      })
    ).toBe("carousel");
  });

  it("classifies IG single image", () => {
    expect(
      deriveEvidencePostFormat("instagram_post", {
        display_url: "https://cdn/1.jpg",
      })
    ).toBe("single_image");
  });

  it("classifies IG carousel from post_url img_index when child slide URLs are missing", () => {
    expect(
      deriveEvidencePostFormat("instagram_post", {
        display_url: "https://cdn/1.jpg",
        post_url: "https://www.instagram.com/p/DU_XdM8jZxU/?img_index=8",
      })
    ).toBe("carousel");
  });

  it("classifies IG carousel from media_type Sidecar when child slide URLs are missing", () => {
    expect(
      deriveEvidencePostFormat("instagram_post", {
        media_type: "Sidecar",
        post_url: "https://www.instagram.com/p/DVPOUZJCW1c/",
        caption: "hello",
      })
    ).toBe("carousel");
  });

  it("classifies Reddit without image as text_native", () => {
    expect(deriveEvidencePostFormat("reddit_post", { title: "Hello" })).toBe("text_native");
  });

  it("classifies scraped_page as article_or_page", () => {
    expect(deriveEvidencePostFormat("scraped_page", { url: "https://example.com/a" })).toBe("article_or_page");
  });
});

describe("deriveEvidenceDisplayKind", () => {
  it("maps IG reel payload to instagram_video", () => {
    expect(
      deriveEvidenceDisplayKind("instagram_post", {
        media_type: "Reel",
        post_url: "https://www.instagram.com/reel/AbCdEfGhIjK/",
      })
    ).toBe("instagram_video");
  });

  it("maps IG carousel structural hint to instagram_carousel", () => {
    expect(
      deriveEvidenceDisplayKind("instagram_post", {
        media_type: "Sidecar",
        post_url: "https://www.instagram.com/p/DVPOUZJCW1c/",
      })
    ).toBe("instagram_carousel");
  });

  it("maps IG single image to instagram_post", () => {
    expect(
      deriveEvidenceDisplayKind("instagram_post", {
        display_url: "https://cdn/1.jpg",
      })
    ).toBe("instagram_post");
  });

  it("passes through non-IG kinds unchanged", () => {
    expect(deriveEvidenceDisplayKind("tiktok_video", {})).toBe("tiktok_video");
    expect(deriveEvidenceDisplayKind("reddit_post", { title: "x" })).toBe("reddit_post");
  });
});
