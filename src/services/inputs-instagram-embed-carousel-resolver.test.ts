import { describe, expect, it, vi } from "vitest";
import {
  extractInstagramCarouselUrlsFromEmbedHtml,
  extractInstagramPermalinkShortcode,
  fetchInstagramCarouselUrlsFromEmbed,
  fetchInstagramCarouselUrlsFromEmbedDetailed,
  instagramEmbedHtmlDiagnostics,
  isLikelyInstagramEmbedUiAssetUrl,
  scoreInstagramCarouselCdnUrl,
} from "./inputs-instagram-embed-carousel-resolver.js";

describe("extractInstagramPermalinkShortcode", () => {
  it("parses /p/ shortcode", () => {
    expect(extractInstagramPermalinkShortcode("https://www.instagram.com/p/DVPOUZJCW1c/")).toBe("DVPOUZJCW1c");
  });

  it("parses /reel/", () => {
    expect(extractInstagramPermalinkShortcode("https://www.instagram.com/reel/AbCd123_/")).toBe("AbCd123_");
  });
});

describe("extractInstagramCarouselUrlsFromEmbedHtml", () => {
  it("extracts display_url JSON fragments", () => {
    const html = String.raw`{"display_url":"https://scontent.cdninstagram.com/a.jpg","x":1}{"display_url":"https://scontent.cdninstagram.com/b.jpg"}`;
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 6);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toMatch(/^https:\/\/scontent\.cdninstagram\.com\/a\.jpg/);
    expect(urls[1]).toMatch(/^https:\/\/scontent\.cdninstagram\.com\/b\.jpg/);
  });

  it("extracts escaped display_url as in embed markup", () => {
    const html = '\\"display_url\\":\\"https:\\/\\/scontent.cdninstagram.com\\/v\\/t51_x.jpg\\"';
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 4);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/cdninstagram\.com.*\.jpg/);
  });

  it("extracts thumbnail_url JSON fragments", () => {
    const html =
      '{"thumbnail_url":"https://scontent.cdninstagram.com/a.jpg","x":1}{"thumbnail_url":"https://scontent.cdninstagram.com/b.jpg"}';
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 6);
    expect(urls.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts og:image meta tags", () => {
    const html = `<head><meta property="og:image" content="https://scontent.cdninstagram.com/og1.jpg" /></head>`;
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 4);
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain("cdninstagram.com");
  });

  it("prefers JSON display_url over og:image when both exist", () => {
    const html = `<meta property="og:image" content="https://scontent.cdninstagram.com/meta_only.jpg" />
{"display_url":"https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_a.jpg"}
{"display_url":"https://scontent.cdninstagram.com/v/t51/s1080x1080/slide_b.jpg"}`;
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 6);
    expect(urls.length).toBe(2);
    expect(urls.some((u) => u.includes("slide_a"))).toBe(true);
    expect(urls.some((u) => u.includes("slide_b"))).toBe(true);
    expect(urls.some((u) => u.includes("meta_only"))).toBe(false);
  });

  it("strict mode drops tiny s150x150 CDN paths (embed chrome)", () => {
    const html =
      '{"display_url":"https://scontent.cdninstagram.com/v/t51/s150x150/tiny.webp"}' +
      '{"display_url":"https://scontent.cdninstagram.com/v/t51/s1080x1080/real.jpg"}';
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 4, "strict");
    expect(urls).toEqual(["https://scontent.cdninstagram.com/v/t51/s1080x1080/real.jpg"]);
  });

  it("permissive mode keeps small CDN paths when needed for ≥2 slide hints", () => {
    const html =
      '{"display_url":"https://scontent.cdninstagram.com/v/t51/s150x150/tiny.webp"}' +
      '{"display_url":"https://scontent.cdninstagram.com/v/t51/s1080x1080/real.jpg"}';
    const urls = extractInstagramCarouselUrlsFromEmbedHtml(html, 4, "permissive");
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain("s1080x1080");
    expect(urls[1]).toContain("s150x150");
  });
});

describe("isLikelyInstagramEmbedUiAssetUrl", () => {
  it("flags static.cdninstagram and rsrc.php", () => {
    expect(isLikelyInstagramEmbedUiAssetUrl("https://static.cdninstagram.com/rsrc.php/foo.jpg")).toBe(true);
    expect(isLikelyInstagramEmbedUiAssetUrl("https://scontent.cdninstagram.com/v/t51/s1080x1080/ok.jpg")).toBe(false);
  });
});

describe("scoreInstagramCarouselCdnUrl", () => {
  it("ranks larger renditions higher", () => {
    const a = "https://scontent.cdninstagram.com/v/s320x320/a.jpg";
    const b = "https://scontent.cdninstagram.com/v/s1080x1080/b.jpg";
    expect(scoreInstagramCarouselCdnUrl(b)).toBeGreaterThan(scoreInstagramCarouselCdnUrl(a));
  });
});

describe("instagramEmbedHtmlDiagnostics", () => {
  it("flags login wall copy", () => {
    const d = instagramEmbedHtmlDiagnostics("<html>Log in to Instagram</html>");
    expect(d.login_wall_likely).toBe(true);
    expect(d.html_contains_display_url).toBe(false);
  });

  it("detects display_url literal", () => {
    const d = instagramEmbedHtmlDiagnostics('{"display_url":"https://x"}');
    expect(d.html_contains_display_url).toBe(true);
  });
});

describe("fetchInstagramCarouselUrlsFromEmbed", () => {
  it("uses response body text for extraction", async () => {
    const html = '{"display_url":"https://scontent.cdninstagram.com/z.jpg"}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => html,
      })) as unknown as typeof fetch
    );
    const urls = await fetchInstagramCarouselUrlsFromEmbed("https://www.instagram.com/p/ABCde12345/", {
      maxSlides: 4,
      timeoutMs: 5000,
      maxBytes: 100_000,
    });
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain("cdninstagram.com");
    vi.unstubAllGlobals();
  });

  it("fetchInstagramCarouselUrlsFromEmbedDetailed returns diagnostics", async () => {
    const html = '<meta property="og:image" content="https://scontent.cdninstagram.com/z.jpg" />';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => html,
      })) as unknown as typeof fetch
    );
    const o = await fetchInstagramCarouselUrlsFromEmbedDetailed("https://www.instagram.com/p/ABCde12345/", {
      maxSlides: 4,
      timeoutMs: 5000,
      maxBytes: 100_000,
    });
    expect(o.http_ok).toBe(true);
    expect(o.urls.length).toBeGreaterThanOrEqual(1);
    expect(o.html_bytes).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});
