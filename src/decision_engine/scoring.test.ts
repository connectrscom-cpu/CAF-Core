import { describe, expect, it } from "vitest";
import { scoreCandidate } from "./scoring.js";
import type { CandidateInput } from "./types.js";

const weights = { confidence: 0.35, platform_fit: 0.25, novelty: 0.2, past_performance: 0.2 };

describe("scoreCandidate", () => {
  it("combines weights", () => {
    const c: CandidateInput = {
      candidate_id: "x",
      flow_type: "FLOW_CAROUSEL",
      confidence_score: 1,
      platform_fit: 1,
      novelty_score: 1,
      past_performance_similarity: 1,
    };
    const s = scoreCandidate(c, weights);
    expect(s.pre_gen_score).toBe(1);
  });

  it("normalizes percent confidence", () => {
    const c: CandidateInput = {
      candidate_id: "x",
      flow_type: "FLOW_CAROUSEL",
      confidence_score: 80,
    };
    const s = scoreCandidate(c, weights);
    expect(s.pre_gen_score).toBeGreaterThan(0.4);
  });
});
