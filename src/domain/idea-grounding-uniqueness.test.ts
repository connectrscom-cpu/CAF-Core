import { describe, expect, it } from "vitest";
import { assertGroundingInsightIdsUniqueAcrossIdeas } from "./idea-grounding-uniqueness.js";
import type { SignalPackIdeaV2 } from "./signal-pack-ideas-v2.js";

const base = (id: string, grounding: string[]): SignalPackIdeaV2 =>
  ({
    id,
    title: "t",
    three_liner: "a".repeat(20),
    thesis: "b".repeat(20),
    who_for: "c",
    format: "carousel",
    platform: "Instagram",
    why_now: "d".repeat(20),
    key_points: ["a", "b", "c"],
    novelty_angle: "e".repeat(20),
    cta: "f",
    grounding_insight_ids: grounding,
    expected_outcome: "g",
    risk_flags: [],
    status: "proposed",
  }) as SignalPackIdeaV2;

describe("assertGroundingInsightIdsUniqueAcrossIdeas", () => {
  it("allows disjoint grounding sets", () => {
    expect(() =>
      assertGroundingInsightIdsUniqueAcrossIdeas([
        base("1", ["ins_a", "ci_1"]),
        base("2", ["ins_b"]),
      ])
    ).not.toThrow();
  });

  it("rejects duplicate grounding ids across ideas", () => {
    expect(() =>
      assertGroundingInsightIdsUniqueAcrossIdeas([
        base("1", ["ins_x"]),
        base("2", ["ins_x"]),
      ])
    ).toThrow(/ins_x/);
  });
});
