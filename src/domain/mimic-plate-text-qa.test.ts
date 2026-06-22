import { describe, expect, it } from "vitest";
import {
  isLayoutCoordinateOcrNoise,
  isPollutingPlateText,
  isSuspiciousPlateText,
  plateTextQaVerdict,
} from "./mimic-plate-text-qa.js";

describe("mimic-plate-text-qa", () => {
  it("flags OCR garbage as suspicious", () => {
    expect(isSuspiciousPlateText("ADGÉMLES ASTROLOIICAL")).toBe(true);
    expect(isSuspiciousPlateText("12-34-56 78%")).toBe(true);
  });

  it("ignores safe-zone coordinate OCR noise", () => {
    expect(isLayoutCoordinateOcrNoise("16-84 % wicthe 19-8 % witfx25-55Het")).toBe(true);
    expect(isPollutingPlateText("16-84 % wicthe 19-8 % witfx25-55Het")).toBe(false);
    expect(isPollutingPlateText("37-82 wlw x33-8telim")).toBe(false);
  });

  it("still flags semantic text pollution", () => {
    expect(isPollutingPlateText("Virgo mother characteristics")).toBe(true);
    expect(isPollutingPlateText("Weua traed Ercana.Irsel")).toBe(true);
  });

  it("passes clean plates with no readable text", () => {
    expect(plateTextQaVerdict([])).toEqual({ passed: true, suspicious: [] });
    expect(plateTextQaVerdict(["@", "  "])).toEqual({ passed: true, suspicious: [] });
  });

  it("ignores benign OCR phantom noise", () => {
    expect(plateTextQaVerdict(["\\times76nran", "m -"]).passed).toBe(true);
  });

  it("fails plates with leftover copy", () => {
    const verdict = plateTextQaVerdict(["Your zodiac sign reveals everything"]);
    expect(verdict.passed).toBe(false);
    expect(verdict.suspicious.length).toBeGreaterThan(0);
  });

  it("allows instagram handles only", () => {
    expect(plateTextQaVerdict(["@snsastrology"]).passed).toBe(true);
  });
});