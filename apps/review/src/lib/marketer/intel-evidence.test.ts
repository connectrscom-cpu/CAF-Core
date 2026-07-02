import { describe, expect, it } from "vitest";
import { resolveCompetitorThumbnail, resolveThumbnailUrl } from "./intel-evidence";
import type { IntelEvidencePost } from "./types";

describe("resolveThumbnailUrl", () => {
  it("prefers signed vision URL over public storage", () => {
    const url = resolveThumbnailUrl(
      {
        insights_id: "ins_1",
        stored_inspection_media_json: {
          items: [
            {
              role: "carousel_slide",
              public_url: "https://example.test/storage/v1/object/public/assets/x/slide.jpg",
              vision_fetch_url: "https://example.test/storage/v1/object/sign/assets/x/slide.jpg?token=1",
            },
          ],
        },
      },
      null
    );
    expect(url).toContain("/object/sign/");
  });
});

describe("resolveCompetitorThumbnail", () => {
  const posts: IntelEvidencePost[] = [
    {
      insightsId: "ins_a",
      title: "Moonomens hook",
      hookText: null,
      platform: "Instagram",
      format: "Carousel",
      postUrl: "https://www.instagram.com/p/DZDF__SjV0i/",
      thumbnailUrl: "https://example.test/storage/v1/object/sign/moon.jpg?token=1",
      customLabel1: null,
      customLabel2: null,
      customLabel3: null,
      primaryEmotion: null,
      hookType: null,
      hashtags: null,
    },
    {
      insightsId: "ins_b",
      title: "Other",
      hookText: null,
      platform: "Instagram",
      format: "Carousel",
      postUrl: "https://www.instagram.com/p/OTHER/",
      thumbnailUrl: "https://example.test/storage/v1/object/public/other.jpg",
      customLabel1: null,
      customLabel2: null,
      customLabel3: null,
      primaryEmotion: null,
      hookType: null,
      hashtags: null,
    },
  ];

  it("matches the standout example post URL", () => {
    const thumb = resolveCompetitorThumbnail(
      {
        handle: "@moonomens",
        platform: "Instagram",
        examplePostUrl: "https://www.instagram.com/p/DZDF__SjV0i/",
      },
      posts
    );
    expect(thumb).toContain("moon.jpg");
  });
});
