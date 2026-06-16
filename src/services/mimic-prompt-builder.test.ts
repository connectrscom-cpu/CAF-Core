import { describe, expect, it } from "vitest";
import {
  buildMimicCarouselSlideArtOnlyPrompt,
  buildMimicCarouselSlidePrompt,
  buildMimicImageFullPrompt,
  buildMimicTemplateBackgroundPrompt,
  buildMimicTemplateBgComposePrompt,
  DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT,
  finalizeMimicImageModelPrompt,
  isFluxTextBakePromptOverride,
  mimicPromptForMode,
  sanitizeVisualDescriptionForImagePrompt,
} from "./mimic-prompt-builder.js";

describe("buildMimicTemplateBackgroundPrompt", () => {
  it("defaults to visual variant + text-removal art-only prompt", () => {
    const prompt = buildMimicTemplateBackgroundPrompt();
    expect(prompt).toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
    expect(prompt.indexOf("Remove ALL on-image text")).toBeLessThan(prompt.indexOf("~70%"));
    expect(prompt).toContain("~70%");
    expect(prompt).toContain("Remove ALL on-image text");
    expect(buildMimicTemplateBackgroundPrompt()).not.toContain("Keep non-text visuals");
    const fullBleed = buildMimicCarouselSlideArtOnlyPrompt({ slideIndex: 1 });
    expect(fullBleed).toContain("~70%");
    expect(fullBleed).toContain("centered in the frame");
    expect(fullBleed).not.toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
  });

  it("uses configured visual similarity in art-only default prompt", () => {
    const prompt = buildMimicCarouselSlideArtOnlyPrompt({ slideIndex: 1, visualSimilarityPct: 20 });
    expect(prompt).toContain("~20%");
    expect(prompt).toContain("Make a new slide like this");
    expect(prompt).not.toContain("centered in the frame");
  });

  it("uses bold variant prompt at 10% with sanitized visual inspiration", () => {
    const prompt = buildMimicCarouselSlideArtOnlyPrompt({
      slideIndex: 1,
      visualSimilarityPct: 10,
      layoutTemplate: "center stack",
      visualDescription:
        "Black woolen cat figurine with googly eyes. Body text: 'how you should text your aries friend'",
      safeZoneInstruction: "Leave the lower 45% clean",
      intentInstruction: "The reference slide has dense on-image text",
      includeStyleHints: true,
    });
    expect(prompt).toContain("~10%");
    expect(prompt).toContain("Make a new slide like this");
    expect(prompt).toContain("Remove ALL on-image text");
    expect(prompt).toContain("ZERO readable text");
    expect(prompt).not.toContain("centered in the frame");
    expect(prompt).toContain("Black woolen cat figurine");
    expect(prompt).not.toContain("how you should text");
    expect(prompt).not.toContain("Body text");
    expect(prompt).toContain("dense on-image text");
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
    const prompt = mimicPromptForMode(
      "template_bg",
      { layout: "text on photo", visual: "sunset hill" },
      { template_bg: "Strip text. {{visual_instruction}}" },
      { includeStyleHints: true }
    );
    expect(prompt).toContain("sunset hill");
    expect(prompt).toContain("text on photo");
    expect(prompt).toContain("ZERO readable text");
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
    expect(prompt).toContain("centered in the frame");
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

  it("omits center-lock in bakeText prompt at 10% similarity", () => {
    const prompt = buildMimicCarouselSlidePrompt({
      slideIndex: 1,
      artOnly: false,
      onImageCopy: "Hook",
      visualSimilarityPct: 10,
    });
    expect(prompt).toContain("~10%");
    expect(prompt).toContain("Make a new slide like this");
    expect(prompt).toContain("HTML/CSS overlay");
    expect(prompt).not.toContain("centered in the frame");
  });

  it("image_full prompt never injects LLM copy into the image model", () => {
    const prompt = buildMimicImageFullPrompt(
      { onImageCopy: "Aries loves change\nMore body copy" },
      { image_full: "Variant. {{copy_instruction}}" }
    );
    expect(prompt).toContain("Remove ALL on-image text");
    expect(prompt).not.toContain("Aries loves change");
  });

  it("sanitizeVisualDescriptionForImagePrompt strips reference copy leaks", () => {
    const clean = sanitizeVisualDescriptionForImagePrompt(
      "Black cat plush. Body text: 'how you should text your aries friend'"
    );
    expect(clean).toContain("Black cat plush");
    expect(clean).not.toContain("how you should");
    expect(clean).not.toContain("Body text");
  });

  it("ignores Prompt Labs overrides that bake copy onto Flux", () => {
    const baked = buildMimicTemplateBackgroundPrompt(
      { visualSimilarityPct: 70 },
      { template_bg: "Replace all on-image text with this new copy: {{copy_instruction}}" }
    );
    expect(baked).toBe(DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT);
    expect(isFluxTextBakePromptOverride("Replace all on-image text with this new copy")).toBe(true);
  });

  it("finalizeMimicImageModelPrompt appends hard art-only guard", () => {
    const out = finalizeMimicImageModelPrompt("Make a new slide.");
    expect(out).toContain("ZERO readable text");
    expect(finalizeMimicImageModelPrompt(out)).toBe(out);
    expect(finalizeMimicImageModelPrompt("Render headline: hello", { allowOnImageText: true })).toBe(
      "Render headline: hello"
    );
  });
});
