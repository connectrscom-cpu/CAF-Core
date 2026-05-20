import { describe, expect, it } from "vitest";
import {
  isPrimaryFormatMatch,
  partitionCandidatesForPlanningPhases,
  flowTypeMatchesRowFormat,
  planningLaneForFlowType,
} from "./format-routing.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, FLOW_TOP_PERFORMER_MIMIC_IMAGE } from "../domain/top-performer-mimic-flow-types.js";
import type { ScoredCandidate } from "./types.js";

function cand(
  partial: Partial<ScoredCandidate> & Pick<ScoredCandidate, "candidate_id" | "flow_type">
): ScoredCandidate {
  return {
    pre_gen_score: 0.8,
    score_breakdown: {},
    confidence_score: 0.8,
    ...partial,
  };
}

describe("format-routing", () => {
  it("treats carousel idea × carousel flow as primary match", () => {
    const c = cand({
      candidate_id: "a_FLOW_CAROUSEL",
      flow_type: "FLOW_CAROUSEL",
      payload: { idea_id: "a", format: "carousel" },
    });
    expect(isPrimaryFormatMatch(c)).toBe(true);
  });

  it("excludes carousel idea × video flow from planning pools", () => {
    const c = cand({
      candidate_id: "a_FLOW_HEYGEN",
      flow_type: "FLOW_HEYGEN_VIDEO",
      payload: { idea_id: "a", format: "carousel" },
    });
    expect(isPrimaryFormatMatch(c)).toBe(false);
    const { primary, fallback } = partitionCandidatesForPlanningPhases([c]);
    expect(primary).toHaveLength(0);
    expect(fallback).toHaveLength(0);
  });

  it("treats video idea × video flow as primary match", () => {
    const c = cand({
      candidate_id: "b_FLOW_HEYGEN",
      flow_type: "FLOW_HEYGEN_VIDEO",
      payload: { idea_id: "b", format: "video" },
    });
    expect(isPrimaryFormatMatch(c)).toBe(true);
  });

  it("partitions primary before fallback lists", () => {
    const sorted = [
      cand({
        candidate_id: "a_FLOW_HEYGEN",
        flow_type: "FLOW_HEYGEN_VIDEO",
        payload: { idea_id: "a", format: "carousel" },
      }),
      cand({
        candidate_id: "a_FLOW_CAROUSEL",
        flow_type: "FLOW_CAROUSEL",
        payload: { idea_id: "a", format: "carousel" },
      }),
    ];
    const { primary, fallback } = partitionCandidatesForPlanningPhases(sorted);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.flow_type).toBe("FLOW_CAROUSEL");
    expect(fallback).toHaveLength(0);
  });

  it("allows mimic image flow on carousel-format planner rows", () => {
    expect(flowTypeMatchesRowFormat(FLOW_TOP_PERFORMER_MIMIC_IMAGE, "carousel")).toBe(true);
    expect(planningLaneForFlowType(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL)).toBe("mimic_carousel");
    expect(planningLaneForFlowType("FLOW_CAROUSEL")).toBe("carousel");
  });
});
