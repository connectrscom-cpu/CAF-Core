import { describe, expect, it } from "vitest";
import {
  contrastingTextStyleForLuminance,
  relativeLuminance01,
} from "./mimic-docai-text-contrast.js";

describe("mimic-docai-text-contrast", () => {
  it("relativeLuminance01 ranks white above black", () => {
    expect(relativeLuminance01(1, 1, 1)).toBeGreaterThan(relativeLuminance01(0, 0, 0));
    expect(relativeLuminance01(0.9, 0.2, 0.4)).toBeGreaterThan(0.2);
  });

  it("contrastingTextStyleForLuminance picks dark text on light bg", () => {
    const style = contrastingTextStyleForLuminance(0.85);
    expect(style.color).toBe("#1c1c1e");
    expect(style.textShadow).toContain("255");
  });

  it("contrastingTextStyleForLuminance picks light text on dark bg", () => {
    const style = contrastingTextStyleForLuminance(0.12);
    expect(style.color).toBe("#ffffff");
    expect(style.textShadow).toContain("0,0,0");
  });
});
