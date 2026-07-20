import { describe, expect, it } from "vitest";
import { ruleHeadline } from "./marketer-performance-summary.js";

describe("ruleHeadline", () => {
  it("prefers instruction text", () => {
    expect(
      ruleHeadline("GENERATION_GUIDANCE", { instruction: "Open with a question.", guidance: "long text" })
    ).toBe("Open with a question.");
  });

  it("falls back to guidance then observation", () => {
    expect(ruleHeadline("GENERATION_GUIDANCE", { guidance: "Keep captions short." })).toBe(
      "Keep captions short."
    );
    expect(ruleHeadline("SCORE_BOOST", { observation: "Flow X outperforms baseline." })).toBe(
      "Flow X outperforms baseline."
    );
  });

  it("truncates long text to ~180 chars", () => {
    const long = "a".repeat(400);
    const out = ruleHeadline("GENERATION_GUIDANCE", { instruction: long });
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith("...")).toBe(true);
  });

  it("describes ranking rules from flow_type when no text exists", () => {
    expect(ruleHeadline("SCORE_BOOST", { flow_type: "FLOW_CAROUSEL" })).toBe(
      "Prioritize FLOW_CAROUSEL in planning"
    );
    expect(ruleHeadline("SCORE_PENALTY", { flow_type: "FLOW_VID_UGC" })).toBe(
      "De-prioritize FLOW_VID_UGC in planning"
    );
  });

  it("degrades to a humanized action type", () => {
    expect(ruleHeadline("BOOST_RANK", {})).toBe("boost rank");
    expect(ruleHeadline("BOOST_RANK", null)).toBe("boost rank");
  });
});
