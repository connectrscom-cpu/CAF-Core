import { describe, expect, it } from "vitest";
import {
  buildMimicCarouselSlideArtOnlyPrompt,
  buildMimicCarouselSlidePrompt,
  buildMimicTemplateBackgroundPrompt,
  buildMimicTemplateBgComposePrompt,
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

describe("flux text-on-image prompts", () => {
  it("compose prompt includes LLM copy by default", () => {
    const prompt = buildMimicTemplateBgComposePrompt({ onImageCopy: "Aries loves change" });
    expect(prompt).toContain("Aries loves change");
    expect(prompt).not.toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
  });

  it("full-bleed with bakeText includes copy when artOnly is false", () => {
    const prompt = buildMimicCarouselSlidePrompt({
      slideIndex: 2,
      artOnly: false,
      onImageCopy: "Taurus steady",
      layoutTemplate: "center stack",
    });
    expect(prompt).toContain("Taurus steady");
    expect(prompt).toContain("center stack");
    expect(prompt).toContain("~70%");
    expect(prompt).toContain("variant");
    expect(prompt).toContain("verbatim");
  });

  it("uses configured visual similarity pct in bakeText prompt", () => {
    const prompt = buildMimicCarouselSlidePrompt({
      slideIndex: 1,
      artOnly: false,
      onImageCopy: "Hook",
      visualSimilarityPct: 75,
    });
    expect(prompt).toContain("~75%");
  });
});
