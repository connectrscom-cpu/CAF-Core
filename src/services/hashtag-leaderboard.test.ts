import { describe, expect, it } from "vitest";
import { computeHashtagLeaderboardFromEvidenceRows } from "./hashtag-leaderboard.js";

describe("computeHashtagLeaderboardForEvidenceImport", () => {
  it("extracts hashtags and orders by weight then count", async () => {
    const leaderboard = computeHashtagLeaderboardFromEvidenceRows(
      [
        {
          id: "1",
          sheet_name: "s",
          row_index: 1,
          evidence_kind: "instagram_post",
          dedupe_key: null,
          payload_json: { caption: "Hello #AI #Cafe", hashtags: "#AI, #Food" },
          rating_score: "0.9",
          rating_components_json: null,
          rating_rationale: null,
          rated_at: null,
        },
        {
          id: "2",
          sheet_name: "s",
          row_index: 2,
          evidence_kind: "instagram_post",
          dedupe_key: null,
          payload_json: { caption: "More #ai stuff", hashtags: "#cafe" },
          rating_score: "0.2",
          rating_components_json: null,
          rating_rationale: null,
          rated_at: null,
        },
      ] as any,
      { limit: 10 }
    );
    const tags = leaderboard.map((x) => x.hashtag);
    expect(tags[0]).toBe("#ai");
    expect(tags).toContain("#cafe");
    expect(tags).toContain("#food");
  });
});

