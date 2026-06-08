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

  it("parses minimal Document AI page with normalizedVertices", () => {
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
    expect(ocr.token_count).toBe(1);
    expect(ocr.text_layers[0]?.bbox_pct.x).toBeCloseTo(0.1, 2);
    expect(ocr.canvas_width_px).toBe(1080);
  });

  it("parses tokens with pixel vertices normalized by page dimension", () => {
    const ocr = parseDocumentAiResponseToSlideOcr(
      {
        text: "Aries in June",
        pages: [
          {
            dimension: { width: 1080, height: 1350 },
            tokens: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: 0, endIndex: 13 }],
                  },
                  boundingPoly: {
                    vertices: [
                      { x: 108, y: 135 },
                      { x: 972, y: 135 },
                      { x: 972, y: 270 },
                      { x: 108, y: 270 },
                    ],
                  },
                  confidence: 0.93,
                },
                styleInfo: {
                  pixelFontSize: 48,
                  fontType: "SANS_SERIF",
                  bold: true,
                },
              },
            ],
          },
        ],
      },
      1
    );
    expect(ocr.token_count).toBe(1);
    expect(ocr.text_layers.length).toBe(1);
    expect(ocr.text_layers[0]?.text).toBe("Aries in June");
    expect(ocr.text_layers[0]?.bbox_pct).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.8,
      h: 0.1,
    });
  });

  it("falls back to lines when tokens are missing", () => {
    const ocr = parseDocumentAiResponseToSlideOcr(
      {
        text: "Line one\nLine two",
        pages: [
          {
            dimension: { width: 1080, height: 1350 },
            lines: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: 0, endIndex: 8 }],
                  },
                  boundingPoly: {
                    vertices: [
                      { x: 100, y: 200 },
                      { x: 500, y: 200 },
                      { x: 500, y: 260 },
                      { x: 100, y: 260 },
                    ],
                  },
                  confidence: 0.91,
                },
              },
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: 9, endIndex: 17 }],
                  },
                  boundingPoly: {
                    vertices: [
                      { x: 100, y: 300 },
                      { x: 500, y: 300 },
                      { x: 500, y: 360 },
                      { x: 100, y: 360 },
                    ],
                  },
                  confidence: 0.89,
                },
              },
            ],
          },
        ],
      },
      2
    );
    expect(ocr.token_count).toBe(2);
    expect(ocr.text_layers.length).toBe(2);
    expect(ocr.text_layers[0]?.text).toBe("Line one");
    expect(ocr.text_layers[1]?.text).toBe("Line two");
    expect(ocr.text_layers[0]?.bbox_pct.y).toBeCloseTo(200 / 1350, 3);
  });

  it("falls back to paragraphs when tokens and lines are missing", () => {
    const ocr = parseDocumentAiResponseToSlideOcr(
      {
        text: "Paragraph body",
        pages: [
          {
            dimension: { width: 1080, height: 1350 },
            paragraphs: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: 0, endIndex: 14 }],
                  },
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0.15, y: 0.4 },
                      { x: 0.85, y: 0.4 },
                      { x: 0.85, y: 0.55 },
                      { x: 0.15, y: 0.55 },
                    ],
                  },
                  confidence: 0.88,
                },
              },
            ],
          },
        ],
      },
      3
    );
    expect(ocr.token_count).toBe(1);
    expect(ocr.text_layers[0]?.text).toBe("Paragraph body");
    expect(ocr.text_layers[0]?.bbox_pct.w).toBeCloseTo(0.7, 2);
  });

  it("parses real API string indices on textSegments", () => {
    const ocr = parseDocumentAiResponseToSlideOcr(
      {
        text: "how it feels to be an\naries (without context)\n@glossy_zodiac\nrage is consuming me\n",
        pages: [
          {
            dimension: { width: 1080, height: 1350, unit: "pixels" },
            tokens: [
              {
                layout: {
                  textAnchor: { textSegments: [{ endIndex: "4" }] },
                  confidence: 0.9785707,
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0.2638889, y: 0.4437037 },
                      { x: 0.36666667, y: 0.4437037 },
                      { x: 0.36666667, y: 0.48222223 },
                      { x: 0.2638889, y: 0.48222223 },
                    ],
                  },
                },
                styleInfo: { pixelFontSize: 53, fontType: "SANS_SERIF", fontWeight: 453 },
              },
              {
                layout: {
                  textAnchor: { textSegments: [{ startIndex: "4", endIndex: "7" }] },
                  confidence: 0.98534894,
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0.38333333, y: 0.4437037 },
                      { x: 0.41111112, y: 0.4437037 },
                      { x: 0.41111112, y: 0.48222223 },
                      { x: 0.38333333, y: 0.48222223 },
                    ],
                  },
                },
                styleInfo: { pixelFontSize: 53, fontType: "SANS_SERIF" },
              },
            ],
          },
        ],
      },
      1
    );
    expect(ocr.token_count).toBe(2);
    expect(ocr.text_layers.length).toBeGreaterThan(0);
    expect(ocr.text_layers[0]?.text).toContain("how");
    expect(ocr.text_layers[0]?.bbox_pct.x).toBeCloseTo(0.26, 2);
  });
});
