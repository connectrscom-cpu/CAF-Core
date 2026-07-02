import { describe, expect, it } from "vitest";
import {
  applyCopyGroupingLlmResultToParsed,
  applySemanticCoherenceLlmResultToParsed,
  applySlotGroupingToSlide,
  buildCopyGroupingSlideInputs,
  collapseTextBlocksToCopySlots,
} from "./mimic-copy-coherence.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { inferMimicReferenceCopySlots } from "./mimic-copy-slots.js";

describe("mimic-copy-coherence", () => {
  it("collapseTextBlocksToCopySlots merges per-OCR rows into slot clusters", () => {
    const blocks = [
      { text: "what it's like to be a", role: "body" },
      { text: "virgo (no explanation)", role: "body" },
      { text: "4578 junk", role: "body" },
    ];
    const ocrBlocks = [
      { text: "what it's like to be a", role: "body", x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      { text: "virgo (no explanation)", role: "body", x: 0.1, y: 0.3, w: 0.3, h: 0.05 },
      { text: "4578 junk", role: "body", x: 0.1, y: 0.8, w: 0.2, h: 0.03 },
    ];
    const slots = inferMimicReferenceCopySlots(ocrBlocks);
    const collapsed = collapseTextBlocksToCopySlots(blocks, slots);
    expect(collapsed.length).toBe(slots.length);
    expect(collapsed.length).toBeLessThan(blocks.length);
  });

  it("applySlotGroupingToSlide writes one text_block per slot", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "how you should text", role: "headline", x: 0.14, y: 0.07, w: 0.72, h: 0.065 },
      { text: "your gemini friend", role: "subheadline", x: 0.17, y: 0.15, w: 0.65, h: 0.065 },
    ]);
    const next = applySlotGroupingToSlide(
      { text_blocks: [{ role: "headline", text: "old" }] },
      slots,
      new Map([[0, "Texting a Gemini friend"]])
    );
    expect(next).not.toBeNull();
    const tbs = next!.text_blocks as Array<{ text: string }>;
    expect(tbs).toHaveLength(1);
    expect(tbs[0]?.text).toBe("Texting a Gemini friend");
  });

  it("applyCopyGroupingLlmResultToParsed applies per-slot LLM output", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 6,
        reference_on_screen_text: null,
        visual_description: null,
        layout_template: null,
        image_or_photo_role: null,
        text_density: null,
        slide_purpose: "body",
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: null,
        copy_slots_v1: inferMimicReferenceCopySlots([
          { text: "line a", role: "body", x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
          { text: "line b", role: "body", x: 0.1, y: 0.3, w: 0.3, h: 0.05 },
        ]),
      },
    ];
    const parsed = {
      slides: [
        {
          slide_index: 6,
          text_blocks: [
            { role: "body", text: "line a" },
            { role: "body", text: "line b" },
          ],
        },
      ],
    };
    const llm = {
      slides: [
        {
          slide_index: 6,
          slots: [{ slot_index: 0, text: "What it's like to be a Virgo" }],
        },
      ],
    };
    const out = applyCopyGroupingLlmResultToParsed(parsed, layout, llm);
    expect(out.slides_applied).toBe(1);
    const slide = (out.parsed.slides as Record<string, unknown>[])[0] as Record<string, unknown>;
    const blocks = slide.text_blocks as Array<{ text: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toContain("Virgo");
  });

  it("buildCopyGroupingSlideInputs uses slot clusters when text_blocks are per-OCR", () => {
    const slots = inferMimicReferenceCopySlots([
      { text: "Headline", role: "headline", x: 0.1, y: 0.1, w: 0.5, h: 0.05 },
      { text: "body a", role: "body", x: 0.1, y: 0.5, w: 0.3, h: 0.04 },
      { text: "body b", role: "body", x: 0.55, y: 0.5, w: 0.3, h: 0.04 },
    ]);
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 1,
        reference_on_screen_text: null,
        visual_description: null,
        layout_template: null,
        image_or_photo_role: null,
        text_density: null,
        slide_purpose: null,
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: null,
        copy_slots_v1: slots,
      },
    ];
    const parsed = {
      slides: [
        {
          text_blocks: [
            { role: "headline", text: "Headline" },
            { role: "body", text: "body a" },
            { role: "body", text: "body b" },
          ],
        },
      ],
    };
    const inputs = buildCopyGroupingSlideInputs(parsed, layout);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.slots.length).toBe(slots.length);
    expect(inputs[0]?.slots.length).toBeLessThan(3);
  });

  it("applySemanticCoherenceLlmResultToParsed rewrites drifting slides", () => {
    const parsed = {
      slides: [
        { slide_index: 2, headline: "Generic pasta photo", body: "So yummy" },
        { slide_index: 3, headline: "Recipe tips", body: "Try this restaurant" },
      ],
    };
    const llm = {
      slides: [
        {
          slide_index: 2,
          headline: "Aries",
          body: "Hot wings — bold, fiery, impossible to ignore.",
          text_blocks: [{ role: "headline", text: "Aries" }, { role: "body", text: "Hot wings — bold, fiery." }],
        },
      ],
    };
    const applied = applySemanticCoherenceLlmResultToParsed(parsed, llm);
    expect(applied.slides_rewritten).toBe(1);
    const slides = applied.parsed.slides as Array<Record<string, unknown>>;
    expect(slides[0]?.headline).toBe("Aries");
    expect(slides[1]?.headline).toBe("Recipe tips");
  });
});
