import { describe, expect, it } from "vitest";
import {
  buildMimicFullBleedCopyLengthSystemBlock,
  mimicFullBleedCopyLengthTargets,
  parseMimicFullBleedCopyReferenceScale,
} from "./mimic-full-bleed-copy-length.js";

describe("mimic-full-bleed-copy-length", () => {
  it("defaults scale to 0.5", () => {
    expect(parseMimicFullBleedCopyReferenceScale(undefined)).toBe(0.5);
    expect(parseMimicFullBleedCopyReferenceScale("2/3")).toBeCloseTo(2 / 3);
  });

  it("caps each slide at ~half of reference chars", () => {
    const targets = mimicFullBleedCopyLengthTargets(
      [{ slide_index: 1, reference_on_screen_text: "how you should text your gemini friend", visual_description: null, layout_template: null, image_or_photo_role: null, text_density: null, slide_purpose: null, graphic_elements: null, color_tokens: null, typography: null, text_blocks: null }],
      0.5
    );
    expect(targets[0]?.reference_chars).toBeGreaterThan(20);
    expect(targets[0]?.target_max_chars).toBeLessThan(targets[0]!.reference_chars);
  });

  it("buildMimicFullBleedCopyLengthSystemBlock mentions per-slide caps", () => {
    const block = buildMimicFullBleedCopyLengthSystemBlock(
      [{ slide_index: 2, reference_on_screen_text: "short bubble", visual_description: null, layout_template: null, image_or_photo_role: null, text_density: null, slide_purpose: null, graphic_elements: null, color_tokens: null, typography: null, text_blocks: null }],
      2 / 3
    );
    expect(block).toContain("Slide 2");
    expect(block).toContain("max");
  });
});
