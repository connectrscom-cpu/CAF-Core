import { describe, expect, it } from "vitest";
import { groupTokensIntoTextLayers, parseDocumentAiResponseToSlideOcr } from "./document-ai-response-parse.js";

describe("document-ai-response-parse", () => {
  it("groups tokens into text layers", () => {
    const layers = groupTokensIntoTextLayers([
      {
        text: "Hello",
        confidence: 0.9,
        bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 },
        font: {
          family_detected: "SANS_SERIF",
          size_px: 48,
          weight: 700,
          bold: true,
          italic: null,
          underline: null,
          color_hex: "#111111",
          background_color_hex: "#ffffff",
          letter_spacing: null,
        },
        centerY: 0.125,
        centerX: 0.25,
      },
      {
        text: "World",
        confidence: 0.88,
        bbox: { x: 0.45, y: 0.1, w: 0.3, h: 0.05 },
        font: {
          family_detected: "SANS_SERIF",
          size_px: 48,
          weight: 700,
          bold: true,
          italic: null,
          underline: null,
          color_hex: "#111111",
          background_color_hex: "#ffffff",
          letter_spacing: null,
        },
        centerY: 0.125,
        centerX: 0.6,
      },
    ]);
    expect(layers.length).toBe(1);
    expect(layers[0]?.text).toContain("Hello");
    expect(layers[0]?.font.size_px).toBe(48);
  });

  it("parses minimal Document AI page", () => {
    const ocr = parseDocumentAiResponseToSlideOcr(
      {
        text: "Hook line\nBody line",
        pages: [
          {
            dimension: { width: 1080, height: 1350 },
            tokens: [
              {
                layout: {
                  textAnchor: { content: "Hook line" },
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0.1, y: 0.1 },
                      { x: 0.9, y: 0.1 },
                      { x: 0.9, y: 0.2 },
                      { x: 0.1, y: 0.2 },
                    ],
                  },
                },
                styleInfo: {
                  pixelFontSize: 52,
                  fontType: "SANS_SERIF",
                  bold: true,
                  textColor: { red: 0, green: 0, blue: 0 },
                },
                confidence: 0.95,
              },
            ],
          },
        ],
      },
      1
    );
    expect(ocr.slide_index).toBe(1);
    expect(ocr.full_text).toContain("Hook");
    expect(ocr.text_layers.length).toBeGreaterThan(0);
    expect(ocr.canvas_width_px).toBe(1080);
  });
});
