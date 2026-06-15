import { describe, expect, it } from "vitest";
import {
  applyCopyGroupingLlmResultToParsed,
  applyCopyGroupingToSlide,
  buildCopyGroupingSlideInputs,
  parseCopyGroupingLlmResult,
} from "./mimic-copy-coherence.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";

describe("mimic-copy-coherence", () => {
  const layout: MimicSlideCopyLayoutForLlm[] = [
    {
      slide_index: 6,
      reference_on_screen_text: "what it's like to be a virgo",
      visual_description: "couple photo",
      layout_template: null,
      image_or_photo_role: null,
      text_density: null,
      slide_purpose: "listicle body",
      graphic_elements: null,
      color_tokens: null,
      typography: null,
      text_blocks: [
        { role: "body", text: "what it's like to be a" },
        { role: "body", text: "virgo (no explanation)" },
        { role: "body", text: "4578*250_%^8 ab" },
      ],
      copy_slots_v1: [],
    },
  ];

  it("buildCopyGroupingSlideInputs includes multi-box slides regardless of heuristics", () => {
    const parsed = {
      slides: [
        {
          slide_index: 6,
          text_blocks: [
            { role: "body", text: "Clean line one." },
            { role: "body", text: "Clean line two." },
          ],
        },
      ],
    };
    expect(buildCopyGroupingSlideInputs(parsed, layout)).toHaveLength(1);
  });

  it("applyCopyGroupingToSlide partitions box indices and writes copy_groupings_v1", () => {
    const slide = {
      text_blocks: [
        { role: "body", text: "what it's like to be a" },
        { role: "body", text: "virgo (no explanation)" },
        { role: "body", text: "4578*250_%^8 ab" },
      ],
    };
    const next = applyCopyGroupingToSlide(slide, {
      slide_index: 6,
      groups: [
        {
          llm_field: "headline",
          split: "line_per_block",
          box_indices: [0, 1],
          lines: ["What it's like", "to be a Virgo"],
        },
        {
          llm_field: "body",
          split: "single_block",
          box_indices: [2],
          lines: ["(no explanation needed)"],
        },
      ],
    });
    expect(next).not.toBeNull();
    const blocks = (next!.text_blocks as Array<{ text: string; role: string }>);
    expect(blocks[0]?.text).toBe("What it's like");
    expect(blocks[1]?.text).toBe("to be a Virgo");
    expect(Array.isArray(next!.copy_groupings_v1)).toBe(true);
    expect(Array.isArray(next!.copy_slots_v1)).toBe(true);
  });

  it("applyCopyGroupingLlmResultToParsed parses LLM JSON shape", () => {
    const parsed = {
      slides: [
        {
          slide_index: 6,
          text_blocks: [
            { role: "body", text: "a" },
            { role: "body", text: "b" },
          ],
        },
      ],
    };
    const llm = {
      slides: [
        {
          slide_index: 6,
          groups: [
            {
              llm_field: "headline",
              split: "line_per_block",
              box_indices: [0, 1],
              lines: ["Hello", "world"],
            },
          ],
        },
      ],
    };
    const groupings = parseCopyGroupingLlmResult(llm);
    const out = applyCopyGroupingLlmResultToParsed(parsed, groupings);
    expect(out.slides_applied).toBe(1);
    const slide = (out.parsed.slides as Record<string, unknown>[])[0] as Record<string, unknown>;
    const blocks = slide.text_blocks as Array<{ text: string }>;
    expect(blocks.map((b) => b.text)).toEqual(["Hello", "world"]);
  });
});
