import { describe, expect, it } from "vitest";
import { mergeCarouselReferenceAnalysis } from "./carousel-reference-layout-merge.js";
import { CAROUSEL_REFERENCE_OCR_SCHEMA } from "../domain/carousel-slide-analysis.js";

describe("mergeCarouselReferenceAnalysis", () => {
  it("replaces transcript and text_blocks from Document AI", () => {
    const ocr = new Map([
      [
        1,
        {
          schema_version: CAROUSEL_REFERENCE_OCR_SCHEMA,
          slide_index: 1,
          canvas_width_px: 1080,
          canvas_height_px: 1350,
          full_text: "Exact OCR line",
          ocr_confidence_mean: 0.92,
          token_count: 1,
          text_layers: [
            {
              layer_index: 1,
              text: "Exact OCR line",
              bbox_pct: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
              alignment: "center" as const,
              font: {
                family_detected: "SANS_SERIF",
                size_px: 44,
                weight: 700,
                bold: true,
                italic: null,
                underline: null,
                color_hex: "#111111",
                background_color_hex: null,
                letter_spacing: null,
              },
              reading_order: 1,
              confidence: 0.92,
              source: "document_ai" as const,
            },
          ],
        },
      ],
    ]);
    const merged = mergeCarouselReferenceAnalysis(
      {
        slides: [
          {
            slide_index: 1,
            on_screen_text_transcript: "hallucinated",
            visual_description: "keep me",
            text_block_roles: [{ block_index: 1, role: "headline" }],
          },
        ],
      },
      ocr
    );
    const slide = (merged?.slides as Record<string, unknown>[])[0];
    expect(slide?.on_screen_text_transcript).toBe("Exact OCR line");
    expect(slide?.visual_description).toBe("keep me");
    const blocks = slide?.text_blocks as Record<string, unknown>[];
    expect(blocks?.[0]?.text).toBe("Exact OCR line");
    expect(blocks?.[0]?.role).toBe("headline");
    expect(blocks?.[0]?.source).toBe("document_ai");
  });
});
