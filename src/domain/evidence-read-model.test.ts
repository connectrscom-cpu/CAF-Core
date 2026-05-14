import { describe, expect, it } from "vitest";
import {
  buildEvidenceReadModelItem,
  evidenceKindFromPlatformQuery,
  extractEngagementMetrics,
  platformSlugFromEvidenceKind,
} from "./evidence-read-model.js";

describe("evidence-read-model", () => {
  it("maps platform slug from evidence_kind", () => {
    expect(platformSlugFromEvidenceKind("instagram_post")).toBe("instagram");
    expect(platformSlugFromEvidenceKind("reddit_post")).toBe("reddit");
  });

  it("resolves platform query to evidence_kind", () => {
    expect(evidenceKindFromPlatformQuery("instagram")).toBe("instagram_post");
    expect(evidenceKindFromPlatformQuery("TT")).toBe("tiktok_video");
    expect(evidenceKindFromPlatformQuery(undefined)).toBe(null);
  });

  it("extracts Instagram engagement metrics", () => {
    const m = extractEngagementMetrics("instagram_post", {
      likesCount: 12,
      commentsCount: 3,
      sharesCount: 1,
    });
    expect(m.likes).toBe(12);
    expect(m.comments).toBe(3);
    expect(m.shares).toBe(1);
  });

  it("builds read model item with hook from caption", () => {
    const item = buildEvidenceReadModelItem({
      project_slug: "sns",
      inputs_import_id: "imp-1",
      signal_pack_id: null,
      run_id: null,
      id: "99",
      evidence_kind: "instagram_post",
      payload_json: {
        post_url: "https://instagram.com/p/abc",
        caption: "First line hook\n\nRest of caption",
        hashtags: "#a #b",
        likesCount: 5,
      },
      created_at: "2026-01-01T00:00:00Z",
      rating_score: "0.42",
      thumbnail_url: "https://cdn.example/thumb.jpg",
      media_urls: [],
    });
    expect(item.source_url).toContain("instagram.com");
    expect(item.hook).toBe("First line hook");
    expect(item.hashtags).toEqual(["a", "b"]);
    expect(item.rating_score).toBeCloseTo(0.42);
    expect(item.thumbnail_url).toBe("https://cdn.example/thumb.jpg");
  });
});
