import { describe, expect, it } from "vitest";
import { compareCarouselOutputText } from "./carousel-output-text-qa.js";
import type { CarouselDocumentAiSlideOcr, CarouselOutputIntended } from "../domain/carousel-slide-analysis.js";
import { CAROUSEL_REFERENCE_OCR_SCHEMA } from "../domain/carousel-slide-analysis.js";

describe("compareCarouselOutputText", () => {
  it("flags missing expected text and extra ghost text", () => {
    const intended: CarouselOutputIntended = {
      canvas: { width_px: 1080, height_px: 1350 },
      text_layers: [{ id: "headline", text: "Five signs of burnout", bbox_pct: null, font: {} }],
      forbidden_text: ["Fashion Nova"],
      safe_margin_pct: 0.06,
      art_only_image: false,
    };
    const detected: CarouselDocumentAiSlideOcr = {
      schema_version: CAROUSEL_REFERENCE_OCR_SCHEMA,
      slide_index: 1,
      canvas_width_px: 1080,
      canvas_height_px: 1350,
      full_text: "Five signs of burnout AI gibberish Fashion Nova",
      ocr_confidence_mean: 0.9,
      token_count: 3,
      text_layers: [
        {
          layer_index: 1,
          text: "Five signs of burnout AI gibberish Fashion Nova",
          bbox_pct: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
          alignment: "center",
          font: {
            family_detected: null,
            size_px: 40,
            weight: null,
            bold: null,
            italic: null,
            underline: null,
            color_hex: "#000000",
            background_color_hex: "#ffffff",
            letter_spacing: null,
          },
          reading_order: 1,
          confidence: 0.9,
          source: "document_ai",
        },
      ],
    };
    const qa = compareCarouselOutputText(intended, detected);
    expect(qa.expected_text_present).toBe(true);
    expect(qa.forbidden_text_hits).toContain("Fashion Nova");
    expect(qa.text_check_pass).toBe(false);
  });
});
