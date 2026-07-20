import { describe, expect, it } from "vitest";
import {
  aggregateRuleEffectiveness,
  type AttributionOutcomeRow,
  type EffectivenessBaseline,
} from "./learning-rule-effectiveness.js";

const baseline: EffectivenessBaseline = {
  decided_tasks: 100,
  approved_tasks: 50,
  approval_rate: 0.5,
  avg_engagement_rate: 0.02,
};

function row(overrides: Partial<AttributionOutcomeRow> & { task_id: string }): AttributionOutcomeRow {
  return {
    applied_rule_ids: [],
    decision: null,
    tracking_status: null,
    engagement_rate: null,
    ...overrides,
  };
}

describe("aggregateRuleEffectiveness", () => {
  it("computes per-rule approval rate and delta vs baseline", () => {
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t2", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t3", applied_rule_ids: ["r1"], decision: "REJECTED" }),
      row({ task_id: "t4", applied_rule_ids: ["r1"], decision: "NEEDS_EDIT" }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, baseline, { min_decided: 3 });
    expect(r1.rule_id).toBe("r1");
    expect(r1.attributed_tasks).toBe(4);
    expect(r1.decided_tasks).toBe(4);
    expect(r1.approved).toBe(2);
    expect(r1.needs_edit).toBe(1);
    expect(r1.rejected).toBe(1);
    expect(r1.approval_rate).toBe(0.5);
    expect(r1.approval_delta_vs_baseline).toBe(0);
    expect(r1.sample_sufficient).toBe(true);
  });

  it("dedupes tasks per rule across rework regenerations", () => {
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, baseline);
    expect(r1.attributed_tasks).toBe(1);
    expect(r1.approved).toBe(1);
  });

  it("attributes a task to every rule that touched it", () => {
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["r1", "r2"], decision: "APPROVED" }),
      row({ task_id: "t2", applied_rule_ids: ["r2"], decision: "REJECTED" }),
    ];
    const result = aggregateRuleEffectiveness(rows, baseline);
    const r1 = result.find((r) => r.rule_id === "r1");
    const r2 = result.find((r) => r.rule_id === "r2");
    expect(r1?.attributed_tasks).toBe(1);
    expect(r1?.approved).toBe(1);
    expect(r2?.attributed_tasks).toBe(2);
    expect(r2?.approved).toBe(1);
    expect(r2?.rejected).toBe(1);
  });

  it("counts outcome tracking statuses and averages engagement", () => {
    const rows = [
      row({
        task_id: "t1",
        applied_rule_ids: ["r1"],
        decision: "APPROVED",
        tracking_status: "published",
        engagement_rate: 0.03,
      }),
      row({
        task_id: "t2",
        applied_rule_ids: ["r1"],
        decision: "APPROVED",
        tracking_status: "analyzed",
        engagement_rate: "0.05",
      }),
      row({
        task_id: "t3",
        applied_rule_ids: ["r1"],
        decision: "APPROVED",
        tracking_status: "metrics_present",
      }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, baseline);
    expect(r1.published).toBe(1);
    expect(r1.metrics_present).toBe(1);
    expect(r1.analyzed).toBe(1);
    expect(r1.avg_engagement_rate).toBeCloseTo(0.04, 8);
    expect(r1.engagement_delta_vs_baseline).toBeCloseTo(0.02, 8);
  });

  it("returns null rates and no delta when nothing was decided", () => {
    const rows = [row({ task_id: "t1", applied_rule_ids: ["r1"] })];
    const [r1] = aggregateRuleEffectiveness(rows, baseline);
    expect(r1.decided_tasks).toBe(0);
    expect(r1.approval_rate).toBeNull();
    expect(r1.approval_delta_vs_baseline).toBeNull();
    expect(r1.sample_sufficient).toBe(false);
  });

  it("handles null baseline rates without producing deltas", () => {
    const emptyBaseline: EffectivenessBaseline = {
      decided_tasks: 0,
      approved_tasks: 0,
      approval_rate: null,
      avg_engagement_rate: null,
    };
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED", engagement_rate: 0.1 }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, emptyBaseline);
    expect(r1.approval_rate).toBe(1);
    expect(r1.approval_delta_vs_baseline).toBeNull();
    expect(r1.engagement_delta_vs_baseline).toBeNull();
  });

  it("marks small samples as insufficient", () => {
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t2", applied_rule_ids: ["r1"], decision: "APPROVED" }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, baseline, { min_decided: 5 });
    expect(r1.sample_sufficient).toBe(false);
  });

  it("ignores malformed applied_rule_ids and blank task ids", () => {
    const rows = [
      row({ task_id: "", applied_rule_ids: ["r1"], decision: "APPROVED" }),
      row({ task_id: "t1", applied_rule_ids: "not-an-array", decision: "APPROVED" }),
      row({ task_id: "t2", applied_rule_ids: [null, "", "r1"], decision: "APPROVED" }),
    ];
    const result = aggregateRuleEffectiveness(rows, baseline);
    expect(result).toHaveLength(1);
    expect(result[0].rule_id).toBe("r1");
    expect(result[0].attributed_tasks).toBe(1);
    expect(result[0].sample_task_ids).toEqual(["t2"]);
  });

  it("sorts by attributed task count descending", () => {
    const rows = [
      row({ task_id: "t1", applied_rule_ids: ["small"] }),
      row({ task_id: "t2", applied_rule_ids: ["big"] }),
      row({ task_id: "t3", applied_rule_ids: ["big"] }),
    ];
    const result = aggregateRuleEffectiveness(rows, baseline);
    expect(result.map((r) => r.rule_id)).toEqual(["big", "small"]);
  });

  it("caps sample_task_ids at the configured limit", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({ task_id: `t${i}`, applied_rule_ids: ["r1"], decision: "APPROVED" })
    );
    const [r1] = aggregateRuleEffectiveness(rows, baseline, { sample_task_limit: 10 });
    expect(r1.attributed_tasks).toBe(15);
    expect(r1.sample_task_ids).toHaveLength(10);
  });

  it("computes holdout treatment-vs-control deltas", () => {
    const rows = [
      // Treatment: r1 applied, both approved.
      row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED", engagement_rate: 0.04 }),
      row({ task_id: "t2", applied_rule_ids: ["r1"], decision: "APPROVED", engagement_rate: 0.02 }),
      // Control: r1 withheld, one approved one rejected.
      row({ task_id: "c1", applied_rule_ids: [], control_rule_ids: ["r1"], decision: "APPROVED", engagement_rate: 0.01 }),
      row({ task_id: "c2", applied_rule_ids: [], control_rule_ids: ["r1"], decision: "REJECTED", engagement_rate: 0.01 }),
    ];
    const [r1] = aggregateRuleEffectiveness(rows, baseline);
    expect(r1.rule_id).toBe("r1");
    expect(r1.holdout).not.toBeNull();
    expect(r1.holdout?.control_tasks).toBe(2);
    expect(r1.holdout?.control_decided).toBe(2);
    expect(r1.holdout?.control_approval_rate).toBe(0.5);
    expect(r1.holdout?.approval_delta_vs_control).toBe(0.5);
    expect(r1.holdout?.control_avg_engagement_rate).toBeCloseTo(0.01, 8);
    expect(r1.holdout?.engagement_delta_vs_control).toBeCloseTo(0.02, 8);
  });

  it("holdout is null when no control attribution exists", () => {
    const rows = [row({ task_id: "t1", applied_rule_ids: ["r1"], decision: "APPROVED" })];
    const [r1] = aggregateRuleEffectiveness(rows, baseline);
    expect(r1.holdout).toBeNull();
  });
});
