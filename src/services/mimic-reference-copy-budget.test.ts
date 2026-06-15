import { describe, expect, it } from "vitest";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import {
  buildMimicReferenceCopyBudgetSystemBlock,
  enforceMimicCopyBudgetOnParsedOutput,
  looksLikeInstagramHandleText,
  mimicCopyBlockBudgets,
  mimicCopySlotBudgets,
  truncateMimicCopyToMax,
} from "./mimic-reference-copy-budget.js";

const layoutWithBlocks: MimicSlideCopyLayoutForLlm[] = [
  {
    slide_index: 1,
    reference_on_screen_text: "OLD TITLE\nold body",
    visual_description: null,
    layout_template: null,
    image_or_photo_role: null,
    text_density: null,
    slide_purpose: null,
    graphic_elements: null,
    color_tokens: null,
    typography: null,
    text_blocks: [
      { text: "OLD TITLE", role: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.1, align: null, font_size_px: 72, font_weight: null, color_hex: null },
      { text: "@referencecreator", role: "handle", x: 0.1, y: 0.9, w: 0.3, h: 0.05, align: null, font_size_px: 24, font_weight: null, color_hex: null },
    ],
  },
];

describe("mimic-reference-copy-budget", () => {
  it("builds per-block max near reference length + slack", () => {
    const blocks = mimicCopyBlockBudgets(layoutWithBlocks, { scale: 1, charSlack: 4 });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.reference_chars).toBe(9);
    expect(blocks[0]?.max_chars).toBe(13);
    expect(blocks[1]?.is_handle_block).toBe(true);
  });

  it("system block lists per-line caps", () => {
    const block = buildMimicReferenceCopyBudgetSystemBlock(layoutWithBlocks, {
      branch: "template_bg",
      charSlack: 4,
    });
    expect(block).toContain("Slide 1, line 1");
    expect(block).toContain("max 13 chars");
    expect(block).toContain("HTML/CSS overlay");
  });

  it("enforceMimicCopyBudgetOnParsedOutput truncates long copy and swaps handles", () => {
    const parsed = enforceMimicCopyBudgetOnParsedOutput(
      {
        slides: [
          {
            headline: "This headline is way too long for the reference box placement",
            body: "@wronghandle",
          },
        ],
      },
      layoutWithBlocks,
      { charSlack: 4, projectHandle: "@mybrand" }
    );
    const slide = (parsed.slides as Record<string, unknown>[])[0]!;
    const blocks = slide.text_blocks as Array<{ text: string; role: string }>;
    expect(blocks[0]?.text.length).toBeLessThanOrEqual(13);
    expect(blocks[1]?.text).toBe("@mybrand");
  });

  it("truncateMimicCopyToMax prefers word boundary", () => {
    expect(truncateMimicCopyToMax("hello wonderful world", 12).endsWith("…")).toBe(true);
    expect(truncateMimicCopyToMax("hello wonderful world", 12).length).toBeLessThanOrEqual(12);
  });

  it("detects handle-like text", () => {
    expect(looksLikeInstagramHandleText("@foo_bar")).toBe(true);
    expect(looksLikeInstagramHandleText("Follow for more")).toBe(false);
  });

  it("strips glued reference handle from headline and substitutes project handle on handle blocks", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        ...layoutWithBlocks[0]!,
        text_blocks: [
          {
            text: "THE ARIES MOTHER",
            role: "headline",
            x: 0.1,
            y: 0.08,
            w: 0.8,
            h: 0.08,
            align: null,
            font_size_px: 72,
            font_weight: null,
            color_hex: null,
          },
          {
            text: "@sistersvillage",
            role: "handle",
            x: 0.35,
            y: 0.18,
            w: 0.3,
            h: 0.05,
            align: null,
            font_size_px: 24,
            font_weight: null,
            color_hex: null,
          },
          {
            text: "She is spirited and adventurous",
            role: "body",
            x: 0.1,
            y: 0.28,
            w: 0.8,
            h: 0.45,
            align: null,
            font_size_px: 32,
            font_weight: null,
            color_hex: null,
          },
        ],
      },
    ];
    const parsed = enforceMimicCopyBudgetOnParsedOutput(
      {
        slides: [
          {
            headline: "@sistersvillageShe is spirited and adventurous, constantly",
            body: "passing it on as she guides her kids to their own exciting worlds.",
          },
        ],
      },
      layout,
      { charSlack: 4, projectHandle: "@mybrand" }
    );
    const slide = (parsed.slides as Record<string, unknown>[])[0]!;
    expect(String(slide.headline)).not.toContain("sistersvillage");
    expect(String(slide.headline)).toMatch(/^She is spirited/i);
    const blocks = slide.text_blocks as Array<{ text: string; role: string }>;
    expect(blocks.find((b) => b.role === "handle")?.text).toBe("@mybrand");
  });

  it("enforceMimicCopyBudgetOnParsedOutput clamps multi-block headline slot to cluster max", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 1,
        reference_on_screen_text: "how you should text\nyour gemini friend",
        visual_description: null,
        layout_template: null,
        image_or_photo_role: null,
        text_density: null,
        slide_purpose: null,
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: [
          { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065, align: null, font_size_px: 72, font_weight: null, color_hex: null },
          { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065, align: null, font_size_px: 65, font_weight: null, color_hex: null },
        ],
        copy_slots_v1: [
          {
            schema_version: "copy_slots_v1",
            slot_index: 0,
            llm_field: "headline",
            split: "line_per_block",
            block_indices: [0, 1],
            block_texts: ["how you should text", "your gemini friend"],
            reference_text: "how you should text your gemini friend",
          },
        ],
      },
    ];
    const parsed = enforceMimicCopyBudgetOnParsedOutput(
      {
        slides: [
          {
            headline: "Texting your whimsical Gemini friend every single day without stopping",
            text_blocks: [
              {
                role: "headline",
                text: "Texting your whimsical Gemini friend every single day without stopping",
              },
            ],
          },
        ],
      },
      layout,
      { charSlack: 4, scale: 1 }
    );
    const slide = (parsed.slides as Record<string, unknown>[])[0]!;
    const blocks = slide.text_blocks as Array<{ role: string; text: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text.length).toBeLessThanOrEqual(45);
  });

  it("mimicCopySlotBudgets uses per-OCR-line caps instead of multiplying merged reference length", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 1,
        reference_on_screen_text: "how you should text\nyour gemini friend",
        visual_description: null,
        layout_template: null,
        image_or_photo_role: null,
        text_density: null,
        slide_purpose: null,
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: [],
        copy_slots_v1: [
          {
            schema_version: "copy_slots_v1",
            slot_index: 0,
            llm_field: "headline",
            split: "line_per_block",
            block_indices: [0, 1],
            block_texts: ["how you should text", "your gemini friend"],
            reference_text: "how you should text your gemini friend",
          },
        ],
      },
    ];
    const budgets = mimicCopySlotBudgets(layout, { scale: 1, charSlack: 4 });
    expect(budgets[0]?.line_budgets).toHaveLength(2);
    expect(budgets[0]?.line_budgets?.[0]?.max_chars).toBe("how you should text".length + 4);
    expect(budgets[0]?.line_budgets?.[1]?.max_chars).toBe("your gemini friend".length + 4);
    expect(budgets[0]?.max_chars).toBeLessThan(80);
  });

  it("enforceMimicCopyBudgetOnParsedOutput uses copy_slots_v1 when roles are inverted", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 2,
        reference_on_screen_text: "astrhology\ntaurus with a crush",
        visual_description: null,
        layout_template: null,
        image_or_phone_role: null,
        text_density: null,
        slide_purpose: null,
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: [
          { text: "astrhology", role: "headline", x: 0.596, y: 0.047, w: 0.083, h: 0.016, align: null, font_size_px: 20, font_weight: null, color_hex: null },
          { text: "taurus with a crush", role: "cta", x: 0.149, y: 0.477, w: 0.696, h: 0.049, align: null, font_size_px: 65, font_weight: null, color_hex: null },
        ],
        copy_slots_v1: [
          {
            schema_version: "copy_slots_v1",
            slot_index: 0,
            llm_field: "headline",
            split: "single_block",
            block_indices: [1],
            block_texts: ["taurus with a crush"],
            reference_text: "taurus with a crush",
          },
          {
            schema_version: "copy_slots_v1",
            slot_index: 1,
            llm_field: "handle",
            split: "single_block",
            block_indices: [0],
            block_texts: ["astrhology"],
            reference_text: "astrhology",
          },
        ],
      },
    ];
    const parsed = enforceMimicCopyBudgetOnParsedOutput(
      {
        slides: [{ slide_index: 2, headline: "Taurus' Steady Love", text_blocks: [{ role: "headline", text: "Taurus' Steady Love" }] }],
      },
      layout,
      { charSlack: 4, projectHandle: "@astrologyexplore" }
    );
    const slide = (parsed.slides as Record<string, unknown>[])[0]!;
    expect(String(slide.headline)).toBe("Taurus' Steady Love");
    const blocks = slide.text_blocks as Array<{ role: string; text: string }>;
    expect(blocks[0]?.text).toBe("Taurus' Steady Love");
    expect(blocks[1]?.text).toBe("@astrologyexplore");
  });
});
