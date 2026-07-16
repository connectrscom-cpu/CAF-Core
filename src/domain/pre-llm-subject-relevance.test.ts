import { describe, expect, it } from "vitest";
import {
  blendPerformanceAndSubject,
  computeSubjectRelevanceScore,
  parseSubjectRelevanceConfig,
} from "./pre-llm-subject-relevance.js";

describe("pre-llm-subject-relevance", () => {
  const cfg = parseSubjectRelevanceConfig({
    include_keywords: ["confidential documents", "secure AI"],
    include_hashtags: ["#DocumentAI"],
    exclude_keywords: ["crypto"],
    min_score: 0.2,
    subject_weight: 0.35,
    performance_weight: 0.65,
    apply_to_kinds: ["linkedin_post"],
  })!;

  it("matches include keywords in caption", () => {
    const r = computeSubjectRelevanceScore(
      { caption: "How to use secure AI on confidential documents in legal review" },
      cfg
    );
    expect(r.matched_includes.length).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it("drops score when exclude keyword matches", () => {
    const r = computeSubjectRelevanceScore({ caption: "Bitcoin crypto trading tips" }, cfg);
    expect(r.score).toBe(0);
    expect(r.matched_excludes).toContain("crypto");
  });

  it("blends performance and subject scores", () => {
    const blended = blendPerformanceAndSubject(0.8, 0.4, cfg);
    expect(blended).toBeGreaterThan(0.4);
    expect(blended).toBeLessThan(0.8);
  });
});
