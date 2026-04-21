import { describe, expect, it } from "vitest";
import { ensureVideoScriptPublicationMetadata } from "./video-script-generator.js";

describe("ensureVideoScriptPublicationMetadata", () => {
  it("fills caption and hashtags when missing", () => {
    const out = ensureVideoScriptPublicationMetadata({
      spoken_script: "First sentence here. Second sentence follows with more detail about the dish.",
      hook: "Stop scrolling — this olive oil trick changes everything.",
    });
    expect(typeof out.caption).toBe("string");
    expect(String(out.caption).length).toBeGreaterThan(10);
    expect(Array.isArray(out.hashtags)).toBe(true);
    expect((out.hashtags as string[]).length).toBeGreaterThanOrEqual(3);
  });

  it("preserves existing caption and hashtags", () => {
    const out = ensureVideoScriptPublicationMetadata({
      spoken_script: "x".repeat(50),
      caption: "Already set caption for the feed.",
      hashtags: ["#one", "#two", "#three"],
    });
    expect(out.caption).toBe("Already set caption for the feed.");
    expect(out.hashtags).toEqual(["#one", "#two", "#three"]);
  });
});
