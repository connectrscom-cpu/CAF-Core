import { describe, expect, it } from "vitest";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import {
  buildMimicReferenceCopyBudgetSystemBlock,
  enforceMimicCopyBudgetOnParsedOutput,
  looksLikeInstagramHandleText,
  mimicCopyBlockBudgets,
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
});
