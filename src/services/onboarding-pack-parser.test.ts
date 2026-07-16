import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHexPalette,
  isGapValue,
  mapVisualMode,
  ONBOARDING_PACK_TEMPLATE,
  parseOnboardingPack,
  researchEntryToPayload,
} from "./onboarding-pack-parser.js";

const VAULTLM_PACK_PATH = join(dirname(fileURLToPath(import.meta.url)), "../data/vaultlm-onboarding-pack.md");

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

  it("parses the VaultLM onboarding pack", () => {
    const text = readFileSync(VAULTLM_PACK_PATH, "utf8");
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.title).toBe("VaultLM");
    expect(parsed.readiness).toBe("MVP");
    expect(parsed.sections.brand_snapshot?.slug).toBe("VAULTLM");
    expect(parsed.sections.brand_snapshot?.["display name"]).toBe("VaultLM");
    expect(parsed.sections.strategy?.positioning).toContain("safe layer");
    expect(parsed.researchLists.hashtags).toEqual(expect.arrayContaining(["#SecureAI", "#VaultLM"]));
    expect(parsed.researchLists.websites_blogs).toEqual(
      expect.arrayContaining(["https://vaultlm.eu/en/", "https://sharesafe.ai/"])
    );
    expect(extractHexPalette(parsed.sections.visual?.["palette (hex and roles)"] ?? "")).toEqual(
      expect.arrayContaining(["#2455C3", "#2F66FF", "#0EA37F"])
    );
    expect(parsed.gaps.length).toBeGreaterThan(0);
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

  it("parses Content routes & platforms section", () => {
    const text = `# CAF Project Onboarding Pack — Demo

## 1. Brand snapshot
- Display name: Demo
- Slug: DEMO

## 6. Content routes & platforms
- Enabled content routes: Niche carousels; Brand visual carousels
- Instagram rules: 5–9 slides
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.formats?.["enabled content routes"]).toContain("Niche carousels");
    expect(parsed.sections.formats?.["instagram rules"]).toContain("5–9");
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
