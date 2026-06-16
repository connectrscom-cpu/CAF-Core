import { describe, expect, it } from "vitest";
import { templateBgLlmSlideForDocAi } from "./mimic-template-bg-render.js";
import {
  bboxIntersectsFullBleedSubjectZone,
  buildMimicDocAiRenderTextLayers,
  nudgeBBoxAwayFromFullBleedSubjectZone,
  CAROUSEL_RENDER_WIDTH_PX,
  consolidateDocAiRenderLayersInVerticalStacks,
  docAiBBoxToRenderPx,
  docAiBlocksShareVerticalStack,
  estimateDocAiFitFontSizePx,
  MIMIC_DOCAI_MIN_FONT_SIZE_PX,
  MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX,
  clampDocAiTextBackFontSizePx,
  assignBodyLinesToSpatialStacks,
  expandLlmLinesForDocAiMapping,
  normalizeBodyLinesForStackCount,
  inferMimicCarouselTheme,
  isDarkCelestialDeck,
  isDarkVisualDeck,
  mimicPayloadHasDocAiTextLayout,
  mimicDocAiLayersCoverLlmCopy,
  mimicSlideTextBlocksLookUnreliable,
  mimicSlideLayoutPatch,
  mimicSlideThemePatch,
  mimicSlideTypographyPatch,
  orderDocAiBlocksForLlmCopyMapping,
  parseRelativeScaleHeadlinePx,
  splitHeadlineForChatMockTitlePair,
  formatMimicTextBackingBackground,
  mimicTextBackingColorToHex,
  MIMIC_DEFAULT_TEXT_BACKING_BACKGROUND,
} from "./mimic-slide-typography.js";

describe("mimic-slide-typography", () => {
  it("detects dark celestial decks from deck_visual_system", () => {
    expect(
      isDarkCelestialDeck({
        deck_visual_system: {
          overall_aesthetic: "dark, celestial, reflective",
          repeated_template: "centered text over celestial backgrounds",
        },
      })
    ).toBe(true);
  });

  it("maps relative_scale tiers to headline px", () => {
    expect(parseRelativeScaleHeadlinePx("headline lg vs slide")).toBe(80);
    expect(parseRelativeScaleHeadlinePx("12% of slide height")).toBe(120);
  });

  it("centers text when deck says centered text over backgrounds", () => {
    const layout = mimicSlideLayoutPatch(
      {
        deck_visual_system: {
          repeated_template: "centered text over celestial backgrounds; similar layout across slides",
        },
      },
      2
    );
    expect(layout.mimic_text_align).toBe("center");
    expect(layout.mimic_page_justify).toBe("center");
  });

  it("uses Nemotron text_blocks font_size_px when present", () => {
    const patch = mimicSlideTypographyPatch(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              typography: { relative_scale: "md" },
              text_blocks: [
                {
                  text: "ARIES",
                  role: "title",
                  bbox_norm: { x: 0.2, y: 0.35, w: 0.6, h: 0.12 },
                  font_size_px: 92,
                },
                {
                  text: "Born to roam",
                  role: "subtitle",
                  bbox_norm: { x: 0.15, y: 0.5, w: 0.7, h: 0.08 },
                  font_size_px: 44,
                },
              ],
            },
          ],
        },
      },
      1,
      2
    );
    expect(patch.carousel_headline_font_px).toBe(92);
    expect(patch.carousel_body_font_px).toBe(44);
  });

  it("derives typography patch from per-slide vision analysis", () => {
    const patch = mimicSlideTypographyPatch(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              typography: {
                relative_scale: "lg",
                text_placement: "center band",
              },
            },
          ],
          deck_visual_system: { overall_aesthetic: "dark, celestial" },
        },
      },
      1,
      3
    );
    expect(patch.carousel_headline_font_px).toBe(80);
    expect(patch.carousel_body_font_px).toBeGreaterThan(30);
    expect(patch.mimic_text_align).toBe("center");
  });

  it("detects dark silhouette decks from deck_visual_system", () => {
    expect(
      isDarkVisualDeck({
        deck_visual_system: {
          overall_aesthetic: "monochromatic silhouette, romantic",
          repeated_template: "centered text over photo backgrounds",
        },
      })
    ).toBe(true);
  });

  it("defaults to light text when vision is ambiguous (template_bg photo plates)", () => {
    const theme = inferMimicCarouselTheme({});
    expect(theme.ink).toBe("#f5f5f7");
    expect(theme.body).toBe("#e8e8ed");
  });

  it("forces light text when vision reports dark bg and dark text", () => {
    const theme = inferMimicCarouselTheme({
      slides: [
        {
          slide_index: 1,
          color_tokens: { background: "#111111", primary_text: "#222222" },
        },
      ],
    });
    expect(theme.ink).toBe("#f5f5f7");
  });

  it("exposes theme patch for renderer CSS injection", () => {
    const patch = mimicSlideThemePatch({
      visual_guideline: { deck_visual_system: { overall_aesthetic: "dark moody" } },
    });
    expect(patch.carousel_ink).toBe("#f5f5f7");
    expect(patch.carousel_text_shadow_headline).toContain("rgba(0,0,0");
  });

  it("detects Document AI layout on reference slides", () => {
    expect(
      mimicPayloadHasDocAiTextLayout({
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [{ text: "Hi", role: "title", source: "document_ai", bbox_norm: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 } }],
            },
          ],
        },
      })
    ).toBe(true);
    expect(
      mimicPayloadHasDocAiTextLayout({
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                { text: "THE TAURUS MOTHER", role: "headline", bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.08 } },
              ],
            },
          ],
        },
      })
    ).toBe(true);
    expect(mimicPayloadHasDocAiTextLayout({ visual_guideline: { slides: [{ slide_index: 1 }] } })).toBe(false);
  });

  it("orderDocAiBlocksForLlmCopyMapping reads columns top-to-bottom before next column", () => {
    const blocks = [
      {
        text: "Taurus",
        role: "headline",
        x: 0.35,
        y: 0.05,
        w: 0.3,
        h: 0.08,
        ref_text: "Taurus",
      },
      {
        text: "slumber parties",
        role: "body",
        x: 0.08,
        y: 0.15,
        w: 0.25,
        h: 0.04,
        ref_text: "slumber parties",
      },
      {
        text: "stocked up",
        role: "body",
        x: 0.67,
        y: 0.15,
        w: 0.25,
        h: 0.04,
        ref_text: "stocked up",
      },
      {
        text: "with their pet",
        role: "body",
        x: 0.08,
        y: 0.2,
        w: 0.25,
        h: 0.04,
        ref_text: "with their pet",
      },
      {
        text: "on their favorite",
        role: "body",
        x: 0.67,
        y: 0.2,
        w: 0.25,
        h: 0.04,
        ref_text: "on their favorite",
      },
    ] as Parameters<typeof orderDocAiBlocksForLlmCopyMapping>[0];

    const ordered = orderDocAiBlocksForLlmCopyMapping(blocks);
    expect(ordered.map((b) => b.ref_text)).toEqual([
      "Taurus",
      "slumber parties",
      "with their pet",
      "stocked up",
      "on their favorite",
    ]);
  });

  it("assignBodyLinesToSpatialStacks maps one line per OCR row when counts match", () => {
    const stacks = [
      [{ ref_text: "a", role: "body", x: 0.7, y: 0.2, w: 0.2, h: 0.04 }],
      [{ ref_text: "b", role: "body", x: 0.1, y: 0.3, w: 0.2, h: 0.04 }],
      [
        { ref_text: "c", role: "body", x: 0.7, y: 0.4, w: 0.2, h: 0.04 },
        { ref_text: "d", role: "body", x: 0.7, y: 0.46, w: 0.2, h: 0.04 },
        { ref_text: "e", role: "body", x: 0.7, y: 0.52, w: 0.2, h: 0.04 },
      ],
    ] as Parameters<typeof assignBodyLinesToSpatialStacks>[0];
    const { stackTexts } = assignBodyLinesToSpatialStacks(
      stacks,
      ["L1", "L2", "L3", "L4"],
      { headlineRemainder: "hook line", remainderStackIndex: 1 }
    );
    expect(stackTexts[0]).toBe("L1");
    expect(stackTexts[1]).toBe("hook line");
    expect(stackTexts[2]).toBe("L2\nL3\nL4");
  });

  it("buildMimicDocAiRenderTextLayers prefers copy slots over OCR stack fragmentation", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                { text: "Aries", role: "headline", bbox_norm: { x: 0.35, y: 0.05, w: 0.3, h: 0.06 } },
                { text: "mad about", role: "body", bbox_norm: { x: 0.7, y: 0.21, w: 0.22, h: 0.04 } },
                { text: "the canceled", role: "body", bbox_norm: { x: 0.7, y: 0.26, w: 0.22, h: 0.04 } },
                { text: "birthday trip", role: "body", bbox_norm: { x: 0.7, y: 0.31, w: 0.22, h: 0.04 } },
                { text: "starts to flirt", role: "body", bbox_norm: { x: 0.06, y: 0.33, w: 0.25, h: 0.04 } },
                { text: "out of boredom", role: "body", bbox_norm: { x: 0.06, y: 0.38, w: 0.25, h: 0.04 } },
              ],
            },
          ],
        },
      },
      1,
      {
        headline: "Aries gets playful when bored",
        body: "Already upset\nabout the trip\nbeing canceled",
      }
    );
    expect(layers.find((l) => l.text.includes("Already upset"))).toBeTruthy();
    expect(layers.find((l) => l.text === "Aries" && l.y_px < 200)).toBeTruthy();
    expect(
      layers.find((l) => l.text.includes("playful when bored") || l.text.includes("Aries gets"))
    ).toBeTruthy();
    expect(layers.length).toBeLessThan(8);
  });

  it("buildMimicDocAiRenderTextLayers assigns body lines per vertical stack not interleaved rows", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 2,
            text_blocks: [
              {
                text: "Taurus",
                role: "headline",
                source: "document_ai",
                bbox_norm: { x: 0.35, y: 0.05, w: 0.3, h: 0.08 },
              },
              {
                text: "slumber parties",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.08, y: 0.15, w: 0.25, h: 0.04 },
              },
              {
                text: "stocked up",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.67, y: 0.15, w: 0.25, h: 0.04 },
              },
              {
                text: "with their pet",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.08, y: 0.2, w: 0.25, h: 0.04 },
              },
              {
                text: "on their favorite",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.67, y: 0.2, w: 0.25, h: 0.04 },
              },
            ],
          },
        ],
      },
    };

    const layers = buildMimicDocAiRenderTextLayers(
      mimic,
      2,
      { headline: "Taurus", body: "Left column copy\nRight column copy" },
      { ink: "#000000", body: "#111111" }
    );

    const leftStacks = layers.filter((l) => l.x_px < 200 && l.text !== "Taurus");
    const rightStacks = layers.filter((l) => l.x_px > 600);
    expect(leftStacks).toHaveLength(1);
    expect(rightStacks).toHaveLength(1);
    expect(leftStacks[0]?.text).toContain("Left column copy");
    expect(rightStacks[0]?.text).toContain("Right column copy");
  });

  it("docAiBBoxToRenderPx clamps boxes inside canvas safe margins", () => {
    const px = docAiBBoxToRenderPx(0.92, 0.02, 0.12, 0.05);
    expect(px.x + px.w).toBeLessThanOrEqual(CAROUSEL_RENDER_WIDTH_PX - 28);
    expect(px.x).toBeGreaterThanOrEqual(28);
  });

  it("estimateDocAiFitFontSizePx respects 60px minimum floor", () => {
    const tiny = estimateDocAiFitFontSizePx({
      text: "x",
      refText: "short",
      refFontPx: 8,
      boxWPx: 40,
      boxHPx: 20,
      singleLine: true,
    });
    expect(tiny).toBeGreaterThanOrEqual(MIMIC_DOCAI_MIN_FONT_SIZE_PX);
  });

  it("keeps decor title OCR and maps LLM meme headline to matching phrase box", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 1,
            text_blocks: [
              {
                text: "Libra",
                role: "headline",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.04, w: 0.22, h: 0.07 },
              },
              {
                text: "most likely",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.24, w: 0.2, h: 0.04 },
              },
              {
                text: "to look like a different person",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.3, w: 0.8, h: 0.05 },
              },
            ],
          },
        ],
      },
    };

    const layers = buildMimicDocAiRenderTextLayers(
      mimic,
      1,
      {
        headline: "Most likely",
        body: "to seem new\npost-quarantine",
      },
      { ink: "#fff", body: "#fff" }
    );

    const byText = new Map(layers.map((l) => [l.text, l]));
    expect(byText.get("Libra")?.y_px).toBeLessThan(100);
    expect(byText.get("Most likely")).toBeDefined();
    expect(layers.filter((l) => l.text === "Most likely")).toHaveLength(1);
  });

  it("expandLlmLinesForDocAiMapping splits body on single newlines", () => {
    expect(expandLlmLinesForDocAiMapping({ body: "a\nb\nc" }).bodyLines).toEqual(["a", "b", "c"]);
  });

  it("normalizeBodyLinesForStackCount splits run-on body into corner phrases", () => {
    const runOn =
      "Already upset about the trip being canceled 5th photoshoot of the day completed Making up for extended birthday with three cakes";
    expect(normalizeBodyLinesForStackCount([runOn], 3)).toEqual([
      "Already upset about the trip being canceled",
      "5th photoshoot of the day completed",
      "Making up for extended birthday with three cakes",
    ]);
  });

  it("nudgeBBoxAwayFromFullBleedSubjectZone moves center trait boxes to corners", () => {
    const center = { x: 0.35, y: 0.4, w: 0.3, h: 0.12 };
    expect(bboxIntersectsFullBleedSubjectZone(center)).toBe(true);
    const nudged = nudgeBBoxAwayFromFullBleedSubjectZone(center);
    expect(bboxIntersectsFullBleedSubjectZone(nudged)).toBe(false);
  });

  it("normalizeBodyLinesForStackCount merges extra lines into semantic phrases", () => {
    expect(normalizeBodyLinesForStackCount(["a", "b", "c", "d"], 2)).toEqual(["a b", "c d"]);
  });

  it("assignBodyLinesToSpatialStacks keeps Leo sunny-season phrase on one stack", () => {
    const stacks = [
      [{ ref_text: "a", role: "body", x: 0.7, y: 0.2, w: 0.2, h: 0.04 }],
      [{ ref_text: "b", role: "body", x: 0.1, y: 0.3, w: 0.2, h: 0.04 }],
      [{ ref_text: "c", role: "body", x: 0.7, y: 0.5, w: 0.2, h: 0.04 }],
      [{ ref_text: "d", role: "body", x: 0.1, y: 0.6, w: 0.2, h: 0.04 }],
    ] as Parameters<typeof assignBodyLinesToSpatialStacks>[0];
    const { stackTexts } = assignBodyLinesToSpatialStacks(
      stacks,
      [
        "Delivers speeches",
        "to their reflection",
        "Cleans space,",
        "clears clutter",
        "Ignores Instagram challenges",
        "Aims to shape up",
        "for the sunny season",
      ],
      { headlineRemainder: "mirror monologue", remainderStackIndex: 1 }
    );
    const bodyTexts = stackTexts.filter((_, i) => i !== 1);
    expect(bodyTexts.some((t) => t.includes("Aims to shape up for the sunny season"))).toBe(true);
    expect(stackTexts[1]).toBe("mirror monologue");
  });

  it("expandLlmLinesForDocAiMapping ignores truncated text_blocks when body is richer", () => {
    const lines = expandLlmLinesForDocAiMapping({
      headline: "Aries gets playful when bored",
      body: "Trait one\nTrait two\nTrait three\nTrait four",
      text_blocks: [
        { role: "headline", text: "Aries gets play…" },
        { role: "body", text: "Trait on…" },
      ],
    });
    expect(lines.headline).toBe("Aries gets playful when bored");
    expect(lines.bodyLines).toEqual(["Trait one", "Trait two", "Trait three", "Trait four"]);
  });

  it("expandLlmLinesForDocAiMapping strips reference handle from body when layout has handle block", () => {
    const lines = expandLlmLinesForDocAiMapping(
      {
        headline: "THE ARIES MOTHER",
        body: "@sistersvillage\nFull of life and passion, she\nbrings energy into every moment",
      },
      {
        referenceHandles: ["@sistersvillage"],
        projectHandle: "@mybrand",
        layoutHasHandleBlock: true,
      }
    );
    expect(lines.headline).toBe("THE ARIES MOTHER");
    expect(lines.bodyLines).toEqual([
      "Full of life and passion, she",
      "brings energy into every moment",
    ]);
  });

  it("expandLlmLinesForDocAiMapping prefers per-OCR text_blocks over concatenated body", () => {
    expect(
      mimicSlideTextBlocksLookUnreliable({
        body: "line one\nline two\nline three\nline four\nline five\nline six",
        text_blocks: [
          { role: "headline", text: "how it feels to be a gemini" },
          { role: "body", text: "maybe in another universe" },
          { role: "body", text: "im fine." },
          { role: "handle", text: "@astro_moods" },
        ],
      })
    ).toBe(false);
    const lines = expandLlmLinesForDocAiMapping({
      body: "line one\nline two\nline three\nline four\nline five\nline six",
      text_blocks: [
        { role: "headline", text: "how it feels to be a gemini" },
        { role: "body", text: "maybe in another universe" },
        { role: "body", text: "im fine." },
        { role: "handle", text: "@astro_moods" },
      ],
    });
    expect(lines.bodyLines).toEqual(["maybe in another universe", "im fine."]);
    expect(lines.headline).toBe("how it feels to be a gemini");
  });

  it("buildMimicDocAiRenderTextLayers maps one OCR box per text_blocks entry", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 2,
            text_blocks: [
              {
                text: "how it feels to be a taurus (without context)",
                role: "headline",
                source: "document_ai",
                bbox_norm: { x: 0.15, y: 0.42, w: 0.7, h: 0.12 },
              },
              {
                text: "I can't really cry",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.05, y: 0.72, w: 0.4, h: 0.06 },
              },
              {
                text: "I'm keeping a list",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.55, y: 0.72, w: 0.4, h: 0.06 },
              },
              {
                text: "@glossy_zodiac",
                role: "handle",
                source: "document_ai",
                bbox_norm: { x: 0.4, y: 0.48, w: 0.2, h: 0.04 },
              },
            ],
          },
        ],
      },
      reference_items: [],
      slide_plans: [],
    };
    const llmSlide = {
      body: "ignored merged body\nwith extra lines",
      text_blocks: [
        { role: "headline", text: "how it feels to be a taurus (without context)" },
        { role: "body", text: "I can't shed tears" },
        { role: "body", text: "I remember every slight" },
        { role: "handle", text: "@glossy_zodiac" },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(mimic, 2, llmSlide, undefined, {
      projectHandle: "@astro_moods",
      textBacking: true,
    });
    const texts = layers.map((l) => l.text);
    expect(texts).toContain("how it feels to be a taurus (without context)");
    expect(texts).toContain("I can't shed tears");
    expect(texts).toContain("I remember every slight");
    expect(texts.some((t) => t.includes("@astro_moods"))).toBe(true);
    expect(texts.every((t) => !t.includes("@glossy_zodiac"))).toBe(true);
    expect(texts.some((t) => t.includes("ignored merged body"))).toBe(false);
  });

  it("buildMimicDocAiRenderTextLayers maps text_blocks by index when fewer OCR boxes than copy lines", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 4,
            text_blocks: [
              {
                text: "your Cancer friend's message style",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.1 },
              },
              {
                text: "Caring and full of sentiment",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.72, w: 0.8, h: 0.12 },
              },
            ],
          },
        ],
      },
      reference_items: [],
      slide_plans: [],
    };
    const llmSlide = {
      headline: "Slide headline",
      text_blocks: [
        { role: "body", text: "your Cancer friend's message style" },
        { role: "body", text: "Caring and full of sentiment" },
        { role: "body", text: "When we leave impressions like paw prints" },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(mimic, 4, llmSlide);
    const texts = layers.map((l) => l.text);
    expect(texts).toContain("your Cancer friend's message style");
    expect(texts).toContain("Caring and full of sentiment");
    expect(texts).toContain("When we leave impressions like paw prints");
    expect(texts.filter((t) => t === "your Cancer friend's message style")).toHaveLength(1);
    expect(texts.some((t) => t.includes("Slide headline"))).toBe(false);
  });

  it("buildMimicDocAiRenderTextLayers reuses body-template OCR when output slide maps to source_slide_index 2", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 2,
            text_blocks: [
              {
                text: "Capricorn",
                role: "headline",
                source: "document_ai",
                bbox_norm: { x: 0.35, y: 0.06, w: 0.3, h: 0.07 },
              },
              {
                text: "Capricorn envisions room renovation.",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.28, w: 0.8, h: 0.1 },
              },
              {
                text: "Shares daily exploits via Snapchat.",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.1 },
              },
              {
                text: "@signandsound",
                role: "handle",
                source: "document_ai",
                bbox_norm: { x: 0.35, y: 0.9, w: 0.3, h: 0.04 },
              },
            ],
          },
          { slide_index: 4, on_screen_text_transcript: "Capricorn body slide" },
        ],
      },
      reference_items: [
        { index: 4, role: "carousel_slide", vision_fetch_url: "https://x/4.jpg", source_slide_index: 4 },
      ],
      slide_plans: [{ slide_index: 4, render_mode: "full_bleed", reference_index: 2, source_slide_index: 2 }],
    };
    const llmSlide = {
      text_blocks: [
        { role: "headline", text: "Dream Big" },
        { role: "body", text: "Capricorn envisions room renovation. Occupies time with games." },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(mimic, 4, llmSlide, undefined, {
      projectHandle: "@signandsound",
      textBacking: true,
    });
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.map((l) => l.text)).toContain("Capricorn");
    expect(layers.map((l) => l.text)).toContain("Dream Big");
  });

  it("buildMimicDocAiRenderTextLayers joins multiline body into single body bbox", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 2,
              text_blocks: [
                {
                  text: "THE ARIES MOTHER",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.08 },
                },
                {
                  text: "@sistersvillage",
                  role: "handle",
                  source: "document_ai",
                  bbox_norm: { x: 0.35, y: 0.18, w: 0.3, h: 0.04 },
                },
                {
                  text: "Deeply rooted in family",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
                },
              ],
            },
          ],
        },
      },
      2,
      {
        headline: "THE ARIES MOTHER",
        body: "@sistersvillage\nFull of life and passion, she\nbrings energy into every moment",
      },
      undefined,
      { projectHandle: "@mybrand" }
    );
    const byRole = new Map(layers.map((l) => [l.role, l.text]));
    expect(byRole.get("headline")).toBe("THE ARIES MOTHER");
    expect(byRole.get("handle")).toBe("@mybrand");
    expect(byRole.get("body")).toContain("Full of life and passion, she");
    expect(byRole.get("body")).toContain("brings energy into every moment");
  });

  it("buildMimicDocAiRenderTextLayers maps text_blocks on listicle decor+handle+body OCR", () => {
    const ocrSlide = {
      slide_index: 2,
      text_blocks: [
        {
          text: "THE ARIES MOTHER",
          role: "headline",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.08 },
        },
        {
          text: "@sistersvillage",
          role: "handle",
          source: "document_ai",
          bbox_norm: { x: 0.35, y: 0.18, w: 0.3, h: 0.04 },
        },
        {
          text: "Deeply rooted in family",
          role: "body",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
        },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(
      { visual_guideline: { slides: [ocrSlide] } },
      2,
      {
        text_blocks: [
          { role: "headline", text: "THE ARIES MOTHER" },
          {
            role: "body",
            text: "Full of life and passion, she brings energy into every moment",
          },
        ],
      },
      undefined,
      { projectHandle: "@signandsound", textBacking: true }
    );
    const texts = layers.map((l) => l.text);
    expect(texts).toContain("THE ARIES MOTHER");
    expect(texts).toContain("@signandsound");
    expect(texts.some((t) => t.includes("Full of life and passion"))).toBe(true);
    expect(layers.find((l) => l.text === "@signandsound")?.role).toBe("handle");
    expect(layers.find((l) => l.text.includes("Full of life"))?.role).toBe("body");
  });

  it("buildMimicDocAiRenderTextLayers uses LLM listicle decor title on shared Virgo OCR geometry", () => {
    const ocrSlide = {
      slide_index: 7,
      text_blocks: [
        {
          text: "THE VIRGO MOTHER",
          role: "headline",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.08 },
        },
        {
          text: "@sistersvillage",
          role: "handle",
          source: "document_ai",
          bbox_norm: { x: 0.35, y: 0.18, w: 0.3, h: 0.04 },
        },
        {
          text: "She values genuine relationships",
          role: "body",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
        },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(
      { visual_guideline: { slides: [ocrSlide] } },
      7,
      {
        headline: "THE LIBRA MOTHER",
        body: "She values genuine relationships, standing as both a devoted mother and a true friend.",
        text_blocks: [
          { role: "headline", text: "THE LIBRA MOTHER" },
          {
            role: "body",
            text: "She values genuine relationships, standing as both a devoted mother and a true friend.",
          },
        ],
      },
      undefined,
      { projectHandle: "@signandsound", textBacking: true }
    );
    const texts = layers.map((l) => l.text);
    expect(texts).toContain("THE LIBRA MOTHER");
    expect(texts).not.toContain("THE VIRGO MOTHER");
    expect(texts).toContain("@signandsound");
    expect(texts.some((t) => t.includes("genuine relationships"))).toBe(true);
    expect(layers.find((l) => l.text === "@signandsound")?.role).toBe("handle");
    expect(layers.find((l) => l.text.includes("genuine relationships"))?.role).toBe("body");
  });

  it("buildMimicDocAiRenderTextLayers maps inverted llm_field copy onto listicle decor+body OCR", () => {
    const ocrSlide = {
      slide_index: 2,
      text_blocks: [
        {
          text: "THE ARIES MOTHER",
          role: "headline",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.08 },
        },
        {
          text: "@sistersvillage",
          role: "handle",
          source: "document_ai",
          bbox_norm: { x: 0.35, y: 0.18, w: 0.3, h: 0.04 },
        },
        {
          text: "Deeply rooted in family",
          role: "body",
          source: "document_ai",
          bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
        },
      ],
    };
    const paragraph =
      "The Aries Mom is a spirited explorer, always ready for adventure. She wants her kids to cherish their childhood memories full of love and joy.";
    const scoped = templateBgLlmSlideForDocAi(2, 12, {
      headline: paragraph,
      body: "@sistersvillage",
      text_blocks: [
        { llm_field: "body", text: paragraph },
        { llm_field: "handle", text: "@sistersvillage" },
      ],
    });
    const layers = buildMimicDocAiRenderTextLayers(
      { visual_guideline: { slides: [ocrSlide] } },
      2,
      scoped,
      undefined,
      { projectHandle: "@signandsound", textBacking: true, totalSlides: 12 }
    );
    const byRole = new Map(layers.map((l) => [l.role, l.text]));
    expect(byRole.get("headline")).toBe("THE ARIES MOTHER");
    expect(byRole.get("body")).toBe(paragraph);
    expect(byRole.get("handle")).toBe("@signandsound");
  });

  it("docAiBlocksShareVerticalStack detects same column", () => {
    expect(
      docAiBlocksShareVerticalStack(
        { x: 0.08, w: 0.25 },
        { x: 0.09, w: 0.24 }
      )
    ).toBe(true);
    expect(
      docAiBlocksShareVerticalStack(
        { x: 0.08, w: 0.25 },
        { x: 0.67, w: 0.25 }
      )
    ).toBe(false);
  });

  it("buildMimicDocAiRenderTextLayers maps LLM copy onto Document AI geometry with px coords", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "OLD TITLE",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.12, y: 0.18, w: 0.76, h: 0.14 },
                  font_size_px: 88,
                  color_hex: "#ffffff",
                  font_weight: "700",
                  font_family: "SANS_SERIF",
                },
                {
                  text: "old body line",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
                  font_size_px: 40,
                  color_hex: "#eeeeee",
                },
              ],
            },
          ],
        },
      },
      1,
      { headline: "Fresh headline", body: "Fresh body copy" },
      { ink: "#ffffff", body: "#e8e8ed" }
    );
    expect(layers).toHaveLength(2);
    expect(layers[0]?.text).toBe("Fresh headline");
    expect(layers[0]?.x_px).toBe(134);
    expect(layers[0]?.y_px).toBe(247);
    expect(layers[0]?.w_px).toBe(813);
    expect(layers[0]?.h_px).toBe(181);
    expect(layers[0]?.layout_mode).toBe("single_line");
    expect(layers[0]?.css_style).toContain("left:134px");
    expect(layers[0]?.css_style).toContain("height:181px");
    expect(layers[0]?.css_style).toContain("font-size:");
    expect(layers[0]?.color_hex).toBe("#000000");
    expect(layers[0]?.css_style).toContain("color:#000000");
    expect(layers[1]?.text).toBe("Fresh body copy");
    expect(layers[1]?.y_px).toBe(747);
    expect(layers[1]?.layout_mode).toBe("single_line");
  });

  it("estimateDocAiFitFontSizePx never returns below MIMIC_DOCAI_MIN_FONT_SIZE_PX", () => {
    expect(
      estimateDocAiFitFontSizePx({
        text: "tiny ocr box",
        refText: "tiny",
        refFontPx: 6,
        boxWPx: 40,
        boxHPx: 12,
        singleLine: false,
      })
    ).toBeGreaterThanOrEqual(14);
  });

  it("estimateDocAiFitFontSizePx scales up toward bbox height (OCR often under-reports)", () => {
    expect(
      estimateDocAiFitFontSizePx({
        text: "gemini with a crush",
        refText: "gemini with a crush",
        refFontPx: 73,
        boxWPx: 762,
        boxHPx: 82,
        singleLine: true,
        fontScale: 1.15,
      })
    ).toBe(79);
    expect(
      estimateDocAiFitFontSizePx({
        text: "astrhology",
        refText: "astrhology",
        refFontPx: 15,
        boxWPx: 85,
        boxHPx: 17,
        singleLine: true,
        fontScale: 1.15,
      })
    ).toBe(MIMIC_DOCAI_MIN_FONT_SIZE_PX);
    expect(
      estimateDocAiFitFontSizePx({
        text: "1",
        refText: "1",
        refFontPx: 30,
        boxWPx: 34,
        boxHPx: 35,
        singleLine: true,
        fontScale: 1.15,
      })
    ).toBeGreaterThanOrEqual(MIMIC_DOCAI_MIN_FONT_SIZE_PX);
  });

  it("estimateDocAiFitFontSizePx with text backing targets reference body size in wide slots", () => {
    expect(
      estimateDocAiFitFontSizePx({
        text: "Got Disney+ and sharing it, of course",
        refText: "stocked up",
        refFontPx: 53,
        boxWPx: 900,
        boxHPx: 55,
        singleLine: true,
        textBacking: true,
      })
    ).toBeGreaterThanOrEqual(MIMIC_DOCAI_MIN_FONT_SIZE_PX);
  });

  it("clampDocAiTextBackFontSizePx enforces readable text-back floor", () => {
    expect(clampDocAiTextBackFontSizePx(12)).toBe(MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX);
    expect(clampDocAiTextBackFontSizePx(44)).toBe(44);
  });

  it("prefers document_ai_ocr_v1 text_layers geometry over text_blocks", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "OLD",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
                },
              ],
              document_ai_ocr_v1: {
                text_layers: [
                  {
                    text: "OLD",
                    bbox_pct: { x: 0.1, y: 0.2, w: 0.8, h: 0.12 },
                    font: { size_px: 72, color_hex: "#ff0000" },
                    alignment: "center",
                  },
                ],
              },
            },
          ],
        },
      },
      1,
      { headline: "New headline" }
    );
    expect(layers[0]?.x_px).toBeGreaterThanOrEqual(108);
    expect(layers[0]?.text_align).toBe("center");
    expect(layers[0]?.color_hex).toBe("#000000");
  });

  it("substitutes project handle on reference handle blocks", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "@oldcreator",
                  role: "handle",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.9, w: 0.4, h: 0.05 },
                  font_size_px: 47,
                },
              ],
            },
          ],
        },
      },
      1,
      { body: "@wrong" },
      undefined,
      { projectHandle: "mybrand" }
    );
    expect(layers[0]?.text).toBe("@mybrand");
    expect(layers[0]?.font_size_px).toBe(25);
  });

  it("matches OCR text_layers to text_blocks by text not array index", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "your cancer friend",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.2, w: 0.35, h: 0.05 },
                },
                {
                  text: "how you should text",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.14, y: 0.07, w: 0.72, h: 0.07 },
                },
              ],
              document_ai_ocr_v1: {
                text_layers: [
                  {
                    text: "how you should text",
                    bbox_pct: { x: 0.14, y: 0.07, w: 0.72, h: 0.07 },
                  },
                  {
                    text: "your cancer friend",
                    bbox_pct: { x: 0.1, y: 0.2, w: 0.35, h: 0.05 },
                  },
                ],
              },
            },
          ],
        },
      },
      1,
      { headline: "Texting a Cancer", body: "If we were prints on sand" }
    );
    const headline = layers.find((l) => l.text === "Texting a Cancer");
    expect(headline).toBeTruthy();
    expect(headline?.y_px).toBeGreaterThanOrEqual(Math.round(0.07 * 1350) + 2);
    expect(headline?.y_px).toBeLessThanOrEqual(Math.round(0.07 * 1350) + 8);
  });

  it("maps chat-mock gemini slide 1:1 without splitting body across distant blocks", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 2,
              text_blocks: [
                {
                  text: "how you should text",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
                },
                {
                  text: "your gemini friend",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
                },
                {
                  text: "That's you",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.11, y: 0.82, w: 0.16, h: 0.027 },
                },
                {
                  text: "Brain full of whimsy",
                  role: "cta",
                  source: "document_ai",
                  bbox_norm: { x: 0.11, y: 0.9, w: 0.31, h: 0.025 },
                },
              ],
            },
          ],
        },
      },
      2,
      {
        headline: "Texting a Gemini",
        text_blocks: [
          { role: "headline", text: "Texting a Gemini" },
          { role: "body", text: "You're the whimsical one" },
          { role: "body", text: "Brain full of stories" },
        ],
      }
    );
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.text)).toEqual([
      "Texting a",
      "Gemini friend",
      "Brain full of stories",
    ]);
  });

  it("splitHeadlineForChatMockTitlePair mirrors one-sentence title rhythm", () => {
    const upper = { ref_text: "how you should text" };
    const lower = { ref_text: "your gemini friend" };
    expect(splitHeadlineForChatMockTitlePair("Texting a Gemini", upper, lower)).toEqual({
      upper: "Texting a",
      lower: "Gemini friend",
    });
    expect(splitHeadlineForChatMockTitlePair("Texting a Taurus", upper, { ref_text: "your taurus friend" })).toEqual({
      upper: "Texting a",
      lower: "Taurus friend",
    });
  });

  it("mimicDocAiLayersCoverLlmCopy detects decor-only layers vs mapped LLM copy", () => {
    const llmSlide = { headline: "Most likely to ghost you", body: "Needs space after conflict" };
    expect(mimicDocAiLayersCoverLlmCopy([{ text: "Libra" }], llmSlide)).toBe(false);
    expect(
      mimicDocAiLayersCoverLlmCopy([{ text: "Libra" }, { text: "Most likely to ghost you" }], llmSlide)
    ).toBe(true);
    expect(mimicDocAiLayersCoverLlmCopy([], llmSlide)).toBe(false);
    expect(mimicDocAiLayersCoverLlmCopy([], {})).toBe(true);
  });

  it("buildMimicDocAiRenderTextLayers does not spam duplicate copy across OCR prefix fragments", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 4,
            text_blocks: [
              {
                text: "what it's like as a",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.08, y: 0.12, w: 0.35, h: 0.04 },
              },
              {
                text: "cancer",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.08, y: 0.17, w: 0.2, h: 0.04 },
              },
              {
                text: "(unrestrained)",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.08, y: 0.22, w: 0.3, h: 0.04 },
              },
              {
                text: "what it's like as",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.52, y: 0.44, w: 0.38, h: 0.06 },
              },
              {
                text: "a",
                role: "body",
                source: "document_ai",
                bbox_norm: { x: 0.52, y: 0.51, w: 0.08, h: 0.04 },
              },
              {
                text: "@signandsound",
                role: "handle",
                source: "document_ai",
                bbox_norm: { x: 0.35, y: 0.9, w: 0.3, h: 0.04 },
              },
            ],
          },
        ],
      },
      reference_items: [],
      slide_plans: [],
    };
    const llmSlide = {
      text_blocks: [
        { role: "headline", text: "What it's like as a cancer (unrestrained)" },
        { role: "handle", text: "@signandsound" },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(mimic, 4, llmSlide, undefined, {
      projectHandle: "@signandsound",
      textBacking: true,
    });
    const headlineLike = layers.filter((l) =>
      l.text.toLowerCase().includes("what it's like as a cancer")
    );
    expect(headlineLike).toHaveLength(1);
    expect(layers.length).toBeLessThanOrEqual(3);
  });

  it("buildMimicDocAiRenderTextLayers maps one layer per reviewer text_blocks line when OCR is fragmented", () => {
    const mimic = {
      visual_guideline: {
        slides: [
          {
            slide_index: 2,
            text_blocks: [
              { text: "life", role: "body", source: "document_ai", bbox_norm: { x: 0.1, y: 0.2, w: 0.1, h: 0.03 } },
              { text: "as a", role: "body", source: "document_ai", bbox_norm: { x: 0.22, y: 0.2, w: 0.12, h: 0.03 } },
              { text: "gemini", role: "body", source: "document_ai", bbox_norm: { x: 0.36, y: 0.2, w: 0.15, h: 0.03 } },
              { text: "(unfiltered)", role: "body", source: "document_ai", bbox_norm: { x: 0.53, y: 0.2, w: 0.2, h: 0.03 } },
              { text: "maybe elsewhere", role: "body", source: "document_ai", bbox_norm: { x: 0.1, y: 0.55, w: 0.35, h: 0.04 } },
              { text: "I sound logical", role: "body", source: "document_ai", bbox_norm: { x: 0.1, y: 0.6, w: 0.35, h: 0.04 } },
              {
                text: "@signandsound",
                role: "handle",
                source: "document_ai",
                bbox_norm: { x: 0.35, y: 0.9, w: 0.3, h: 0.04 },
              },
            ],
          },
        ],
      },
      reference_items: [],
      slide_plans: [],
    };
    const llmSlide = {
      text_blocks: [
        { role: "body", text: "maybe elsewhere, I sound logical" },
        { role: "headline", text: "life as a gemini (unfiltered)" },
        { role: "handle", text: "@signandsound" },
      ],
    };
    const layers = buildMimicDocAiRenderTextLayers(mimic, 2, llmSlide, undefined, {
      projectHandle: "@signandsound",
      textBacking: true,
    });
    expect(layers.length).toBeLessThanOrEqual(4);
    expect(layers.filter((l) => l.text.includes("life as a gemini"))).toHaveLength(1);
    expect(layers.filter((l) => l.text.includes("maybe elsewhere"))).toHaveLength(1);
  });

  it("formatMimicTextBackingBackground normalizes hex and rgba", () => {
    expect(formatMimicTextBackingBackground(null)).toBe(MIMIC_DEFAULT_TEXT_BACKING_BACKGROUND);
    expect(formatMimicTextBackingBackground("#ff8800")).toBe("rgba(255,136,0,0.92)");
    expect(formatMimicTextBackingBackground("rgba(10,20,30,0.5)")).toBe("rgba(10,20,30,0.5)");
    expect(mimicTextBackingColorToHex("rgba(255,136,0,0.92)")).toBe("#ff8800");
  });
});
