import { describe, expect, it } from "vitest";
import {
  isPrimaryFormatMatch,
  partitionCandidatesForPlanningPhases,
  flowTypeMatchesRowFormat,
  ideaKeyPrimaryPass,
  planningLaneForFlowType,
} from "./format-routing.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, FLOW_TOP_PERFORMER_MIMIC_IMAGE, FLOW_VISUAL_FIRST_CAROUSEL, FLOW_WHY_MIMIC_CAROUSEL } from "../domain/top-performer-mimic-flow-types.js";
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

  it("does not route carousel-format ideas to mimic image flow", () => {
    expect(flowTypeMatchesRowFormat(FLOW_TOP_PERFORMER_MIMIC_IMAGE, "carousel")).toBe(false);
    expect(planningLaneForFlowType(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL)).toBe("mimic_carousel");
    expect(planningLaneForFlowType(FLOW_VISUAL_FIRST_CAROUSEL)).toBe("visual_first_carousel");
    expect(planningLaneForFlowType(FLOW_WHY_MIMIC_CAROUSEL)).toBe("why_mimic_carousel");
    expect(planningLaneForFlowType("FLOW_CAROUSEL")).toBe("carousel");
  });

  it("routes post-format ideas to mimic image flow", () => {
    expect(flowTypeMatchesRowFormat(FLOW_TOP_PERFORMER_MIMIC_IMAGE, "post")).toBe(true);
    const c = cand({
      candidate_id: "a_FLOW_TOP_PERFORMER_MIMIC_IMAGE",
      flow_type: FLOW_TOP_PERFORMER_MIMIC_IMAGE,
      payload: { idea_id: "a", format: "post" },
    });
    expect(isPrimaryFormatMatch(c)).toBe(true);
  });

  it("dedupes mimic carousel planning by source evidence row, not idea id", () => {
    const a = cand({
      candidate_id: "idea_a_FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      flow_type: FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
      payload: { idea_id: "idea_a", format: "carousel", source_evidence_row_id: "25112" },
    });
    const b = cand({
      candidate_id: "idea_b_FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      flow_type: FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
      payload: { idea_id: "idea_b", format: "carousel", source_evidence_row_id: "25112" },
    });
    expect(ideaKeyPrimaryPass(a)).toBe(ideaKeyPrimaryPass(b));
    expect(ideaKeyPrimaryPass(a)).toContain("mimic_evidence_row:25112");
  });
});
