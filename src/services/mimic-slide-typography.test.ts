import { describe, expect, it } from "vitest";
import {
  buildMimicDocAiRenderTextLayers,
  inferMimicCarouselTheme,
  isDarkCelestialDeck,
  isDarkVisualDeck,
  mimicPayloadHasDocAiTextLayout,
  mimicSlideLayoutPatch,
  mimicSlideThemePatch,
  mimicSlideTypographyPatch,
  parseRelativeScaleHeadlinePx,
} from "./mimic-slide-typography.js";

describe("mimic-slide-typography", () => {
  it("detects dark celestial decks from deck_visual_system", () => {
    expect(
      isDarkCelestialDeck({
        deck_visual_system: {
          overall_aesthetic: "dark, celestial, reflective",
          repeated_template: "centered text over celestial backgrounds",
        },
      })
    ).toBe(true);
  });

  it("maps relative_scale tiers to headline px", () => {
    expect(parseRelativeScaleHeadlinePx("headline lg vs slide")).toBe(80);
    expect(parseRelativeScaleHeadlinePx("12% of slide height")).toBe(120);
  });

  it("centers text when deck says centered text over backgrounds", () => {
    const layout = mimicSlideLayoutPatch(
      {
        deck_visual_system: {
          repeated_template: "centered text over celestial backgrounds; similar layout across slides",
        },
      },
      2
    );
    expect(layout.mimic_text_align).toBe("center");
    expect(layout.mimic_page_justify).toBe("center");
  });

  it("uses Nemotron text_blocks font_size_px when present", () => {
    const patch = mimicSlideTypographyPatch(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              typography: { relative_scale: "md" },
              text_blocks: [
                {
                  text: "ARIES",
                  role: "title",
                  bbox_norm: { x: 0.2, y: 0.35, w: 0.6, h: 0.12 },
                  font_size_px: 92,
                },
                {
                  text: "Born to roam",
                  role: "subtitle",
                  bbox_norm: { x: 0.15, y: 0.5, w: 0.7, h: 0.08 },
                  font_size_px: 44,
                },
              ],
            },
          ],
        },
      },
      1,
      2
    );
    expect(patch.carousel_headline_font_px).toBe(92);
    expect(patch.carousel_body_font_px).toBe(44);
  });

  it("derives typography patch from per-slide vision analysis", () => {
    const patch = mimicSlideTypographyPatch(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              typography: {
                relative_scale: "lg",
                text_placement: "center band",
              },
            },
          ],
          deck_visual_system: { overall_aesthetic: "dark, celestial" },
        },
      },
      1,
      3
    );
    expect(patch.carousel_headline_font_px).toBe(80);
    expect(patch.carousel_body_font_px).toBeGreaterThan(30);
    expect(patch.mimic_text_align).toBe("center");
  });

  it("detects dark silhouette decks from deck_visual_system", () => {
    expect(
      isDarkVisualDeck({
        deck_visual_system: {
          overall_aesthetic: "monochromatic silhouette, romantic",
          repeated_template: "centered text over photo backgrounds",
        },
      })
    ).toBe(true);
  });

  it("defaults to light text when vision is ambiguous (template_bg photo plates)", () => {
    const theme = inferMimicCarouselTheme({});
    expect(theme.ink).toBe("#f5f5f7");
    expect(theme.body).toBe("#e8e8ed");
  });

  it("forces light text when vision reports dark bg and dark text", () => {
    const theme = inferMimicCarouselTheme({
      slides: [
        {
          slide_index: 1,
          color_tokens: { background: "#111111", primary_text: "#222222" },
        },
      ],
    });
    expect(theme.ink).toBe("#f5f5f7");
  });

  it("exposes theme patch for renderer CSS injection", () => {
    const patch = mimicSlideThemePatch({
      visual_guideline: { deck_visual_system: { overall_aesthetic: "dark moody" } },
    });
    expect(patch.carousel_ink).toBe("#f5f5f7");
    expect(patch.carousel_text_shadow_headline).toContain("rgba(0,0,0");
  });

  it("detects Document AI layout on reference slides", () => {
    expect(
      mimicPayloadHasDocAiTextLayout({
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [{ text: "Hi", role: "title", source: "document_ai", bbox_norm: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 } }],
            },
          ],
        },
      })
    ).toBe(true);
    expect(mimicPayloadHasDocAiTextLayout({ visual_guideline: { slides: [{ slide_index: 1 }] } })).toBe(false);
  });

  it("buildMimicDocAiRenderTextLayers maps LLM copy onto Document AI geometry with px coords", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "OLD TITLE",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.12, y: 0.18, w: 0.76, h: 0.14 },
                  font_size_px: 88,
                  color_hex: "#ffffff",
                  font_weight: "700",
                  font_family: "SANS_SERIF",
                },
                {
                  text: "old body line",
                  role: "body",
                  source: "document_ai",
                  bbox_norm: { x: 0.1, y: 0.55, w: 0.8, h: 0.2 },
                  font_size_px: 40,
                  color_hex: "#eeeeee",
                },
              ],
            },
          ],
        },
      },
      1,
      { headline: "Fresh headline", body: "Fresh body copy" },
      { ink: "#ffffff", body: "#e8e8ed" }
    );
    expect(layers).toHaveLength(2);
    expect(layers[0]?.text).toBe("Fresh headline");
    expect(layers[0]?.x_px).toBe(130);
    expect(layers[0]?.y_px).toBe(243);
    expect(layers[0]?.w_px).toBe(821);
    expect(layers[0]?.h_px).toBe(189);
    expect(layers[0]?.layout_mode).toBe("single_line");
    expect(layers[0]?.css_style).toContain("left:130px");
    expect(layers[0]?.css_style).toContain("height:189px");
    expect(layers[0]?.css_style).toContain("font-size:");
    expect(layers[0]?.color_hex).toBe("#ffffff");
    expect(layers[1]?.text).toBe("Fresh body copy");
    expect(layers[1]?.y_px).toBe(743);
    expect(layers[1]?.layout_mode).toBe("single_line");
  });

  it("prefers document_ai_ocr_v1 text_layers geometry over text_blocks", () => {
    const layers = buildMimicDocAiRenderTextLayers(
      {
        visual_guideline: {
          slides: [
            {
              slide_index: 1,
              text_blocks: [
                {
                  text: "OLD",
                  role: "headline",
                  source: "document_ai",
                  bbox_norm: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
                },
              ],
              document_ai_ocr_v1: {
                text_layers: [
                  {
                    text: "OLD",
                    bbox_pct: { x: 0.1, y: 0.2, w: 0.8, h: 0.12 },
                    font: { size_px: 72, color_hex: "#ff0000" },
                    alignment: "center",
                  },
                ],
              },
            },
          ],
        },
      },
      1,
      { headline: "New headline" }
    );
    expect(layers[0]?.x_px).toBe(108);
    expect(layers[0]?.text_align).toBe("center");
    expect(layers[0]?.color_hex).toBe("#ff0000");
  });
});
