import { describe, expect, it } from "vitest";
import { pickInspectionMediaPreviewUrl, pickRenderableThumb } from "./inspection-media";

describe("pickInspectionMediaPreviewUrl", () => {
  it("prefers signed vision_fetch_url over public_url that may 403", () => {
    const url = pickInspectionMediaPreviewUrl({
      items: [
        {
          role: "carousel_slide",
          public_url: "https://example.test/storage/v1/object/public/assets/x/slide.jpg",
          vision_fetch_url: "https://example.test/storage/v1/object/sign/assets/x/slide.jpg?token=1",
        },
      ],
    });
    expect(url).toContain("/object/sign/");
  });

  it("skips instagram post permalinks even when vision_fetch_url is a permalink", () => {
    const url = pickInspectionMediaPreviewUrl({
      items: [
        {
          role: "carousel_slide",
          vision_fetch_url: "https://www.instagram.com/p/ABC/",
          public_url: "https://storage.example.com/slide_01.jpg",
        },
      ],
    });
    expect(url).toBe("https://storage.example.com/slide_01.jpg");
  });
});

describe("pickRenderableThumb", () => {
  it("scores signed storage above public storage", () => {
    const url = pickRenderableThumb(
      "https://example.test/storage/v1/object/public/assets/x/slide.jpg",
      "https://example.test/storage/v1/object/sign/assets/x/slide.jpg?token=1"
    );
    expect(url).toContain("/object/sign/");
  });
});
