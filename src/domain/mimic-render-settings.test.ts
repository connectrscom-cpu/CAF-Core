import { describe, expect, it } from "vitest";
import {
  buildVisualVariantSimilarityInstruction,
  clampMimicVisualSimilarityPct,
  effectiveMimicCarouselTextViaFlux,
  effectiveMimicVisualSimilarityPct,
  isBoldMimicVisualVariant,
  parseProjectMimicVisualSimilarityPct,
} from "./mimic-render-settings.js";

describe("mimic-render-settings", () => {
  it("clamps visual similarity to 0–100", () => {
    expect(clampMimicVisualSimilarityPct(70)).toBe(70);
    expect(clampMimicVisualSimilarityPct(-5)).toBe(0);
    expect(clampMimicVisualSimilarityPct(150)).toBe(100);
  });

  it("uses project override then env default", () => {
    expect(effectiveMimicVisualSimilarityPct(65, 70)).toBe(65);
    expect(effectiveMimicVisualSimilarityPct(null, 70)).toBe(70);
  });

  it("parses project similarity pct", () => {
    expect(parseProjectMimicVisualSimilarityPct(72)).toBe(72);
    expect(parseProjectMimicVisualSimilarityPct("")).toBeNull();
    expect(parseProjectMimicVisualSimilarityPct("nope")).toBeNull();
  });

  it("builds variant instruction with requested pct", () => {
    expect(buildVisualVariantSimilarityInstruction(70)).toContain("~70%");
    expect(buildVisualVariantSimilarityInstruction(80)).toContain("~80%");
    expect(buildVisualVariantSimilarityInstruction(70)).toContain("variant");
    expect(buildVisualVariantSimilarityInstruction(10)).toContain("Make a new slide like this");
    expect(buildVisualVariantSimilarityInstruction(95)).toContain("very close");
  });

  it("detects bold variant band at 25% and below", () => {
    expect(isBoldMimicVisualVariant(10)).toBe(true);
    expect(isBoldMimicVisualVariant(25)).toBe(true);
    expect(isBoldMimicVisualVariant(26)).toBe(false);
  });

  it("bold variant instruction keeps same-copy and like-this framing", () => {
    expect(buildVisualVariantSimilarityInstruction(10)).toContain("Make a new slide like this");
    expect(buildVisualVariantSimilarityInstruction(10)).toContain("does not need to be the same photo");
  });

  it("resolves carousel text via flux flag", () => {
    expect(effectiveMimicCarouselTextViaFlux(true, false)).toBe(true);
    expect(effectiveMimicCarouselTextViaFlux(false, true)).toBe(false);
    expect(effectiveMimicCarouselTextViaFlux(null, true)).toBe(true);
  });
});
