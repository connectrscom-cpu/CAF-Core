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
    expect(result.selected.some((j) => j.flow_type === "Flow_Carousel_Copy")).toBe(false);
  });

  it("plans carousel + mimic carousel in parallel for the same idea", async () => {
    const core = await import("../repositories/core.js");
    vi.mocked(core.getConstraints).mockResolvedValueOnce({
      id: "c1",
      project_id: "proj_main",
      max_daily_jobs: null,
      min_score_to_generate: null,
      max_active_prompt_versions: null,
      default_variation_cap: 1,
      auto_validation_pass_threshold: null,
      max_carousel_jobs_per_run: null,
      max_video_jobs_per_run: null,
      max_jobs_per_flow_type: {
        FLOW_TOP_PERFORMER_MIMIC_CAROUSEL: 1,
      },
    });

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
            candidate_id: "idea1_FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
            flow_type: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 0.95,
            payload: { idea_id: "idea1", format: "carousel" },
            dedupe_key: "k1m",
          },
        ],
      }
    );

    expect(result.selected.map((j) => j.flow_type).sort()).toEqual([
      "FLOW_CAROUSEL",
      "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
    ]);
  });

  it("plans carousel ideas on carousel flows only (no video cross-format)", async () => {
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
            candidate_id: "idea1_FLOW_HEYGEN",
            flow_type: "FLOW_HEYGEN_VIDEO",
            target_platform: "Instagram",
            confidence_score: 1,
            payload: { idea_id: "idea1", format: "carousel" },
            dedupe_key: "k1",
          },
          {
            candidate_id: "idea1_FLOW_CAROUSEL",
            flow_type: "FLOW_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 0.5,
            payload: { idea_id: "idea1", format: "carousel" },
            dedupe_key: "k2",
          },
        ],
      }
    );

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.flow_type).toBe("FLOW_CAROUSEL");
  });

  it("plans video ideas on video flows only (no carousel cross-format)", async () => {
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
            candidate_id: "idea2_FLOW_CAROUSEL",
            flow_type: "FLOW_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 1,
            payload: { idea_id: "idea2", format: "video" },
            dedupe_key: "k3",
          },
          {
            candidate_id: "idea2_FLOW_HEYGEN",
            flow_type: "FLOW_HEYGEN_VIDEO",
            target_platform: "Instagram",
            confidence_score: 0.4,
            payload: { idea_id: "idea2", format: "video" },
            dedupe_key: "k4",
          },
        ],
      }
    );

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.flow_type).toBe("FLOW_HEYGEN_VIDEO");
  });

  it("spreads templated carousel v1 across distinct ideas before v2", async () => {
    const { decideGenerationPlan } = await import("./index.js");

    const result = await decideGenerationPlan(
      {} as any,
      {
        DECISION_ENGINE_VERSION: "test",
        DEFAULT_MIN_SCORE_TO_GENERATE: 0,
        DEFAULT_MAX_VARIATIONS: 2,
        DEFAULT_MAX_DAILY_JOBS: null,
        DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN: 100,
        DEFAULT_MAX_VIDEO_JOBS_PER_RUN: 100,
        DEFAULT_OTHER_FLOW_PLAN_CAP: 100,
      } as any,
      {
        project_slug: "p",
        run_id: "RUN_1",
        min_score: 0,
        max_variations_per_candidate: 2,
        dry_run: true,
        candidates: [
          {
            candidate_id: "idea1_FLOW_CAROUSEL",
            flow_type: "FLOW_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 1,
            pre_gen_score: 1,
            payload: { idea_id: "idea1", format: "carousel" },
            dedupe_key: "k1",
          },
          {
            candidate_id: "idea2_FLOW_CAROUSEL",
            flow_type: "FLOW_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 0.9,
            pre_gen_score: 0.9,
            payload: { idea_id: "idea2", format: "carousel" },
            dedupe_key: "k2",
          },
          {
            candidate_id: "idea3_FLOW_CAROUSEL",
            flow_type: "FLOW_CAROUSEL",
            target_platform: "Instagram",
            confidence_score: 0.8,
            pre_gen_score: 0.8,
            payload: { idea_id: "idea3", format: "carousel" },
            dedupe_key: "k3",
          },
        ],
      }
    );

    const carouselJobs = result.selected.filter((j) => j.flow_type === "FLOW_CAROUSEL");
    expect(carouselJobs).toHaveLength(6);
    expect(carouselJobs.slice(0, 3).map((j) => j.candidate_id)).toEqual([
      "idea1_FLOW_CAROUSEL",
      "idea2_FLOW_CAROUSEL",
      "idea3_FLOW_CAROUSEL",
    ]);
    expect(carouselJobs.slice(3).map((j) => j.candidate_id)).toEqual([
      "idea1_FLOW_CAROUSEL",
      "idea2_FLOW_CAROUSEL",
      "idea3_FLOW_CAROUSEL",
    ]);
  });
});

