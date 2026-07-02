import { describe, expect, it } from "vitest";
import { runCopyQualityChecks } from "./copy-quality-patterns.js";

describe("runCopyQualityChecks", () => {
  it("fails meme contrast and placeholder hashtags", () => {
    const findings = runCopyQualityChecks({
      hook: "Born to roam free",
      caption: "Forced to run meetings every Monday",
      hashtags: ["#example"],
    });
    const ids = findings.map((f) => f.check_id);
    expect(ids).toContain("copy_meme_contrast_template");
    expect(ids).toContain("metadata_hashtags_missing");
  });

  it("passes when hashtags and copy are substantive", () => {
    const findings = runCopyQualityChecks(
      {
        hook: "When Mercury squares your Venus",
        caption: "A pattern in how you seek reassurance in conflict — not a prediction.",
        hashtags: ["#astrology", "#relationships"],
      },
      { brandTone: "warm, emotionally intelligent" }
    );
    expect(findings.every((f) => f.passed)).toBe(true);
  });
});
