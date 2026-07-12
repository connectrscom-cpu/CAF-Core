import { describe, expect, it } from "vitest";
import {
  extractHexPalette,
  isGapValue,
  mapVisualMode,
  ONBOARDING_PACK_TEMPLATE,
  parseOnboardingPack,
  researchEntryToPayload,
} from "./onboarding-pack-parser.js";

describe("parseOnboardingPack", () => {
  it("parses the built-in template", () => {
    const parsed = parseOnboardingPack(ONBOARDING_PACK_TEMPLATE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.brand_snapshot?.["display name"]).toBe("My Brand");
    expect(parsed.sections.brand_snapshot?.slug).toBe("MY_BRAND");
    expect(parsed.sections.strategy?.["audience type"]).toBe("B2C");
    expect(parsed.sections.voice?.["banned words"]).toContain("miracle");
    expect(parsed.researchLists.hashtags).toEqual(expect.arrayContaining(["#easyrecipes", "#mealplan"]));
    expect(parsed.researchLists.subreddits).toEqual(expect.arrayContaining(["r/MealPrepSunday"]));
  });

  it("parses plain-text field labels without markdown bullets", () => {
    const text = `## 1. Brand snapshot
Display name: Cuisina
Slug: Cuisina
Description: Friendly sous-chef for weekly meals.
Website: https://cuisina.it

## 2. Strategy
Audience: Busy households.
Problem: Decision fatigue.
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.brand_snapshot?.["display name"]).toBe("Cuisina");
    expect(parsed.sections.brand_snapshot?.website).toBe("https://cuisina.it");
    expect(parsed.sections.strategy?.audience).toBe("Busy households.");
  });

  it("skips GAP values and collects them", () => {
    const text = `## 1. Brand snapshot
- Instagram: [GAP — not in project knowledge]
- Website: https://cuisina.it

## 9. Gaps & next steps
- Gaps: [GAP] Exact Instagram handle.
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.sections.brand_snapshot?.instagram).toBeUndefined();
    expect(parsed.sections.brand_snapshot?.website).toBe("https://cuisina.it");
    expect(parsed.gaps.length).toBeGreaterThan(0);
  });
});

describe("isGapValue", () => {
  it("detects gap markers", () => {
    expect(isGapValue("[GAP — not in project knowledge]")).toBe(true);
    expect(isGapValue("https://cuisina.it")).toBe(false);
  });
});

describe("extractHexPalette", () => {
  it("pulls hex codes from palette prose", () => {
    expect(extractHexPalette("Primary green: #16a34a; text #1a1a1a")).toEqual(["#16a34a", "#1a1a1a"]);
  });
});

describe("mapVisualMode", () => {
  it("maps prose to bible visual modes", () => {
    expect(mapVisualMode("Mixed")).toBe("mixed");
    expect(mapVisualMode("Food photography")).toBe("photography");
  });
});

describe("researchEntryToPayload", () => {
  it("normalizes hashtags and reddit communities", () => {
    expect(researchEntryToPayload("hashtags", "#mealplan")).toEqual({
      Name: "mealplan",
      Link: "#mealplan",
      Platform: "Multi-platform",
    });
    expect(researchEntryToPayload("subreddits", "r/MealPrepSunday").Link).toContain("/r/MealPrepSunday/");
  });
});
