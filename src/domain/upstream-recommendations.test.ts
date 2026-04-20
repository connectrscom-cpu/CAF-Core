import { describe, it, expect } from "vitest";
import {
  parseUpstreamRecommendations,
  upstreamRecommendationSchema,
} from "./upstream-recommendations.js";

describe("parseUpstreamRecommendations", () => {
  it("returns [] for non-array / missing input", () => {
    expect(parseUpstreamRecommendations(undefined)).toEqual([]);
    expect(parseUpstreamRecommendations(null)).toEqual([]);
    expect(parseUpstreamRecommendations({})).toEqual([]);
    expect(parseUpstreamRecommendations("nope")).toEqual([]);
  });

  it("drops items without a `change` string", () => {
    const out = parseUpstreamRecommendations([
      { target: "prompt_template" },
      { target: "prompt_template", change: "" },
      { change: "x" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].change).toBe("x");
    expect(out[0].target).toBe("other");
  });

  it("coerces unknown targets to 'other'", () => {
    const [rec] = parseUpstreamRecommendations([
      { target: "banana", change: "Rewrite hook rule" },
    ]);
    expect(rec.target).toBe("other");
  });

  it("keeps valid target + rationale + field_or_check_id", () => {
    const [rec] = parseUpstreamRecommendations([
      {
        target: "qc_checklist",
        change: "Enforce min_length=30 on hook",
        rationale: "Approved post had a 6-word hook.",
        field_or_check_id: "qc.hook.min_length",
      },
    ]);
    expect(rec.target).toBe("qc_checklist");
    expect(rec.change).toMatch(/Enforce min_length/);
    expect(rec.rationale).toMatch(/Approved post/);
    expect(rec.field_or_check_id).toBe("qc.hook.min_length");
  });

  it("caps array length at 20", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      target: "prompt_template",
      change: `item ${i}`,
    }));
    expect(parseUpstreamRecommendations(many)).toHaveLength(20);
  });

  it("matches the zod schema shape for each parsed row", () => {
    const out = parseUpstreamRecommendations([
      { target: "prompt_template", change: "x" },
    ]);
    expect(upstreamRecommendationSchema.parse(out[0])).toEqual(out[0]);
  });
});
