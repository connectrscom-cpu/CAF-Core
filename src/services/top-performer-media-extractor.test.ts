import { describe, expect, it } from "vitest";
import { summarizeInstagramTopPerformerMediaIngest } from "./top-performer-media-extractor.js";

describe("summarizeInstagramTopPerformerMediaIngest", () => {
  it("only_img_index_hint_no_url when permalink has img_index but no CDN URLs", () => {
    const s = summarizeInstagramTopPerformerMediaIngest({
      post_url: "https://www.instagram.com/p/ABC123/?img_index=3",
      media_type: "Sidecar",
    });
    expect(s.only_img_index_hint_no_url).toBe(true);
    expect(s.no_payload_media_urls).toBe(true);
  });

  it("all_urls_rejected_static_assets when only static bundle URLs are present", () => {
    const s = summarizeInstagramTopPerformerMediaIngest({
      images_json: JSON.stringify(["https://static.cdninstagram.com/rsrc.php/v3/foo.jpg"]),
    });
    expect(s.all_urls_rejected_static_assets).toBe(true);
    expect(s.payload_media_assets_found).toBe(0);
  });
});
