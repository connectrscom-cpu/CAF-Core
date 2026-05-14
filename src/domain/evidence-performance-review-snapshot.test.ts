import { describe, expect, it } from "vitest";
import {
  evidencePerformanceReviewJsonFromRatingRow,
  ratingReviewSnapshotsByRowId,
} from "./evidence-performance-review-snapshot.js";

describe("evidencePerformanceReviewJsonFromRatingRow", () => {
  it("returns null when rating_score missing", () => {
    expect(
      evidencePerformanceReviewJsonFromRatingRow({
        rating_score: null,
        rating_components_json: {},
        rating_rationale: "x",
        rated_at: null,
      })
    ).toBeNull();
  });

  it("builds snapshot when rated", () => {
    const j = evidencePerformanceReviewJsonFromRatingRow({
      rating_score: "0.82",
      rating_components_json: { engagement_potential: 0.9 },
      rating_rationale: "Strong hook",
      rated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(j).toMatchObject({
      version: 1,
      rating_score: 0.82,
      rating_components_json: { engagement_potential: 0.9 },
      rating_rationale: "Strong hook",
      source: "inputs_evidence_row",
    });
  });
});

describe("ratingReviewSnapshotsByRowId", () => {
  it("maps row ids", () => {
    const m = ratingReviewSnapshotsByRowId([
      {
        id: "10",
        rating_score: "0.5",
        rating_components_json: {},
        rating_rationale: null,
        rated_at: null,
      },
      {
        id: "11",
        rating_score: null,
        rating_components_json: null,
        rating_rationale: null,
        rated_at: null,
      },
    ]);
    expect(m.get("10")?.rating_score).toBe(0.5);
    expect(m.get("11")).toBeNull();
  });
});
