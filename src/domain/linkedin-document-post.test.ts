import { describe, expect, it } from "vitest";
import {
  LINKEDIN_DOCUMENT_POST_V1_KEY,
  buildLinkedInDocumentPostV1FromGenerated,
  pickLinkedInDocumentPostV1,
} from "./linkedin-document-post.js";

describe("linkedin-document-post", () => {
  it("builds v1 from LLM JSON and candidate_data defaults", () => {
    const v1 = buildLinkedInDocumentPostV1FromGenerated(
      {
        post_text: "Hook line\n\nBody with insight.",
        companion_images: [
          { visual_brief: "Minimal desk flat lay", alt_text: "Desk scene" },
          { visual_brief: "Team collaboration", alt_text: "Team" },
        ],
        hashtags: ["leadership", "growth"],
      },
      { linkedin_aspect_ratio: "1:1", linkedin_image_count: 2 }
    );
    expect(v1.aspect_ratio).toBe("1:1");
    expect(v1.image_count).toBe(2);
    expect(v1.companion_images).toHaveLength(2);
    expect(v1.post_text).toContain("Hook line");
    expect(v1.hashtags).toEqual(["leadership", "growth"]);
  });

  it("round-trips via generation_payload reader", () => {
    const payload = {
      [LINKEDIN_DOCUMENT_POST_V1_KEY]: {
        post_text: "Hello LinkedIn",
        aspect_ratio: "4:5",
        image_count: 3,
        companion_images: [
          { index: 1, visual_brief: "A" },
          { index: 2, visual_brief: "B" },
          { index: 3, visual_brief: "C" },
        ],
      },
    };
    const picked = pickLinkedInDocumentPostV1(payload);
    expect(picked?.image_count).toBe(3);
    expect(picked?.aspect_ratio).toBe("4:5");
  });
});
