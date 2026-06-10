import { describe, expect, it } from "vitest";
import {
  resolveEffectiveContentSlideIndices,
  shouldExpandContentIndicesToFullTextDeck,
} from "./mimic-content-slide-indices.js";

describe("shouldExpandContentIndicesToFullTextDeck", () => {
  it("expands [1,7,12] on a 12-slide text deck", () => {
    const textful = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(shouldExpandContentIndicesToFullTextDeck([1, 7, 12], textful, 12)).toBe(true);
  });

  it("does not expand when eval already covers most slides", () => {
    const textful = [1, 2, 3, 4];
    expect(shouldExpandContentIndicesToFullTextDeck([1, 2, 3], textful, 4)).toBe(false);
  });
});

describe("resolveEffectiveContentSlideIndices", () => {
  it("returns full text deck when Nemotron undercounts content indices", () => {
    const indices = resolveEffectiveContentSlideIndices(
      {
        aesthetic_analysis_json: {
          mimic_evaluation: {
            content_slide_indices: [1, 7, 12],
            skip_slide_indices: [],
          },
          slides: Array.from({ length: 12 }).map((_, i) => ({
            slide_index: i + 1,
            on_screen_text_transcript: `Slide ${i + 1}`,
          })),
        },
      },
      12
    );
    expect(indices).toHaveLength(12);
    expect(indices[0]).toBe(1);
    expect(indices[11]).toBe(12);
  });

  it("honors explicit skip_slide_indices", () => {
    const indices = resolveEffectiveContentSlideIndices(
      {
        aesthetic_analysis_json: {
          mimic_evaluation: {
            content_slide_indices: [1, 4],
            skip_slide_indices: [2, 3],
          },
          slides: [
            { slide_index: 1, on_screen_text_transcript: "A" },
            { slide_index: 2, on_screen_text_transcript: "promo" },
            { slide_index: 3, on_screen_text_transcript: "promo2" },
            { slide_index: 4, on_screen_text_transcript: "B" },
          ],
        },
      },
      4
    );
    expect(indices).toEqual([1, 4]);
  });
});
