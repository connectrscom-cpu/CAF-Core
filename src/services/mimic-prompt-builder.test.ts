import { describe, expect, it } from "vitest";
import {
  buildMimicCarouselSlideArtOnlyPrompt,
  buildMimicTemplateBackgroundPrompt,
  DEFAULT_MIMIC_CAROUSEL_SLIDE_ART_ONLY_PROMPT,
  DEFAULT_MIMIC_TEMPLATE_BG_PROMPT,
  MIMIC_IMAGE_NO_ON_IMAGE_TEXT_RULE,
} from "./mimic-prompt-builder.js";

describe("buildMimicTemplateBackgroundPrompt", () => {
  it("defaults forbid invented decorative frames", () => {
    expect(DEFAULT_MIMIC_TEMPLATE_BG_PROMPT).toContain("Do NOT add decorative frames");
    expect(DEFAULT_MIMIC_TEMPLATE_BG_PROMPT).not.toContain("layout frame");
    expect(DEFAULT_MIMIC_TEMPLATE_BG_PROMPT).toContain("full-bleed");
  });

  it("art-only carousel prompt forbids any on-image text blocks", () => {
    expect(DEFAULT_MIMIC_CAROUSEL_SLIDE_ART_ONLY_PROMPT).toContain("NEVER render readable text");
    expect(DEFAULT_MIMIC_TEMPLATE_BG_PROMPT).toContain(MIMIC_IMAGE_NO_ON_IMAGE_TEXT_RULE);
    const prompt = buildMimicCarouselSlideArtOnlyPrompt({ slideIndex: 1 });
    expect(prompt).toContain("headlines, subheads, paragraphs");
    expect(prompt).toContain("lorem ipsum");
  });

  it("includes slide vision context when provided", () => {
    const prompt = buildMimicTemplateBackgroundPrompt({
      visualDescription: "sunset hill with centered text overlay",
      layoutTemplate: "text on photo",
    });
    expect(prompt).toContain("sunset hill");
    expect(prompt).toContain("text on photo");
  });
});
