import { describe, expect, it } from "vitest";
import {
  instagramCarouselStructuralHintPresent,
  instagramPostPermalinkFromPayload,
  isCarouselDeepEligible,
  isLikelyStaleInstagramCdnUrl,
  carouselSlideUrlsLookStale,
  maxInstagramCarouselImgIndexFromPayload,
  MIN_CAROUSEL_SLIDES_FOR_DEEP,
  parseCarouselSlideUrls,
} from "./inputs-carousel-evidence-bundle.js";

describe("parseCarouselSlideUrls", () => {
  it("reads carousel_slide_urls (http cells normalize to https)", () => {
    const urls = parseCarouselSlideUrls(
      {
        carousel_slide_urls: ["https://a/1.jpg", "http://x/b.jpg", "https://a/2.jpg"],
      },
      5
    );
    expect(urls).toEqual(["https://a/1.jpg", "https://x/b.jpg", "https://a/2.jpg"]);
  });

  it("splits pipe-delimited URLs in a single carousel_slide_urls string cell", () => {
    const u1 = "https://scontent.cdninstagram.com/v/t51/x1.jpg?_nc_sid=1";
    const u2 = "https://scontent.cdninstagram.com/v/t51/x2.jpg?_nc_sid=2";
    expect(parseCarouselSlideUrls({ carousel_slide_urls: `${u1}|${u2}` }, 6)).toEqual([u1, u2]);
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

  it("reads images[] of scraper objects (display_url per child)", () => {
    const urls = parseCarouselSlideUrls({
      images: [
        { display_url: "https://cdn.example/1.jpg" },
        { display_url: "https://cdn.example/2.jpg" },
      ],
    });
    expect(urls).toEqual(["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"]);
  });

  it("parses JSON string of images array from spreadsheet cells", () => {
    const cell = JSON.stringify([
      { display_url: "https://cdn.example/a.webp" },
      { display_url: "https://cdn.example/b.webp" },
    ]);
    expect(parseCarouselSlideUrls({ images: cell })).toHaveLength(2);
  });

  it("merges top-level display_url and thumbnail_url for two-slide deck", () => {
    const urls = parseCarouselSlideUrls({
      media_type: "Sidecar",
      display_url: "https://cdn.example/cover.jpg",
      thumbnail_url: "https://cdn.example/thumb.jpg",
    });
    expect(urls).toEqual(["https://cdn.example/cover.jpg", "https://cdn.example/thumb.jpg"]);
  });
});

describe("instagramPostPermalinkFromPayload", () => {
  it("reads permalink from link when post_url is absent", () => {
    expect(
      instagramPostPermalinkFromPayload({
        link: "https://www.instagram.com/p/AbCdEfGhIjK/",
      })
    ).toBe("https://www.instagram.com/p/AbCdEfGhIjK/");
  });
});

describe("instagramCarouselStructuralHintPresent", () => {
  it("is true for Graph API media_type Sidecar without img_index", () => {
    expect(
      instagramCarouselStructuralHintPresent({
        media_type: "Sidecar",
        post_url: "https://www.instagram.com/p/DVPOUZJCW1c/",
      })
    ).toBe(true);
  });

  it("is false for plain Image", () => {
    expect(instagramCarouselStructuralHintPresent({ media_type: "Image", post_url: "https://www.instagram.com/p/X/" })).toBe(
      false
    );
  });
});

describe("maxInstagramCarouselImgIndexFromPayload", () => {
  it("reads img_index from post_url", () => {
    expect(
      maxInstagramCarouselImgIndexFromPayload({
        post_url: "https://www.instagram.com/p/DU_XdM8jZxU/?img_index=8",
      })
    ).toBe(8);
  });

  it("returns max across multiple URL fields", () => {
    expect(
      maxInstagramCarouselImgIndexFromPayload({
        url: "https://www.instagram.com/p/AbC/?img_index=2",
        post_url: "https://www.instagram.com/p/DU_XdM8jZxU/?img_index=5",
      })
    ).toBe(5);
  });

  it("returns 0 when no instagram img_index", () => {
    expect(maxInstagramCarouselImgIndexFromPayload({ post_url: "https://example.com/a" })).toBe(0);
  });
});

describe("isCarouselDeepEligible", () => {
  it("requires at least MIN_CAROUSEL_SLIDES_FOR_DEEP HTTPS slides", () => {
    expect(isCarouselDeepEligible({ carousel_slide_urls: ["https://a/1.jpg"] })).toBe(false);
    expect(isCarouselDeepEligible({ carousel_slide_urls: ["https://a/1.jpg", "https://a/2.jpg"] })).toBe(true);
    expect(MIN_CAROUSEL_SLIDES_FOR_DEEP).toBe(2);
  });

  it("is true when cover + thumbnail yield two HTTPS URLs", () => {
    expect(
      isCarouselDeepEligible({
        display_url: "https://a/1.jpg",
        thumbnail_url: "https://a/2.jpg",
      })
    ).toBe(true);
  });

  it("harvests nested Graph edge_sidecar_to_children node display_urls (Instagram CDN hosts)", () => {
    const urls = parseCarouselSlideUrls(
      {
        media_type: "GraphSidecar",
        post_url: "https://www.instagram.com/p/ABC123/",
        graphql: {
          shortcode_media: {
            edge_sidecar_to_children: {
              edges: [
                { node: { display_url: "https://scontent.cdninstagram.com/v/t51.2885-15/a.jpg" } },
                { node: { display_url: "https://scontent.cdninstagram.com/v/t51.2885-15/b.jpg" } },
              ],
            },
          },
        },
      },
      12
    );
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toContain("scontent.cdninstagram.com");
    expect(urls[1]).toContain("scontent.cdninstagram.com");
  });

  it("parses stringified JSON blob with nested sidecar children", () => {
    const blob = JSON.stringify({
      data: {
        xdt_shortcode_media: {
          edge_sidecar_to_children: {
            edges: [
              { node: { display_url: "https://scontent.cdninstagram.com/one.webp" } },
              { node: { display_url: "https://scontent.cdninstagram.com/two.webp" } },
            ],
          },
        },
      },
    });
    const urls = parseCarouselSlideUrls({ media_type: "Sidecar", raw_scrape: blob }, 8);
    expect(urls).toHaveLength(2);
  });
});

describe("isLikelyStaleInstagramCdnUrl", () => {
  it("detects expired oe= hex timestamp on Instagram CDN URLs", () => {
    const expired =
      "https://scontent-lga3-2.cdninstagram.com/v/t51.82787-15/x.jpg?oe=00000001&_nc_sid=10d13b";
    expect(isLikelyStaleInstagramCdnUrl(expired, 1_700_000_000_000)).toBe(true);
    expect(carouselSlideUrlsLookStale([expired], 1_700_000_000_000)).toBe(true);
  });

  it("treats far-future oe= as not stale", () => {
    const fresh =
      "https://scontent-lga3-2.cdninstagram.com/v/t51.82787-15/x.jpg?oe=ffffffff&_nc_sid=10d13b";
    expect(isLikelyStaleInstagramCdnUrl(fresh, 1_700_000_000_000)).toBe(false);
  });
});
