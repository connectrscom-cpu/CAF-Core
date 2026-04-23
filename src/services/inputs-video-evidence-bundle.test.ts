import { describe, expect, it } from "vitest";
import { parseVideoAnalysisFrameUrls, parseVideoAnalysisTranscript } from "./inputs-video-evidence-bundle.js";

describe("parseVideoAnalysisFrameUrls", () => {
  it("reads analysis_frame_urls", () => {
    const urls = parseVideoAnalysisFrameUrls(
      { analysis_frame_urls: ["https://a/x.jpg", "http://insecure/b.jpg", "https://c/y.png"] },
      5
    );
    expect(urls).toEqual(["https://a/x.jpg", "https://c/y.png"]);
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
