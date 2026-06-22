import { describe, expect, it } from "vitest";
import {
  buildArtOnlySafeZoneHint,
  guidelineSlideIndexForMimicOutput,
  layoutAnchorFromTextBlocks,
  mimicSlideLayoutPatch,
  parseMimicTextBlocks,
  slidePreferHbsTextOverlay,
  textPlacementFromSlide,
} from "./mimic-slide-typography.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

describe("mimic-slide-layout", () => {
  it("parseMimicTextBlocks accepts flat x/y/w/h fields", () => {
    const blocks = parseMimicTextBlocks([
      { text: "Taurus", role: "title", x: 0.1, y: 0.55, w: 0.8, h: 0.12 },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.y).toBeCloseTo(0.55);
  });

  it("layoutAnchorFromTextBlocks places low text toward bottom", () => {
    const layout = layoutAnchorFromTextBlocks([
      { text: "Caption", role: "body", x: 0.1, y: 0.72, w: 0.8, h: 0.1, align: "left", font_size_px: 36, font_weight: null, color_hex: null },
      { text: "Title", role: "title", x: 0.1, y: 0.62, w: 0.8, h: 0.08, align: "left", font_size_px: 72, font_weight: null, color_hex: null },
    ]);
    expect(layout.mimic_page_justify).toBe("flex-end");
    expect(layout.mimic_use_block_positioning).toBe(true);
    expect(layout.mimic_text_y).toBeGreaterThan(0.5);
  });

  it("guidelineSlideIndexForMimicOutput uses source_slide_index after promo filter", () => {
    const mimic: Pick<MimicPayloadV1, "reference_items" | "slide_plans"> = {
      reference_items: [
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg", source_slide_index: 1 },
        { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg", source_slide_index: 3 },
      ],
      slide_plans: [
        { slide_index: 1, render_mode: "full_bleed", reference_index: 1 },
        { slide_index: 2, render_mode: "full_bleed", reference_index: 2 },
      ],
    };
    expect(guidelineSlideIndexForMimicOutput(mimic, 2)).toBe(3);
    const layout = mimicSlideLayoutPatch(
      {
        slides: [
          { slide_index: 3, text_blocks: [{ text: "Low", role: "title", x: 0.2, y: 0.7, w: 0.6, h: 0.1 }] },
        ],
      },
      2,
      3
    );
    expect(layout.mimic_page_justify).toBe("flex-end");
  });

  it("guidelineSlideIndexForMimicOutput prefers slide_plans.source_slide_index over output index", () => {
    const mimic: Pick<MimicPayloadV1, "reference_items" | "slide_plans"> = {
      reference_items: [
        { index: 4, role: "carousel_slide", vision_fetch_url: "https://x/4.jpg", source_slide_index: 4 },
      ],
      slide_plans: [{ slide_index: 4, render_mode: "full_bleed", reference_index: 2, source_slide_index: 2 }],
    };
    expect(guidelineSlideIndexForMimicOutput(mimic, 4)).toBe(2);
  });

  it("parseMimicTextBlocks normalizes bbox_norm fractions", () => {
    const blocks = parseMimicTextBlocks([
      {
        text: "ARIES",
        role: "title",
        align: "center",
        bbox_norm: { x: 0.2, y: 0.4, w: 0.6, h: 0.1 },
        font_size_px: 80,
        color_hex: "#FFFFFF",
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe("ARIES");
    expect(blocks[0]?.font_size_px).toBe(80);
    expect(blocks[0]?.y).toBeCloseTo(0.4);
  });

  it("slidePreferHbsTextOverlay is true when transcript or text_blocks exist", () => {
    expect(slidePreferHbsTextOverlay({ on_screen_text_transcript: "Hook" })).toBe(true);
    expect(
      slidePreferHbsTextOverlay({
        text_blocks: [{ text: "Hi", bbox_norm: { x: 0, y: 0.5, w: 0.5, h: 0.1 } }],
      })
    ).toBe(true);
    expect(slidePreferHbsTextOverlay({ on_screen_text_transcript: "" })).toBe(false);
  });

  it("textPlacementFromSlide infers bottom band from block positions", () => {
    const placement = textPlacementFromSlide({
      text_blocks: [
        { text: "Footer", bbox_norm: { x: 0.1, y: 0.75, w: 0.8, h: 0.08 } },
      ],
    });
    expect(placement).toContain("bottom");
  });

  it("buildArtOnlySafeZoneHint describes OCR overlay regions without numeric coordinates", () => {
    const hint = buildArtOnlySafeZoneHint({
      text_blocks: [{ text: "Caption", bbox_norm: { x: 0.1, y: 0.7, w: 0.8, h: 0.1 } }],
    });
    expect(hint).toContain("low-detail");
    expect(hint).not.toMatch(/\d{1,3}–\d{1,3}%/);
    expect(hint.toLowerCase()).toContain("band");
  });
});
