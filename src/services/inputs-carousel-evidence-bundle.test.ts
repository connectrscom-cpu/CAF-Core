import { describe, expect, it } from "vitest";
import {
  isCarouselDeepEligible,
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";

describe("parseCarouselSlideUrls", () => {
  it("reads carousel_slide_urls", () => {
    const urls = parseCarouselSlideUrls(
      {
        carousel_slide_urls: ["https://a/1.jpg", "http://x/b.jpg", "https://a/2.jpg"],
      },
      5
    );
    expect(urls).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });

  it("falls back to sidecar_image_urls", () => {
    expect(
      parseCarouselSlideUrls({
        sidecar_image_urls: ["https://s/1.png", "https://s/2.png"],
      })
    ).toHaveLength(2);
  });

  it("respects maxSlides", () => {
    const urls = parseCarouselSlideUrls(
      { carousel_slide_urls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"] },
      2
    );
    expect(urls).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });
});

describe("isCarouselDeepEligible", () => {
  it("requires at least MIN_CAROUSEL_SLIDES_FOR_DEEP HTTPS slides", () => {
    expect(isCarouselDeepEligible({ carousel_slide_urls: ["https://a/1.jpg"] })).toBe(false);
    expect(isCarouselDeepEligible({ carousel_slide_urls: ["https://a/1.jpg", "https://a/2.jpg"] })).toBe(true);
    expect(MIN_CAROUSEL_SLIDES_FOR_DEEP).toBe(2);
  });
});
