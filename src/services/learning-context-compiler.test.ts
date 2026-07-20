import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { compileLearningContexts, isWithinValidityWindow } from "./learning-context-compiler.js";

const listLearningRulesMerged = vi.fn();

vi.mock("../repositories/learning.js", () => ({
  listLearningRulesMerged: (...args: unknown[]) => listLearningRulesMerged(...args),
}));

const db = {} as Pool;
const projectId = "proj_test";
const now = new Date("2026-07-16T12:00:00.000Z");

function guidanceRule(
  overrides: Partial<Record<string, unknown>> & { rule_id: string }
): Record<string, unknown> {
  return {
    status: "active",
    rule_family: "generation",
    action_type: "GENERATION_GUIDANCE",
    action_payload: { guidance: `text:${overrides.rule_id}` },
    applied_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    valid_from: null,
    valid_to: null,
    scope_flow_type: null,
    scope_platform: null,
    ...overrides,
  };
}

describe("isWithinValidityWindow", () => {
  it("excludes past expires_at", () => {
    expect(
      isWithinValidityWindow({ expires_at: "2026-07-01T00:00:00.000Z" }, now)
    ).toBe(false);
  });

  it("excludes past valid_to", () => {
    expect(isWithinValidityWindow({ valid_to: "2026-07-01T00:00:00.000Z" }, now)).toBe(
      false
    );
  });

  it("excludes future valid_from", () => {
    expect(
      isWithinValidityWindow({ valid_from: "2026-08-01T00:00:00.000Z" }, now)
    ).toBe(false);
  });

  it("includes when all windows are null", () => {
    expect(
      isWithinValidityWindow(
        { expires_at: null, valid_from: null, valid_to: null },
        now
      )
    ).toBe(true);
  });
});

describe("compileLearningContexts validity windows", () => {
  beforeEach(() => {
    listLearningRulesMerged.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a) excludes active rule with past expires_at", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "expired",
        expires_at: "2026-07-01T00:00:00.000Z",
      }),
      guidanceRule({ rule_id: "ok" }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual(["ok"]);
    expect(compiled.merged_guidance).toBe("text:ok");
  });

  it("b) excludes active rule with past valid_to", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "ended",
        valid_to: "2026-06-01T00:00:00.000Z",
      }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual([]);
    expect(compiled.merged_guidance).toBe("");
  });

  it("c) excludes active rule with future valid_from", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "future",
        valid_from: "2026-12-01T00:00:00.000Z",
      }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual([]);
  });

  it("d) includes active rule with all windows null (regression)", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({ rule_id: "open" }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual(["open"]);
    expect(compiled.merged_guidance).toBe("text:open");
  });

  it("e) pending rework guidance: valid windows included; past expires_at excluded", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "pending_ok",
        status: "pending",
        applied_at: null,
      }),
      guidanceRule({
        rule_id: "pending_expired",
        status: "pending",
        applied_at: null,
        expires_at: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    const without = await compileLearningContexts(db, projectId, null, null);
    expect(without.applied_rule_ids).toEqual([]);

    const withPending = await compileLearningContexts(db, projectId, null, null, {
      include_pending_generation_guidance: true,
    });
    expect(withPending.applied_rule_ids).toEqual(["pending_ok"]);
    expect(withPending.merged_guidance).toBe("text:pending_ok");
  });

  it("f) excludes active rule with applied_at null", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({ rule_id: "never_applied", applied_at: null }),
      guidanceRule({ rule_id: "applied" }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual(["applied"]);
  });

  it("does not change listLearningRulesMerged args (project-only, no filter there)", async () => {
    listLearningRulesMerged.mockResolvedValue([]);
    await compileLearningContexts(db, projectId, "FLOW_CAROUSEL", "Instagram");
    expect(listLearningRulesMerged).toHaveBeenCalledWith(db, projectId, null);
  });
});

describe("compileLearningContexts dedupe / rank / budget", () => {
  beforeEach(() => {
    listLearningRulesMerged.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses near-duplicate guidance, keeping the higher-confidence rule", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "low_conf",
        confidence: 0.3,
        action_payload: { guidance: "Always open the hook with a specific number or timeframe." },
      }),
      guidanceRule({
        rule_id: "high_conf",
        confidence: 0.9,
        action_payload: { guidance: "Always open the hook with a specific number or timeframe!" },
      }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual(["high_conf"]);
  });

  it("ranks active rules by confidence descending", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({ rule_id: "weak", confidence: 0.2, action_payload: { guidance: "Weak guidance about captions." } }),
      guidanceRule({ rule_id: "strong", confidence: 0.95, action_payload: { guidance: "Strong guidance about visual pacing." } }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.applied_rule_ids).toEqual(["strong", "weak"]);
  });

  it("puts pending rework guidance ahead of active rules", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({ rule_id: "active_rule", confidence: 0.99, action_payload: { guidance: "Active guidance about hooks." } }),
      guidanceRule({
        rule_id: "rework_hint",
        status: "pending",
        applied_at: null,
        action_payload: { guidance: "Human said shorten the caption drastically." },
      }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null, {
      include_pending_generation_guidance: true,
    });
    expect(compiled.applied_rule_ids).toEqual(["rework_hint", "active_rule"]);
  });

  it("enforces the max_rules budget and reports only included rules", async () => {
    listLearningRulesMerged.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) =>
        guidanceRule({
          rule_id: `r${i}`,
          confidence: 1 - i * 0.1,
          action_payload: { guidance: `Completely distinct guidance topic number ${i} about ${["hooks", "captions", "colors", "pacing", "endings", "fonts"][i]}.` },
        })
      )
    );

    const compiled = await compileLearningContexts(db, projectId, null, null, { max_rules: 3 });
    expect(compiled.applied_rule_ids).toHaveLength(3);
    expect(compiled.applied_rule_ids).toEqual(["r0", "r1", "r2"]);
  });

  it("enforces the char budget but always includes the top rule", async () => {
    const long = "L".repeat(500);
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({ rule_id: "big", confidence: 0.9, action_payload: { guidance: `Big block ${long}` } }),
      guidanceRule({ rule_id: "second", confidence: 0.8, action_payload: { guidance: `Second distinct topic entirely different words ${"x".repeat(300)}` } }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null, {
      max_guidance_chars: 520,
    });
    expect(compiled.applied_rule_ids).toEqual(["big"]);
  });
});

describe("compileLearningContexts holdout experiments", () => {
  beforeEach(() => {
    listLearningRulesMerged.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("withholds a full-holdout rule and reports it as control", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "experimental",
        action_payload: { guidance: "Experimental guidance.", holdout_fraction: 1 },
      }),
      guidanceRule({ rule_id: "stable", action_payload: { guidance: "Stable guidance about topics." } }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null, { task_id: "TASK_1" });
    expect(compiled.applied_rule_ids).toEqual(["stable"]);
    expect(compiled.control_rule_ids).toEqual(["experimental"]);
  });

  it("holdout_fraction 0 or missing task_id never withholds", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "zero_holdout",
        action_payload: { guidance: "Guidance A.", holdout_fraction: 0 },
      }),
      guidanceRule({
        rule_id: "half_holdout_no_task",
        action_payload: { guidance: "Guidance B entirely different.", holdout_fraction: 0.5 },
      }),
    ]);

    const compiled = await compileLearningContexts(db, projectId, null, null);
    expect(compiled.control_rule_ids).toEqual([]);
    expect(compiled.applied_rule_ids).toHaveLength(2);
  });

  it("assignment is deterministic per (rule, task)", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "coin_flip",
        action_payload: { guidance: "Half holdout guidance.", holdout_fraction: 0.5 },
      }),
    ]);

    const first = await compileLearningContexts(db, projectId, null, null, { task_id: "TASK_X" });
    const second = await compileLearningContexts(db, projectId, null, null, { task_id: "TASK_X" });
    expect(first.applied_rule_ids).toEqual(second.applied_rule_ids);
    expect(first.control_rule_ids).toEqual(second.control_rule_ids);
  });

  it("roughly splits tasks between treatment and control at 0.5", async () => {
    listLearningRulesMerged.mockResolvedValue([
      guidanceRule({
        rule_id: "split_rule",
        action_payload: { guidance: "Split guidance.", holdout_fraction: 0.5 },
      }),
    ]);

    let control = 0;
    for (let i = 0; i < 40; i++) {
      const c = await compileLearningContexts(db, projectId, null, null, { task_id: `TASK_${i}` });
      if (c.control_rule_ids.length > 0) control++;
    }
    expect(control).toBeGreaterThan(5);
    expect(control).toBeLessThan(35);
  });
});
