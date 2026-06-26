import { describe, expect, it } from "vitest";
import { deriveLearningSignalsFromOutputInsights } from "./generated-output-learning-derive.js";

describe("deriveLearningSignalsFromOutputInsights", () => {
  it("maps TP-parity fields into scores, bullets, and upstream recs", () => {
    const derived = deriveLearningSignalsFromOutputInsights(
      {
        format_pattern: "problem_solution_cta",
        why_it_worked: "Clear hook-to-proof arc with a direct CTA.",
        slide_arc: "strong progression",
        cta_clarity: "clear",
        slides: [{ slide_index: 1, slide_purpose: "hook" }],
        mimic_evaluation: { template_storage_quality: "accept" },
      },
      { risk_flags: ["medical claim risk"] }
    );

    expect(derived.overall_score).toBeGreaterThan(0.5);
    expect(derived.strengths.some((s) => /hook-to-proof/i.test(s))).toBe(true);
    expect(derived.weaknesses.some((w) => /medical claim/i.test(w))).toBe(true);
    expect(derived.improvement_bullets.length).toBeGreaterThan(0);
    expect(derived.insight_fields.format_pattern).toBe("problem_solution_cta");
    expect(derived.risk_flags).toContain("medical claim risk");
  });

  it("penalizes reject template quality", () => {
    const derived = deriveLearningSignalsFromOutputInsights(
      {
        format_pattern: "unknown",
        mimic_evaluation: { template_storage_quality: "reject" },
      },
      null
    );
    expect(derived.overall_score).toBeLessThan(0.6);
    expect(derived.weaknesses.some((w) => /template quality/i.test(w))).toBe(true);
  });
});
