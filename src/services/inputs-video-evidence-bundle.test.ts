import { describe, expect, it } from "vitest";
import { parseVideoAnalysisFrameUrls, parseVideoAnalysisTranscript, parseVideoSourceUrlForArchive } from "./inputs-video-evidence-bundle.js";

describe("parseVideoAnalysisFrameUrls", () => {
  it("reads analysis_frame_urls (http cells normalize to https)", () => {
    const urls = parseVideoAnalysisFrameUrls(
      { analysis_frame_urls: ["https://a/x.jpg", "http://insecure/b.jpg", "https://c/y.png"] },
      5
    );
    expect(urls).toEqual(["https://a/x.jpg", "https://insecure/b.jpg", "https://c/y.png"]);
  });

  it("falls back to thumbnail_url when frame arrays are empty", () => {
    expect(
      parseVideoAnalysisFrameUrls(
        { thumbnail_url: "http://cdn.example/poster.jpg", analysis_frame_urls: [] },
        4
      )
    ).toEqual(["https://cdn.example/poster.jpg"]);
  });

  it("parses JSON string array", () => {
    const urls = parseVideoAnalysisFrameUrls(
      { frame_urls: '["https://x.com/1.jpg","https://x.com/2.jpg"]' },
      3
    );
    expect(urls).toEqual(["https://x.com/1.jpg", "https://x.com/2.jpg"]);
  });

  it("respects maxFrames", () => {
    const urls = parseVideoAnalysisFrameUrls(
      { analysis_frame_urls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"] },
      2
    );
    expect(urls).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });

  it("does not use carousel_slide_urls (carousel tier owns that field)", () => {
    expect(
      parseVideoAnalysisFrameUrls({
        carousel_slide_urls: ["https://c/1.jpg", "https://c/2.jpg"],
        analysis_frame_urls: [],
      })
    ).toEqual([]);
  });

  it("reads frame_urls as array of objects with url", () => {
    expect(
      parseVideoAnalysisFrameUrls(
        {
          frame_urls: [{ url: "https://a/1.jpg" }, { display_url: "https://a/2.png" }],
        },
        4
      )
    ).toEqual(["https://a/1.jpg", "https://a/2.png"]);
  });

  it("uses lenient CDN single-cell display_url when strict regex misses", () => {
    const ig =
      "https://scontent.cdninstagram.com/v/t51.2885-15/1234567890_9876543210_n?_nc_ht=scontent.cdninstagram.com";
    expect(parseVideoAnalysisFrameUrls({ display_url: ig }, 3)).toEqual([ig]);
  });
});

describe("parseVideoAnalysisTranscript", () => {
  it("prefers transcript", () => {
    expect(parseVideoAnalysisTranscript({ transcript: "hello", caption: "no" })).toBe("hello");
  });

  it("truncates long text", () => {
    const t = "x".repeat(9000);
    const out = parseVideoAnalysisTranscript({ transcript: t }, 100);
    expect(out.length).toBe(101);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseVideoSourceUrlForArchive", () => {
  it("prefers source_video_url over video_url", () => {
    expect(
      parseVideoSourceUrlForArchive({
        video_url: "https://cdn.example/a.mp4",
        source_video_url: "https://cdn.example/b.mp4",
      })
    ).toBe("https://cdn.example/b.mp4");
  });

  it("returns video_url when alone", () => {
    expect(parseVideoSourceUrlForArchive({ video_url: "https://x/v.mp4" })).toBe("https://x/v.mp4");
  });

  it("uses media_url only when path has a video extension", () => {
    expect(parseVideoSourceUrlForArchive({ media_url: "https://x/post/123" })).toBeNull();
    expect(parseVideoSourceUrlForArchive({ media_url: "https://x/clips/tiktok.mp4?token=1" })).toBe(
      "https://x/clips/tiktok.mp4?token=1"
    );
  });

  it("normalizes http to https", () => {
    expect(parseVideoSourceUrlForArchive({ download_url: "http://cdn.example/file.mov" })).toBe(
      "https://cdn.example/file.mov"
    );
  });

  it("reads videoUrl and video_urls_json after Apify enrich", () => {
    expect(
      parseVideoSourceUrlForArchive({
        video_urls_json: '["https://cdn.example/apify-reel.mp4"]',
      })
    ).toBe("https://cdn.example/apify-reel.mp4");
  });
});
