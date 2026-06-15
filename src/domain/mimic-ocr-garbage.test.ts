import { describe, expect, it } from "vitest";
import { isLikelyOcrGarbageText, slideCopyBlocksNeedCoherence } from "./mimic-ocr-garbage.js";

describe("mimic-ocr-garbage", () => {
  it("flags LaTeX and math OCR noise", () => {
    expect(isLikelyOcrGarbageText("\\negB\\capC^{\\prime} XYZ")).toBe(true);
    expect(isLikelyOcrGarbageText("4578*250_%^8 ab ... m=x+yi")).toBe(true);
    expect(isLikelyOcrGarbageText("P(B)=\\sum(\\beta) J")).toBe(true);
  });

  it("allows normal carousel copy", () => {
    expect(isLikelyOcrGarbageText("what it's like to be a virgo")).toBe(false);
    expect(isLikelyOcrGarbageText("@glossy_horoscope")).toBe(false);
    expect(isLikelyOcrGarbageText('"you seem harsh"')).toBe(false);
  });

  it("detects fragmented slide copy", () => {
    expect(
      slideCopyBlocksNeedCoherence([
        "what it's like to be a",
        "virgo (no explanation)",
        "4578*250_%^8",
      ])
    ).toBe(true);
    expect(slideCopyBlocksNeedCoherence(["Texting a Gemini friend", "when they leave you on read."])).toBe(false);
  });
});
