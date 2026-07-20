import { describe, expect, it } from "vitest";
import {
  currentRuleMultiplier,
  multiplierFromApprovalDelta,
  suggestRuleLifecycle,
  type RuleForLifecycle,
} from "./learning-rule-lifecycle.js";
import type { RuleEffectiveness } from "./learning-rule-effectiveness.js";

function eff(overrides: Partial<RuleEffectiveness> & { rule_id: string }): RuleEffectiveness {
  return {
    attributed_tasks: 10,
    decided_tasks: 10,
    approved: 5,
    needs_edit: 3,
    rejected: 2,
    approval_rate: 0.5,
    approval_delta_vs_baseline: 0,
    published: 0,
    metrics_present: 0,
    analyzed: 0,
    avg_engagement_rate: null,
    engagement_delta_vs_baseline: null,
    sample_sufficient: true,
    sample_task_ids: [],
    phases: ["generation"],
    holdout: null,
    ...overrides,
  };
}

function rule(
  overrides: Partial<RuleForLifecycle> & { effectiveness: RuleEffectiveness }
): RuleForLifecycle {
  return {
    action_type: "GENERATION_GUIDANCE",
    status: "active",
    action_payload: null,
    ...overrides,
  };
}

describe("currentRuleMultiplier", () => {
  it("returns null for non-ranking actions", () => {
    expect(currentRuleMultiplier("GENERATION_GUIDANCE", {})).toBeNull();
    expect(currentRuleMultiplier(null, {})).toBeNull();
  });

  it("mirrors the decision engine defaults", () => {
    expect(currentRuleMultiplier("BOOST_RANK", {})).toBe(1.05);
    expect(currentRuleMultiplier("BOOST_RANK", { multiplier: 1.2 })).toBe(1.2);
    expect(currentRuleMultiplier("SCORE_BOOST", { boost: 0.1 })).toBeCloseTo(1.1, 8);
    expect(currentRuleMultiplier("SCORE_PENALTY", {})).toBeCloseTo(0.9, 8);
    expect(currentRuleMultiplier("SCORE_PENALTY", { penalty: -0.3 })).toBeCloseTo(0.7, 8);
  });
});

describe("multiplierFromApprovalDelta", () => {
  it("maps delta to a clamped multiplier", () => {
    expect(multiplierFromApprovalDelta(0.1)).toBe(1.1);
    expect(multiplierFromApprovalDelta(-0.15)).toBe(0.85);
    expect(multiplierFromApprovalDelta(0.9)).toBe(1.3);
    expect(multiplierFromApprovalDelta(-0.9)).toBe(0.7);
  });
});

describe("suggestRuleLifecycle", () => {
  it("suggests retiring active rules that hurt approvals", () => {
    const [s] = suggestRuleLifecycle([
      rule({ effectiveness: eff({ rule_id: "bad", approval_delta_vs_baseline: -0.2 }) }),
    ]);
    expect(s.suggestion).toBe("retire");
    expect(s.evidence).toBe("baseline");
  });

  it("prefers holdout evidence over baseline when control is decided", () => {
    const [s] = suggestRuleLifecycle([
      rule({
        effectiveness: eff({
          rule_id: "r1",
          approval_delta_vs_baseline: 0.2,
          holdout: {
            control_tasks: 5,
            control_decided: 5,
            control_approved: 4,
            control_approval_rate: 0.8,
            approval_delta_vs_control: -0.3,
            control_avg_engagement_rate: null,
            engagement_delta_vs_control: null,
          },
        }),
      }),
    ]);
    expect(s.evidence).toBe("holdout");
    expect(s.suggestion).toBe("retire");
  });

  it("suggests renewing rules with a positive delta", () => {
    const [s] = suggestRuleLifecycle([
      rule({ effectiveness: eff({ rule_id: "good", approval_delta_vs_baseline: 0.08 }) }),
    ]);
    expect(s.suggestion).toBe("renew");
  });

  it("suggests weight adjustment for ranking rules whose lift disagrees with config", () => {
    const [s] = suggestRuleLifecycle([
      rule({
        action_type: "BOOST_RANK",
        action_payload: { multiplier: 1.02 },
        effectiveness: eff({ rule_id: "boost", approval_delta_vs_baseline: 0.15 }),
      }),
    ]);
    expect(s.suggestion).toBe("adjust_weight");
    expect(s.current_multiplier).toBe(1.02);
    expect(s.suggested_multiplier).toBe(1.15);
  });

  it("flags active rules with no attribution as dead rules", () => {
    const [s] = suggestRuleLifecycle([
      rule({ effectiveness: eff({ rule_id: "dead", attributed_tasks: 0, decided_tasks: 0 }) }),
    ]);
    expect(s.suggestion).toBe("dead_rule");
  });

  it("reports needs_more_data for active rules below the sample threshold", () => {
    const [s] = suggestRuleLifecycle([
      rule({
        effectiveness: eff({
          rule_id: "young",
          attributed_tasks: 2,
          decided_tasks: 2,
          sample_sufficient: false,
        }),
      }),
    ]);
    expect(s.suggestion).toBe("needs_more_data");
  });

  it("skips insufficient-data entries for non-active rules", () => {
    const out = suggestRuleLifecycle([
      rule({
        status: "pending",
        effectiveness: eff({
          rule_id: "pending",
          attributed_tasks: 1,
          decided_tasks: 1,
          sample_sufficient: false,
        }),
      }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("orders retire suggestions before renew and needs_more_data", () => {
    const out = suggestRuleLifecycle([
      rule({ effectiveness: eff({ rule_id: "good", approval_delta_vs_baseline: 0.1 }) }),
      rule({ effectiveness: eff({ rule_id: "bad", approval_delta_vs_baseline: -0.3 }) }),
      rule({
        effectiveness: eff({
          rule_id: "young",
          attributed_tasks: 1,
          decided_tasks: 1,
          sample_sufficient: false,
        }),
      }),
    ]);
    expect(out.map((s) => s.suggestion)).toEqual(["retire", "renew", "needs_more_data"]);
  });
});
