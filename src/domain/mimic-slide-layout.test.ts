import { describe, expect, it } from "vitest";
import {
  buildArtOnlySafeZoneHint,
  parseMimicTextBlocks,
  slidePreferHbsTextOverlay,
  textPlacementFromSlide,
} from "./mimic-slide-layout.js";

describe("mimic-slide-layout", () => {
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

  it("buildArtOnlySafeZoneHint reserves lower area when blocks sit low", () => {
    const hint = buildArtOnlySafeZoneHint({
      text_blocks: [
        { text: "Caption", bbox_norm: { x: 0.1, y: 0.7, w: 0.8, h: 0.1 } },
      ],
    });
    expect(hint).toMatch(/do not render any letters/i);
    expect(hint).toMatch(/lower/i);
  });
});
