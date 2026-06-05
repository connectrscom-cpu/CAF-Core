import { describe, expect, it } from "vitest";
import {
  buildMimicCarouselSlideArtOnlyPrompt,
  buildMimicTemplateBackgroundPrompt,
  DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT,
} from "./mimic-prompt-builder.js";

describe("buildMimicTemplateBackgroundPrompt", () => {
  it("defaults to minimal text-removal only", () => {
    expect(buildMimicTemplateBackgroundPrompt()).toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
    expect(buildMimicCarouselSlideArtOnlyPrompt({ slideIndex: 1 })).toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
  });

  it("ignores vision hints unless Prompt Labs override is set", () => {
    const prompt = buildMimicTemplateBackgroundPrompt({
      visualDescription: "sunset hill with centered text overlay",
      layoutTemplate: "text on photo",
    });
    expect(prompt).toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
    expect(prompt).not.toContain("sunset hill");
  });

  it("interpolates hints when a custom override template is provided", () => {
    const prompt = buildMimicTemplateBackgroundPrompt(
      { visualDescription: "sunset hill", layoutTemplate: "text on photo" },
      { template_bg: "Strip text. {{visual_instruction}}" }
    );
    expect(prompt).toContain("sunset hill");
    expect(prompt).toContain("text on photo");
  });
});
