import { describe, expect, it } from "vitest";
import { pickInspectionMediaPreviewUrl } from "./visual-guidelines-media.js";

describe("pickInspectionMediaPreviewUrl", () => {
  it("prefers signed vision_fetch_url over public_url that may 403", () => {
    const url = pickInspectionMediaPreviewUrl({
      storage_bucket: "assets",
      folder_prefix: "assets/top_performer_inspection/x/",
      storage_folder_label: null,
      skipped_reason: null,
      items: [
        {
          role: "carousel_slide",
          object_path: "assets/top_performer_inspection/x/slide.jpg",
          bucket: "assets",
          public_url: "https://example.test/storage/v1/object/public/assets/x/slide.jpg",
          vision_fetch_url: "https://example.test/storage/v1/object/sign/assets/x/slide.jpg?token=1",
          index: 0,
        },
      ],
    });
    expect(url).toContain("/object/sign/");
  });

  it("prefers carousel_slide over source_video for thumbnail", () => {
    const url = pickInspectionMediaPreviewUrl({
      storage_bucket: "assets",
      folder_prefix: null,
      storage_folder_label: null,
      skipped_reason: null,
      items: [
        {
          role: "source_video",
          object_path: null,
          bucket: null,
          public_url: "https://example.test/video.mp4",
          vision_fetch_url: null,
          index: 0,
        },
        {
          role: "carousel_slide",
          object_path: "a.jpg",
          bucket: "assets",
          public_url: null,
          vision_fetch_url: "https://example.test/slide-signed.jpg",
          index: 0,
        },
      ],
    });
    expect(url).toBe("https://example.test/slide-signed.jpg");
  });
});
