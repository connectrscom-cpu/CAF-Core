import { describe, expect, it } from "vitest";
import {
  extractCarouselSlidesAndTypographyFromOverrideJson,
  mergeCarouselTypographyDefaultsFromPlatformConstraints,
  mergeCarouselTypographyIntoGeneratedOutputRender,
  parseCarouselRenderTypographyPatch,
  pickCarouselTypographyPatch,
  pickCarouselTypographyPatchFromPlatformConstraints,
} from "./carousel-render-typography.js";

describe("carousel-render-typography", () => {
  it("extracts slides and typography from final_slides object", () => {
    const raw = JSON.stringify({
      slides: [{ headline: "A", body: "B" }],
      font_scale: 0.88,
      carousel_headline_font_px: 80,
      carousel_body_font_px: 52,
    });
    const { slides, renderPatch } = extractCarouselSlidesAndTypographyFromOverrideJson(raw);
    expect(slides).toHaveLength(1);
    expect(renderPatch.carousel_headline_font_px).toBe(80);
    expect(renderPatch.carousel_body_font_px).toBe(52);
    expect(renderPatch.font_scale).toBeCloseTo(0.88, 5);
  });

  it("pickCarouselTypographyPatch ignores invalid px", () => {
    expect(
      pickCarouselTypographyPatch({
        carousel_headline_font_px: 700,
        carousel_body_font_px: "48",
        carousel_kicker_font_px: "nope",
      })
    ).toEqual({ carousel_body_font_px: 48 });
  });

  it("mergeCarouselTypographyIntoGeneratedOutputRender writes render slice", () => {
    const gen: Record<string, unknown> = {};
    mergeCarouselTypographyIntoGeneratedOutputRender(gen, { carousel_body_font_px: 44, font_scale: 0.9 });
    expect(gen.render).toEqual({ carousel_body_font_px: 44, font_scale: 0.9 });
  });

  it("pickCarouselTypographyPatchFromPlatformConstraints reads DB-shaped row", () => {
    expect(
      pickCarouselTypographyPatchFromPlatformConstraints({
        carousel_headline_font_px: 72,
        carousel_font_scale: "0.95",
      })
    ).toEqual({ carousel_headline_font_px: 72, font_scale: 0.95 });
  });

  it("mergeCarouselTypographyDefaultsFromPlatformConstraints fills only missing render keys", () => {
    const gen: Record<string, unknown> = {
      render: { carousel_body_font_px: 40 },
    };
    mergeCarouselTypographyDefaultsFromPlatformConstraints(gen, {
      carousel_headline_font_px: 64,
      carousel_body_font_px: 56,
      carousel_font_scale: 1,
    });
    expect(gen.render).toEqual({
      carousel_body_font_px: 40,
      carousel_headline_font_px: 64,
      font_scale: 1,
    });
  });

  it("parseCarouselRenderTypographyPatch clamps font_scale and ignores invalid px", () => {
    expect(
      parseCarouselRenderTypographyPatch({
        font_scale: 2,
        carousel_headline_font_px: 80,
        carousel_body_font_px: "48",
        carousel_kicker_font_px: "nope",
      })
    ).toEqual({ font_scale: 1.25, carousel_headline_font_px: 80, carousel_body_font_px: 48 });
  });
});
