import { describe, expect, it } from "vitest";
import { visionUrlsFromStoredInspectionMedia } from "./inputs-carousel-document-ai-ocr.js";

describe("inputs-carousel-document-ai-ocr", () => {
  it("extracts vision_fetch_url from stored inspection items in order", () => {
    const urls = visionUrlsFromStoredInspectionMedia({
      tier: "top_performer_carousel",
      items: [
        { index: 1, vision_fetch_url: "https://x/s1.jpg" },
        { index: 2, public_url: "https://x/s2.jpg" },
        { index: 3, error: "fail" },
      ],
    });
    expect(urls).toEqual(["https://x/s1.jpg", "https://x/s2.jpg"]);
  });

  it("returns empty when inspection media missing", () => {
    expect(visionUrlsFromStoredInspectionMedia(null)).toEqual([]);
    expect(visionUrlsFromStoredInspectionMedia({ items: [] })).toEqual([]);
  });
});
