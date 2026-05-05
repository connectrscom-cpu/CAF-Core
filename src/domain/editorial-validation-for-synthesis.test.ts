import { describe, expect, it } from "vitest";
import {
  compactValidationOutputForEditorialSynthesis,
  validationCompactHasStructuredSignal,
} from "./editorial-validation-for-synthesis.js";

describe("compactValidationOutputForEditorialSynthesis", () => {
  it("returns null for empty object", () => {
    expect(compactValidationOutputForEditorialSynthesis({})).toBeNull();
  });

  it("parses findings and tags", () => {
    const c = compactValidationOutputForEditorialSynthesis({
      schema_version: "v1",
      decision: "NEEDS_EDIT",
      content_kind: "carousel",
      issue_tags: ["tone_off"],
      findings: [
        {
          label: "bad_structure",
          severity: "warn",
          message: "Slide 3 too long.",
          suggestion: "Cut to one sentence.",
          location: { area: "slide_body", slide_index: 2 },
        },
      ],
      rework_hints: { regenerate: false, rewrite_copy: true },
      notes: "Please tighten hook.",
    });
    expect(c).not.toBeNull();
    expect(c!.issue_tags).toEqual(["tone_off"]);
    expect(c!.findings).toHaveLength(1);
    expect(c!.findings[0]!.label).toBe("bad_structure");
    expect(validationCompactHasStructuredSignal(c!)).toBe(true);
  });

  it("detects rework hint signal without notes", () => {
    const c = compactValidationOutputForEditorialSynthesis({
      schema_version: "v1",
      rework_hints: { regenerate: true },
      findings: [],
      issue_tags: [],
    });
    expect(c).not.toBeNull();
    expect(validationCompactHasStructuredSignal(c!)).toBe(true);
  });
});
