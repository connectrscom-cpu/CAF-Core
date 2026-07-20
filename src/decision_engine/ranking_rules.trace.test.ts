import { describe, expect, it } from "vitest";
import { applyLearningBoosts, applyLearningBoostsWithTrace } from "./ranking_rules.js";
import type { ScoredCandidate } from "./types.js";
import type { LearningRuleRow } from "../repositories/core.js";

function candidate(overrides: Partial<ScoredCandidate> & { candidate_id: string }): ScoredCandidate {
  return {
    flow_type: "FLOW_CAROUSEL",
    pre_gen_score: 0.5,
    score_breakdown: {},
    ...overrides,
  } as ScoredCandidate;
}

function rule(overrides: Partial<LearningRuleRow> & { rule_id: string }): LearningRuleRow {
  return {
    trigger_type: "test",
    scope_flow_type: null,
    scope_platform: null,
    action_type: "SCORE_BOOST",
    action_payload: { boost: 0.1 },
    scope_type: "project",
    rule_family: "ranking",
    ...overrides,
  } as LearningRuleRow;
}

describe("applyLearningBoostsWithTrace", () => {
  it("records which rules matched which candidates with the combined multiplier", () => {
    const { candidates, trace } = applyLearningBoostsWithTrace(
      [candidate({ candidate_id: "c1" }), candidate({ candidate_id: "c2", flow_type: "FLOW_VIDEO" })],
      [rule({ rule_id: "r_boost", scope_flow_type: "FLOW_CAROUSEL" })]
    );
    expect(trace).toHaveLength(1);
    expect(trace[0]).toEqual({ candidate_id: "c1", applied_rule_ids: ["r_boost"], multiplier: 1.1 });
    expect(candidates[0].pre_gen_score).toBeCloseTo(0.55, 4);
    expect(candidates[1].pre_gen_score).toBe(0.5);
  });

  it("accumulates multiple matching rules into one trace entry", () => {
    const { trace } = applyLearningBoostsWithTrace(
      [candidate({ candidate_id: "c1" })],
      [
        rule({ rule_id: "r1", action_payload: { boost: 0.1 } }),
        rule({ rule_id: "r2", action_type: "SCORE_PENALTY", action_payload: { penalty: -0.2 } }),
      ]
    );
    expect(trace).toHaveLength(1);
    expect(trace[0].applied_rule_ids).toEqual(["r1", "r2"]);
    expect(trace[0].multiplier).toBeCloseTo(1.1 * 0.8, 4);
  });

  it("returns empty trace when no ranking rules exist", () => {
    const { trace } = applyLearningBoostsWithTrace(
      [candidate({ candidate_id: "c1" })],
      [rule({ rule_id: "g1", action_type: "GENERATION_GUIDANCE", rule_family: "generation" })]
    );
    expect(trace).toEqual([]);
  });

  it("keeps applyLearningBoosts behavior identical (wrapper)", () => {
    const scored = [candidate({ candidate_id: "c1" })];
    const rules = [rule({ rule_id: "r1" })];
    expect(applyLearningBoosts(scored, rules)).toEqual(
      applyLearningBoostsWithTrace(scored, rules).candidates
    );
  });
});
