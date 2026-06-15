import { describe, expect, it } from "vitest";
import {
  collapseParagraphCopyTargets,
  dropOcrContainerBoxes,
  filterOverlayLayoutBlocks,
  isOcrMegaMergeBox,
  isOverlayChromeReferenceText,
  isOverlayWatermarkReferenceText,
  isPreserveReferenceDecorText,
  isZodiacSignName,
  referenceTextMatchesLlmHeadline,
  splitHeadlineWithPreservedDecorTitle,
  shouldRenderDocAiLayerSingleLine,
  preferSingleLineTextBackLayer,
  type OverlayLayoutBlock,
} from "./mimic-docai-overlay-layout.js";

function block(partial: Partial<OverlayLayoutBlock> & Pick<OverlayLayoutBlock, "ref_text">): OverlayLayoutBlock {
  return {
    text: partial.ref_text,
    ref_text: partial.ref_text,
    role: partial.role ?? "body",
    x: partial.x ?? 0.1,
    y: partial.y ?? 0.1,
    w: partial.w ?? 0.3,
    h: partial.h ?? 0.05,
    align: partial.align ?? "left",
    font_size_px: partial.font_size_px ?? 24,
    font_weight: partial.font_weight ?? "400",
    color_hex: partial.color_hex ?? "#fff",
    font_family: partial.font_family ?? null,
    source: partial.source ?? "document_ai",
  };
}

describe("mimic-docai-overlay-layout", () => {
  it("filters chat UI chrome", () => {
    expect(isOverlayChromeReferenceText("+ Message", "body")).toBe(true);
    expect(isOverlayChromeReferenceText("9:41", "timestamp")).toBe(true);
    expect(isOverlayChromeReferenceText("how you should text", "body")).toBe(false);
    expect(isOverlayChromeReferenceText("Your headline here", "headline")).toBe(false);
  });

  it("collapses wide paragraph stacks to one target", () => {
    const blocks = [
      block({ ref_text: "Line one of horoscope", role: "body", x: 0.2, y: 0.35, w: 0.6, h: 0.04 }),
      block({ ref_text: "Line two continues", role: "body", x: 0.2, y: 0.4, w: 0.6, h: 0.04 }),
      block({ ref_text: "Line three ends", role: "body", x: 0.2, y: 0.45, w: 0.6, h: 0.04 }),
    ];
    const collapsed = collapseParagraphCopyTargets(blocks);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.h).toBeGreaterThan(0.1);
  });

  it("keeps corner micro-stacks separate for meme quadrants", () => {
    const blocks = [
      block({ ref_text: "TOP LEFT", role: "body", x: 0.05, y: 0.08, w: 0.35, h: 0.06 }),
      block({ ref_text: "TOP RIGHT", role: "body", x: 0.6, y: 0.08, w: 0.35, h: 0.06 }),
      block({ ref_text: "BOTTOM LEFT", role: "body", x: 0.05, y: 0.75, w: 0.35, h: 0.06 }),
      block({ ref_text: "BOTTOM RIGHT", role: "body", x: 0.6, y: 0.75, w: 0.35, h: 0.06 }),
    ];
    const collapsed = collapseParagraphCopyTargets(blocks);
    expect(collapsed).toHaveLength(4);
  });

  it("prefers wrap when candidate copy is much longer than reference", () => {
    const ref = "Short ref";
    const long =
      "This is a much longer horoscope paragraph that should wrap inside the bbox instead of clipping on one line.";
    expect(shouldRenderDocAiLayerSingleLine(ref, long, 600, 120)).toBe(false);
  });

  it("preferSingleLineTextBackLayer wraps long meme headlines", () => {
    expect(preferSingleLineTextBackLayer("life as a gemini (unfiltered)", 520)).toBe(false);
    expect(preferSingleLineTextBackLayer("Gemini", 200)).toBe(true);
  });

  it("filterOverlayLayoutBlocks removes chrome before collapse", () => {
    const blocks = [
      block({ ref_text: "+ Message", role: "placeholder" }),
      block({ ref_text: "Real headline", role: "headline", y: 0.2 }),
    ];
    const filtered = filterOverlayLayoutBlocks(blocks);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.ref_text).toBe("Real headline");
  });

  it("filters watermarks and decorative labels", () => {
    expect(isOverlayWatermarkReferenceText("That's you", { h: 0.03, w: 0.15 })).toBe(true);
    expect(isOverlayWatermarkReferenceText("mymarketinglab", { h: 0.02, w: 0.12 })).toBe(true);
    expect(isOverlayWatermarkReferenceText("while writing essays", { h: 0.03, w: 0.3 })).toBe(false);
    const blocks = [
      block({ ref_text: "how you should text", role: "headline", y: 0.07 }),
      block({ ref_text: "your gemini friend", role: "body", y: 0.15 }),
      block({ ref_text: "That's you", role: "body", y: 0.82, h: 0.03, w: 0.16 }),
      block({ ref_text: "Brain full of whimsy", role: "cta", y: 0.9, w: 0.35 }),
    ];
    const filtered = filterOverlayLayoutBlocks(blocks);
    expect(filtered.map((b) => b.ref_text)).toEqual([
      "how you should text",
      "your gemini friend",
      "Brain full of whimsy",
    ]);
  });

  it("does not collapse friend subtitle with distant image-area blocks", () => {
    const blocks = [
      block({ ref_text: "how you should text", role: "headline", y: 0.07, w: 0.72, h: 0.06 }),
      block({ ref_text: "your virgo friend", role: "body", y: 0.15, w: 0.7, h: 0.06 }),
      block({ ref_text: "mymarketinglab", role: "body", y: 0.34, w: 0.08, h: 0.02 }),
      block({ ref_text: "while writing essays", role: "cta", y: 0.77, w: 0.34, h: 0.03 }),
    ];
    const filtered = filterOverlayLayoutBlocks(blocks);
    const collapsed = collapseParagraphCopyTargets(filtered);
    expect(collapsed.map((b) => b.ref_text)).toEqual(["how you should text", "your virgo friend", "while writing essays"]);
  });

  it("preserves decor title labels and meme headline phrases separately", () => {
    expect(isZodiacSignName("Libra")).toBe(true);
    expect(
      isPreserveReferenceDecorText("Libra", block({ ref_text: "Libra", role: "headline", y: 0.04, w: 0.22, h: 0.07 }))
    ).toBe(true);
    expect(
      isPreserveReferenceDecorText("THE ARIES MOTHER", block({ ref_text: "THE ARIES MOTHER", role: "headline", y: 0.08 }))
    ).toBe(true);
    expect(
      isPreserveReferenceDecorText("Most likely", block({ ref_text: "Most likely", role: "headline", y: 0.42, w: 0.3, h: 0.05 }))
    ).toBe(false);
    expect(referenceTextMatchesLlmHeadline("most likely", "Most likely")).toBe(true);
    expect(
      referenceTextMatchesLlmHeadline(
        "Libra",
        "Most likely to cancel",
        block({ ref_text: "Libra", role: "headline", y: 0.04, w: 0.22, h: 0.07 })
      )
    ).toBe(false);
  });

  it("dropOcrContainerBoxes removes tall parent boxes that wrap line-level siblings", () => {
    const blocks = [
      block({ ref_text: "mad about", role: "body", x: 0.7, y: 0.21, w: 0.22, h: 0.12 }),
      block({ ref_text: "the canceled", role: "body", x: 0.7, y: 0.26, w: 0.2, h: 0.03 }),
      block({ ref_text: "birthday trip", role: "body", x: 0.7, y: 0.31, w: 0.2, h: 0.03 }),
    ];
    expect(dropOcrContainerBoxes(blocks).map((b) => b.ref_text)).toEqual([
      "the canceled",
      "birthday trip",
    ]);
  });

  it("drops full-width OCR mega-merge bands before slot inference", () => {
    const blocks = [
      block({ ref_text: "Aries", role: "headline", y: 0.06, w: 0.3, h: 0.05 }),
      block({ ref_text: "the 5th photo the sadness", role: "body", y: 0.72, w: 0.72, h: 0.04 }),
      block({ ref_text: "starts to flirt", role: "body", x: 0.58, y: 0.64, w: 0.32, h: 0.04 }),
    ];
    expect(isOcrMegaMergeBox(blocks[1]!)).toBe(true);
    expect(filterOverlayLayoutBlocks(blocks).map((b) => b.ref_text)).toEqual([
      "Aries",
      "starts to flirt",
    ]);
  });

  it("splitHeadlineWithPreservedDecorTitle separates decor title from headline remainder", () => {
    const orderedRef = [block({ ref_text: "Aries", role: "headline", y: 0.06, w: 0.3, h: 0.05 })];
    expect(splitHeadlineWithPreservedDecorTitle("Aries gets playful when bored", orderedRef)).toEqual({
      decorTitle: "Aries",
      remainder: "gets playful when bored",
    });
  });

  it("splitHeadlineWithPreservedDecorTitle works for generic single-word decor titles", () => {
    const orderedRef = [block({ ref_text: "Jordan", role: "headline", y: 0.08, w: 0.28, h: 0.05 })];
    expect(
      splitHeadlineWithPreservedDecorTitle("Jordan always orders dessert first", orderedRef)
    ).toEqual({
      decorTitle: "Jordan",
      remainder: "always orders dessert first",
    });
  });

  it("splitHeadlineWithPreservedDecorTitle handles possessive decor titles", () => {
    const orderedRef = [block({ ref_text: "Gemini", role: "headline", y: 0.06, w: 0.3, h: 0.05 })];
    expect(splitHeadlineWithPreservedDecorTitle("Gemini's dilemma", orderedRef)).toEqual({
      decorTitle: "Gemini",
      remainder: "dilemma",
    });
    const leoRef = [block({ ref_text: "Leo", role: "headline", y: 0.06, w: 0.3, h: 0.05 })];
    expect(splitHeadlineWithPreservedDecorTitle("Leo's mirror monologue", leoRef)).toEqual({
      decorTitle: "Leo",
      remainder: "mirror monologue",
    });
  });
});
