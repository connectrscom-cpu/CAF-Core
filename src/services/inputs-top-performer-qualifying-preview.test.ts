import { describe, expect, it } from "vitest";
import {
  capAndSortQualifierPreview,
  excerptForTopPerformerPreview,
  postUrlForTopPerformerPreview,
  type TopPerformerMediaQualifierPreviewRow,
} from "./inputs-top-performer-qualifying-preview.js";

describe("capAndSortQualifierPreview", () => {
  it("sorts by pre_llm_score desc and caps length", () => {
    const rows: TopPerformerMediaQualifierPreviewRow[] = Array.from({ length: 5 }, (_, i) => ({
      row_id: `r${i}`,
      evidence_kind: "instagram_post",
      pre_llm_score: i * 0.1,
      media_count: 2,
      caption_excerpt: "",
      post_url: null,
      already_has_tier_insight: false,
    }));
    const capped = capAndSortQualifierPreview(rows);
    expect(capped[0].pre_llm_score).toBeCloseTo(0.4);
    expect(capped[capped.length - 1].pre_llm_score).toBeCloseTo(0);
  });
});

describe("excerptForTopPerformerPreview", () => {
  it("uses caption when present", () => {
    expect(excerptForTopPerformerPreview({ caption: "Hello world" }, 100)).toBe("Hello world");
  });

  it("truncates long caption", () => {
    const long = "a".repeat(200);
    const out = excerptForTopPerformerPreview({ caption: long }, 20);
    expect(out.length).toBeLessThanOrEqual(22);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("postUrlForTopPerformerPreview", () => {
  it("reads Instagram permalink fields", () => {
    expect(
      postUrlForTopPerformerPreview("instagram_post", {
        link: "https://www.instagram.com/p/AbCdEfGhIjK/",
      })
    ).toContain("instagram.com/p/");
  });
});
