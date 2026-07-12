import { describe, expect, it } from "vitest";
import {
  buildDeterministicNewVisualFluxPrompt,
  buildNewVisualFluxSlideInput,
} from "../services/new-visual-carousel-flux-prompts.js";
import {
  copyMentionsAnimals,
  inferLiteralSubjectCueFromCopyTheme,
  inferSemanticSubjectCueFromCopy,
  NEW_VISUAL_BANNED_VISUAL_PATTERNS,
} from "./new-visual-flux-subject-policy.js";
import type { MimicPayloadV1 } from "./mimic-payload.js";

function minimalMimic(overrides?: Partial<MimicPayloadV1>): MimicPayloadV1 {
  return {
    mode: "carousel_visual",
    execution_mode: "new_visual",
    reference_items: [],
    slide_plans: [{ slide_index: 1, render_mode: "full_bleed", reference_index: 1, source_slide_index: 1 }],
    visual_guideline: {
      deck_concept: "Zodiac compatibility",
      thesis: "Playful astrology pairings",
    },
    ...overrides,
  } as MimicPayloadV1;
}

describe("new-visual-flux-subject-policy", () => {
  it("maps zodiac sign pairs to literal animal subjects", () => {
    const cue = inferLiteralSubjectCueFromCopyTheme({
      copyTheme: "Earth Meets Water: Taurus + Cancer",
      slidePurpose: "content",
    });
    expect(cue).toMatch(/bull/i);
    expect(cue).toMatch(/crab/i);
    expect(cue).toMatch(/not symbols|no zodiac/i);
  });

  it("does not rotate random pets for meal-planning copy", () => {
    const cue = inferSemanticSubjectCueFromCopy({
      copyTheme: "Where Meal Burnout Starts — bored with the same meals",
      slidePurpose: "content",
      slideIndex: 3,
    });
    expect(cue).toMatch(/problem|friction|burnout|repetition/i);
    expect(cue).not.toMatch(/\bpet\b|\bwildlife\b/i);
  });

  it("allows animals only when copy mentions them", () => {
    expect(copyMentionsAnimals("Build your pet-friendly meal plan")).toBe(true);
    expect(copyMentionsAnimals("Prep ingredient bases for the week")).toBe(false);
  });

  it("defers to visual_direction when provided", () => {
    const cue = inferLiteralSubjectCueFromCopyTheme({
      copyTheme: "Ingredient bases",
      visualDirection: "Overhead of labeled prep containers with grains and proteins",
      slidePurpose: "content",
    });
    expect(cue).toMatch(/scene brief/i);
    expect(cue).not.toMatch(/wildlife|pet/i);
  });

  it("uses visual_direction in deterministic new visual prompt", () => {
    const input = buildNewVisualFluxSlideInput(minimalMimic(), 2, 5, {
      parsedSlide: {
        headline: "Where burnout starts",
        body: "Same meals every day.",
        visual_direction: "Three identical meal prep containers in a row — visual sameness, muted tones.",
        must_avoid: "random pets; gourmet hero food",
      },
    });
    const prompt = buildDeterministicNewVisualFluxPrompt(input);
    expect(prompt).toMatch(/Scene brief/i);
    expect(prompt).toMatch(/identical meal prep containers/i);
    expect(prompt).toMatch(/Must avoid/i);
    expect(prompt).toMatch(/FORBIDDEN|Hero-subject-first/i);
    expect(NEW_VISUAL_BANNED_VISUAL_PATTERNS).toMatch(/zodiac wheels/i);
  });

  it("rejects wallpaper patterns in deterministic new visual prompt for zodiac copy", () => {
    const input = buildNewVisualFluxSlideInput(minimalMimic(), 2, 5, {
      parsedSlide: {
        headline: "Water Meets Earth: Scorpio + Virgo",
        body: "Deep loyalty meets attentive care.",
      },
    });
    const prompt = buildDeterministicNewVisualFluxPrompt(input);
    expect(prompt).toMatch(/scorpion|botanical|portrait/i);
    expect(prompt).not.toMatch(/constellation map as the whole/i);
  });
});
