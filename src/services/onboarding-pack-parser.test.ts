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
  stripFactRecPrefix,
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

  it("parses Brand, Platforms, and System limits operator sections", () => {
    const text = `# Brand Onboarding Pack — Demo
## 1. Brand snapshot
- Display name: Demo
- Slug: DEMO

## 3. Brand
- Tone: Calm
- Voice style: Conversational
- Banned words: miracle; guaranteed

## 9. Platforms
- Platform: Instagram
- Caption Max Chars: [REC] use CAF defaults
- Min Slides: 5
- Max Slides: 9

## 10. System limits
- Max daily jobs: [REC] use CAF defaults
- Max carousel jobs (per run plan): 10
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.sections.voice?.tone).toBe("Calm");
    expect(parsed.sections.voice?.["voice style"]).toBe("Conversational");
    expect(parsed.sections.platforms?.platform).toBe("Instagram");
    expect(parsed.sections.platforms?.["min slides"]).toBe("5");
    expect(parsed.sections.system_limits?.["max carousel jobs (per run plan)"]).toBe("10");
  });

  it("parses Product (video flows) and Product Bible sections", () => {
    const text = `# Brand Onboarding Pack — Demo
> Readiness: MVP

## 1. Brand snapshot
- Display name: Demo
- Slug: DEMO

## 7. Product (video flows)
- Product name: [FACT] Demo App
- One-liner: [REC] Plans your week in minutes.
- Elevator pitch: [FACT-derived] Demo is the meal companion that plans ahead.
- Proof points: [FACT — marketing copy claims] Planned in 60 seconds.
- Primary CTA: Start free
- Urgency: [GAP]

## 8. Product Bible
- Instructions: Use real screenshots in walkthroughs.
- HeyGen / video policy: Show home screen first.
- Key: core
- Label: Core app
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.title).toBe("Demo");
    expect(parsed.sections.product?.["product name"]).toBe("Demo App");
    expect(parsed.sections.product?.["one-liner"]).toBe("Plans your week in minutes.");
    expect(parsed.sections.product?.["elevator pitch"]).toBe(
      "Demo is the meal companion that plans ahead."
    );
    expect(parsed.sections.product?.["proof points"]).toBe("Planned in 60 seconds.");
    expect(parsed.sections.product?.["primary cta"]).toBe("Start free");
    expect(parsed.sections.product?.urgency).toBeUndefined();
    expect(parsed.sections.product_bible?.instructions).toContain("real screenshots");
    expect(parsed.sections.product_bible?.label).toBe("Core app");
  });

  it("does not treat numbered example captions as section headers", () => {
    const text = `# Brand Onboarding Pack — Cuisina
## 1. Brand snapshot
- Display name: Cuisina
- Slug: CUISINA
- Description: Your friendly sous-chef for weekly meal planning.

## 3. Brand
- Tone: Warm
- Example captions:
  1. "What's for dinner?" You've answered that question 4,000 times.
  2. Saw a recipe in a cooking video and lost it forever? Not anymore.
  3. Shop once. Cook all week.

## 7. Product (video flows)
- Product name: [FACT] Cuisina
- One-liner: [FACT] Your meals planned, every week.
- Value proposition: [FACT] Turns dinner decisions into discovery.
- Elevator pitch: [FACT-derived] Household meal companion that thinks ahead.
- Primary audience: [FACT] Busy households in Europe.
- Audience pain points: [FACT] Daily dinner decisions; lost recipes.
`;
    const parsed = parseOnboardingPack(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.filter((w) => /unrecognized section/i.test(w))).toEqual([]);
    expect(parsed.sections.voice?.["example captions"]).toContain("Saw a recipe");
    expect(parsed.sections.product?.["one-liner"]).toBe("Your meals planned, every week.");
    expect(parsed.sections.product?.["value proposition"]).toContain("discovery");
    expect(parsed.sections.product?.["elevator pitch"]).toBe(
      "Household meal companion that thinks ahead."
    );
    expect(parsed.sections.product?.["primary audience"]).toContain("Busy households");
    expect(parsed.sections.product?.["audience pain points"]).toContain("Daily dinner");
  });
});

describe("stripFactRecPrefix", () => {
  it("strips FACT, FACT-derived, and FACT annotation tags", () => {
    expect(stripFactRecPrefix("[FACT] Hello")).toBe("Hello");
    expect(stripFactRecPrefix("[FACT-derived] Hello")).toBe("Hello");
    expect(stripFactRecPrefix("[FACT — marketing copy claims] Hello")).toBe("Hello");
    expect(stripFactRecPrefix("[REC] Hello")).toBe("Hello");
    expect(stripFactRecPrefix("[GAP] still here")).toBe("[GAP] still here");
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
