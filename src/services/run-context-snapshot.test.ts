import { describe, it, expect } from "vitest";
import {
  RUN_CONTEXT_SNAPSHOT_VERSION,
  buildRunContextSnapshot,
  fingerprintGuidance,
  pickBrandSliceForSnapshot,
  pickStrategySliceForSnapshot,
} from "./run-context-snapshot.js";

describe("fingerprintGuidance", () => {
  it("returns 'empty' for empty strings", () => {
    expect(fingerprintGuidance("")).toBe("empty");
    expect(fingerprintGuidance("   ")).toBe("empty");
  });
  it("is stable for the same text", () => {
    const a = fingerprintGuidance("hello world");
    const b = fingerprintGuidance("hello world");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
  it("differs for different text", () => {
    expect(fingerprintGuidance("a")).not.toBe(fingerprintGuidance("b"));
  });
});

describe("pickBrandSliceForSnapshot", () => {
  it("keeps only known brand_constraints keys; null when nothing matches", () => {
    expect(pickBrandSliceForSnapshot(null)).toBeNull();
    expect(pickBrandSliceForSnapshot({ unrelated: 1 })).toBeNull();
    expect(
      pickBrandSliceForSnapshot({ tone: "crisp", voice_style: "punchy", other: "x" })
    ).toEqual({ tone: "crisp", voice_style: "punchy" });
  });
  it("drops empty strings / null values", () => {
    expect(pickBrandSliceForSnapshot({ tone: "", voice_style: null })).toBeNull();
  });
});

describe("pickStrategySliceForSnapshot", () => {
  it("keeps only known strategy_defaults keys", () => {
    expect(
      pickStrategySliceForSnapshot({ primary_business_goal: "awareness", owner: "me" })
    ).toEqual({ primary_business_goal: "awareness" });
    expect(pickStrategySliceForSnapshot({})).toBeNull();
  });
});

describe("buildRunContextSnapshot", () => {
  const base = {
    run_id: "run_x",
    project_slug: "myday",
    engine_version: "2025.11",
    trace_id: "trace_1",
    prompt_versions: {
      trace_id: "trace_1",
      engine_version: "2025.11",
      captured_at: "2025-01-01T00:00:00.000Z",
      jobs: [],
    },
    project_config: {
      enabled_flow_types: ["Flow_Carousel_SNS5", "FLOW_IMG_PRODUCT_A"],
      strategy_slice: { primary_business_goal: "awareness" },
      brand_slice: { tone: "crisp" },
    },
    learning: [
      {
        flow_type: "Flow_Carousel_SNS5",
        platform: "instagram",
        compiled: { applied_rule_ids: ["r2", "r1"], merged_guidance: "some text" },
      },
    ],
  };

  it("assembles a stable shape + sorts applied_rule_ids + computes fingerprint", () => {
    const snap = buildRunContextSnapshot(base);
    expect(snap.snapshot_version).toBe(RUN_CONTEXT_SNAPSHOT_VERSION);
    expect(snap.run_id).toBe("run_x");
    expect(snap.project_slug).toBe("myday");
    expect(snap.project_config.enabled_flow_types).toEqual([
      "FLOW_IMG_PRODUCT_A",
      "Flow_Carousel_SNS5",
    ]);
    expect(snap.learning[0].applied_rule_ids).toEqual(["r1", "r2"]);
    expect(snap.learning[0].guidance_fingerprint).toHaveLength(16);
    expect(snap.learning[0].guidance_chars).toBe("some text".length);
  });

  it("handles an empty learning context", () => {
    const snap = buildRunContextSnapshot({
      ...base,
      learning: [
        {
          flow_type: null,
          platform: null,
          compiled: { applied_rule_ids: [], merged_guidance: "" },
        },
      ],
    });
    expect(snap.learning[0].guidance_fingerprint).toBe("empty");
    expect(snap.learning[0].guidance_chars).toBe(0);
  });
});
