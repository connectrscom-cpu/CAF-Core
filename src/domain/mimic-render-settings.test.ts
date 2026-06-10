import { describe, expect, it } from "vitest";
import {
  buildVisualVariantSimilarityInstruction,
  clampMimicVisualSimilarityPct,
  effectiveMimicCarouselTextViaFlux,
  effectiveMimicVisualSimilarityPct,
  parseProjectMimicVisualSimilarityPct,
} from "./mimic-render-settings.js";

describe("mimic-render-settings", () => {
  it("clamps visual similarity to 50–95", () => {
    expect(clampMimicVisualSimilarityPct(70)).toBe(70);
    expect(clampMimicVisualSimilarityPct(40)).toBe(50);
    expect(clampMimicVisualSimilarityPct(99)).toBe(95);
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
  });

  it("resolves carousel text via flux flag", () => {
    expect(effectiveMimicCarouselTextViaFlux(true, false)).toBe(true);
    expect(effectiveMimicCarouselTextViaFlux(false, true)).toBe(false);
    expect(effectiveMimicCarouselTextViaFlux(null, true)).toBe(true);
  });
});
