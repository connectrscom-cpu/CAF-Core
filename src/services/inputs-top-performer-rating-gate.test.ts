import { describe, expect, it } from "vitest";
import { buildTopPerformerRatingGateRequestOverrides } from "./inputs-top-performer-rating-gate.js";

describe("buildTopPerformerRatingGateRequestOverrides", () => {
  it("returns undefined when no overrides", () => {
    expect(buildTopPerformerRatingGateRequestOverrides({})).toBeUndefined();
  });

  it("passes through disable flag", () => {
    expect(buildTopPerformerRatingGateRequestOverrides({ disable_rating_percentile_gate: true })).toEqual({
      disable_rating_percentile_gate: true,
    });
  });

  it("passes finite rating_top_fraction", () => {
    expect(buildTopPerformerRatingGateRequestOverrides({ rating_top_fraction: 0.1 })).toEqual({
      rating_top_fraction: 0.1,
    });
  });

  it("ignores non-finite fraction", () => {
    expect(
      buildTopPerformerRatingGateRequestOverrides({ rating_top_fraction: Number.NaN, disable_rating_percentile_gate: true })
    ).toEqual({ disable_rating_percentile_gate: true });
  });
});
