import { describe, expect, it, vi } from "vitest";

vi.mock("../repositories/core.js", () => {
  return {
    countJobsCreatedToday: vi.fn(async () => 0),
    ensureProject: vi.fn(async (_db: unknown, slug: string) => {
      if (slug === "caf-global") return { id: "proj_global" };
      return { id: "proj_main" };
    }),
    getConstraints: vi.fn(async () => null),
    normalizePerFlowCaps: (x: unknown) => x ?? {},
    insertDecisionTrace: vi.fn(async () => undefined),
    listActiveSuppressionRules: vi.fn(async () => []),
  };
});

vi.mock("../services/learning-rule-selection.js", () => {
  return { getLearningRulesForPlanning: vi.fn(async () => []) };
});

vi.mock("./kill_switches.js", () => {
  return {
    evaluateKillSwitches: vi.fn(async () => ({
      hardStop: false,
      reasons: [],
      blockedFlowTypes: new Set<string>(),
    })),
  };
});

vi.mock("./prompt_selector.js", () => {
  return {
    resolvePromptVersion: vi.fn(async () => ({
      selected: { prompt_version_id: "pv_1", prompt_id: "p_1", version: "v1" },
      source: "project",
    })),
  };
});

vi.mock("./route_selector.js", () => {
  return { selectRoute: vi.fn(() => "HUMAN_REVIEW") };
});

describe("decideGenerationPlan", () => {
  it("does not select the same idea twice for the same format bucket", async () => {
    const { decideGenerationPlan } = await import("./index.js");

    const result = await decideGenerationPlan(
      {} as any,
      {
        DECISION_ENGINE_VERSION: "test",
        DEFAULT_MIN_SCORE_TO_GENERATE: 0,
        DEFAULT_MAX_VARIATIONS: 1,
        DEFAULT_MAX_DAILY_JOBS: null,
        DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN: 100,
        DEFAULT_MAX_VIDEO_JOBS_PER_RUN: 100,
        DEFAULT_OTHER_FLOW_PLAN_CAP: 100,
      } as any,
      {
      project_slug: "p",
      run_id: "RUN_1",
      min_score: 0,
      max_variations_per_candidate: 1,
      dry_run: true,
      candidates: [
        {
          candidate_id: "idea1_FLOW_CAROUSEL",
          flow_type: "FLOW_CAROUSEL",
          target_platform: "Instagram",
          confidence_score: 1,
          payload: { idea_id: "idea1", format: "carousel" },
          dedupe_key: "k1",
        },
        {
          candidate_id: "idea1_Flow_Carousel_Copy",
          flow_type: "Flow_Carousel_Copy",
          target_platform: "Instagram",
          confidence_score: 0.9,
          payload: { idea_id: "idea1", format: "carousel" },
          dedupe_key: "k2",
        },
      ],
      }
    );

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.candidate_id).toBe("idea1_FLOW_CAROUSEL");
    expect(result.dropped_candidates.some((d) => d.reason === "duplicate_idea_format")).toBe(true);
  });
});

