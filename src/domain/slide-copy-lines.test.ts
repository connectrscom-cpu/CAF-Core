import { describe, expect, it } from "vitest";
import { coerceSlideBodyCopyText, joinBodyLineArray, repairArrayStringifiedBody } from "./slide-copy-lines.js";

describe("slide-copy-lines", () => {
  it("joinBodyLineArray joins with newlines", () => {
    expect(joinBodyLineArray(["A.", "B."])).toBe("A.\nB.");
  });

  it("repairArrayStringifiedBody restores array-toString commas", () => {
    expect(repairArrayStringifiedBody("A.,B.,C.")).toBe("A.\nB.\nC.");
  });

  it("preserves prose commas and thousands separators", () => {
    expect(repairArrayStringifiedBody("Dear Taurus, your steady nature")).toBe("Dear Taurus, your steady nature");
    expect(repairArrayStringifiedBody("Over 1,000 readers agree.,Join today.")).toBe(
      "Over 1,000 readers agree.\nJoin today."
    );
  });

  it("coerceSlideBodyCopyText handles arrays and comma strings", () => {
    expect(coerceSlideBodyCopyText(["Dear Taurus, steady.", "Awareness blooms."])).toBe(
      "Dear Taurus, steady.\nAwareness blooms."
    );
    expect(coerceSlideBodyCopyText("Dear Taurus, steady.,Awareness blooms.")).toBe(
      "Dear Taurus, steady.\nAwareness blooms."
    );
  });
});
