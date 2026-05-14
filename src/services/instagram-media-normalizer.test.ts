import { describe, expect, it } from "vitest";
import {
  enrichInstagramApifyPayloadInPlace,
  extractOrderedInstagramCarouselImageUrls,
  finalizeInstagramEvidenceMediaUrl,
  isRejectedInstagramMediaUrl,
  normalizeInstagramEvidenceMedia,
} from "./instagram-media-normalizer.js";
import { parseCarouselSlideUrls } from "./inputs-carousel-evidence-bundle.js";

const IG1 = "https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_01.jpg";
const IG2 = "https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_02.jpg";
const IG3 = "https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_03.jpg";
const IG4 = "https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_04.jpg";
const IG5 = "https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_05.jpg";
const VID1 = "https://scontent.cdninstagram.com/v/t50/video/clip_01.mp4";

describe("normalizeInstagramEvidenceMedia", () => {
  it("Apify single image: displayUrl → one cover_image asset", () => {
    const n = normalizeInstagramEvidenceMedia({ displayUrl: IG1 });
    expect(n.media_assets).toHaveLength(1);
    expect(n.media_assets[0].asset_role).toBe("cover_image");
    expect(n.media_assets[0].source_field).toBe("displayUrl");
    expect(n.media_assets[0].source_url).toContain("slide_01");
  });

  it("Apify carousel: childPosts displayUrl → N carousel_slide with ordered slide_index", () => {
    const childPosts = [
      { displayUrl: IG1 },
      { displayUrl: IG2 },
      { displayUrl: IG3 },
      { displayUrl: IG4 },
      { displayUrl: IG5 },
    ];
    const n = normalizeInstagramEvidenceMedia({ childPosts });
    expect(n.media_assets).toHaveLength(5);
    expect(n.diagnostics.carousel_slide_count).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(n.media_assets[i].asset_role).toBe("carousel_slide");
      expect(n.media_assets[i].slide_index).toBe(i + 1);
    }
  });

  it("Apify carousel: images[] only (no childPosts) → ordered carousel_slide assets", () => {
    const n = normalizeInstagramEvidenceMedia({
      images: [IG1, IG2, IG3],
    });
    expect(n.media_assets).toHaveLength(3);
    expect(n.media_assets.every((a) => a.asset_role === "carousel_slide")).toBe(true);
    expect(n.media_assets.map((a) => a.slide_index)).toEqual([1, 2, 3]);
  });

  it("dedupes across displayUrl, images, mediaUrls preserving first hit", () => {
    const n = normalizeInstagramEvidenceMedia({
      images: [IG1, IG2],
      displayUrl: IG1,
      media_urls: [IG2, IG3],
    });
    const urls = n.media_assets.map((a) => a.source_url);
    expect(urls).toEqual([expect.stringContaining("slide_01"), expect.stringContaining("slide_02"), expect.stringContaining("slide_03")]);
    expect(new Set(urls).size).toBe(3);
  });

  it("classifies mixed image / video childPosts", () => {
    const n = normalizeInstagramEvidenceMedia({
      childPosts: [{ displayUrl: IG1 }, { videoUrl: VID1 }],
    });
    expect(n.media_assets).toHaveLength(2);
    expect(n.media_assets[0].media_type).not.toBe("video");
    expect(n.media_assets[1].media_type).toBe("video");
    expect(n.media_assets[1].asset_role).toBe("video");
  });

  it("partial list: invalid URL rejected, valid slides kept", () => {
    const n = normalizeInstagramEvidenceMedia({
      childPosts: [{ displayUrl: "https://example.com/not-ig.jpg" }, { displayUrl: IG2 }],
    });
    expect(n.media_assets).toHaveLength(1);
    expect(n.media_assets[0].source_url).toContain("slide_02");
    expect(n.diagnostics.rejected.length).toBeGreaterThan(0);
  });
});

describe("extractOrderedInstagramCarouselImageUrls + parseCarouselSlideUrls", () => {
  it("prepends ingest-normalized Apify carousel_slide_urls_json before legacy keys", () => {
    const cell = JSON.stringify([IG1, IG2]);
    const urls = parseCarouselSlideUrls({
      carousel_slide_urls_json: cell,
      carousel_slide_urls: ["https://a/legacy.jpg"],
    });
    expect(urls[0]).toContain("slide_01");
    expect(urls[1]).toContain("slide_02");
    expect(urls).toContain("https://a/legacy.jpg");
  });

  it("extractOrdered respects maxSlides", () => {
    const n = extractOrderedInstagramCarouselImageUrls(
      { images: [IG1, IG2, IG3, IG4, IG5] },
      2
    );
    expect(n).toHaveLength(2);
  });
});

describe("enrichInstagramApifyPayloadInPlace", () => {
  it("parses *_json strings into canonical arrays", () => {
    const p: Record<string, unknown> = {
      carousel_slide_urls_json: JSON.stringify([IG1, IG2]),
      child_posts_json: JSON.stringify([{ display_url: IG3 }]),
    };
    enrichInstagramApifyPayloadInPlace(p);
    expect(Array.isArray(p.carousel_slide_urls)).toBe(true);
    expect(Array.isArray(p.childPosts)).toBe(true);
  });
});

describe("isRejectedInstagramMediaUrl / finalizeInstagramEvidenceMediaUrl", () => {
  it("rejects static.cdninstagram and permalinks", () => {
    expect(isRejectedInstagramMediaUrl("https://static.cdninstagram.com/x.jpg").ok).toBe(false);
    expect(isRejectedInstagramMediaUrl("https://www.instagram.com/p/AbC/").ok).toBe(false);
  });

  it("accepts scontent image URLs", () => {
    expect(finalizeInstagramEvidenceMediaUrl(IG1)).toBeTruthy();
  });
});
