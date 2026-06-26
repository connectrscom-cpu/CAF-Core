import { describe, expect, it } from "vitest";
import {
  assertMimicCarouselCopySlideCount,
  assertMimicSlideBackgroundPresent,
  buildSlideIntentInstruction,
  countRenderableMimicCarouselSlides,
  effectiveMimicSlideRenderMode,
  expectedMimicCarouselOutputSlideCount,
  filterPromotionalSlidesFromMimicPayload,
  filterSlideCopyLayoutForMimic,
  isExcessiveOnScreenTextSlide,
  isFullBleedCandidateSlide,
  isPromotionalSlide,
  MimicCarouselCopySlideCountError,
  mimicCarouselNeedsBackgroundPlate,
  reconcileFullBleedSlidePlansAtRender,
  reconcileMimicPayloadToOutputSlideCount,
  resolveMimicCarouselRenderSlideCount,
  contentSourceSlideIndicesForMimic,
  referenceItemForMimicSlide,
  pickStoredMimicPlateUrl,
  requireMimicSlideBackgroundPlate,
  slideMimicRenderMode,
  slideVisionHints,
  targetMimicCarouselCopySlideCount,
} from "./mimic-carousel-render.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

function baseMimic(visualGuideline: Record<string, unknown>): MimicPayloadV1 {
  return {
    schema_version: 1,
    mode: "carousel_visual",
    classified_at: "2026-01-01T00:00:00.000Z",
    source_insights_id: "ins_a",
    analysis_tier: "top_performer_carousel",
    reference_items: [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/a.jpg",
      },
    ],
    twist_brief: { visual_only: true, legal_note: "pattern only" },
    visual_guideline: visualGuideline,
  };
}

describe("slideVisionHints", () => {
  it("reads layout and visual cues from visual_guideline.slides", () => {
    const mimic = baseMimic({
      slides: [
        {
          slide_index: 2,
          layout_template: "center stack",
          visual_description: "Soft gradient with icon row",
        },
      ],
    });
    expect(slideVisionHints(mimic, 2)).toEqual({
      layout: "center stack",
      visual: "Soft gradient with icon row",
    });
  });

  it("returns empty hints when slide metadata is missing", () => {
    expect(slideVisionHints(baseMimic({ slides: null }), 1)).toEqual({});
  });
});

describe("mimicCarouselNeedsBackgroundPlate", () => {
  it("skips bg extract for full-bleed carousel_visual decks", () => {
    const mimic = baseMimic({});
    mimic.slide_plans = [
      { slide_index: 1, reference_index: 1, render_mode: "full_bleed" },
      { slide_index: 2, reference_index: 2, render_mode: "full_bleed" },
    ];
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(false);
  });

  it("requires bg plate for template_bg and hbs slides", () => {
    const mimic = baseMimic({});
    mimic.mode = "template_bg";
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(true);

    mimic.mode = "carousel_visual";
    mimic.slide_plans = [{ slide_index: 3, reference_index: 1, render_mode: "hbs" }];
    expect(mimicCarouselNeedsBackgroundPlate(mimic)).toBe(true);
  });
});

describe("isPromotionalSlide and full-bleed eligibility", () => {
  it("always skips video slides (payload indices, file role, or archived video)", () => {
    const mimic = baseMimic({});
    mimic.visual_guideline = { video_slide_indices: [2] };
    mimic.reference_items = [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/s1.jpg",
        source_slide_index: 1,
      },
      {
        index: 2,
        role: "carousel_slide",
        vision_fetch_url: "https://example.com/s3.jpg",
        source_slide_index: 3,
      },
    ];
    expect(isPromotionalSlide(mimic, 1)).toBe(false);
    expect(isPromotionalSlide(mimic, 2)).toBe(false);

    mimic.reference_items[1] = {
      index: 2,
      role: "carousel_slide",
      vision_fetch_url: "https://example.com/s2.jpg",
      source_slide_index: 2,
    };
    expect(isPromotionalSlide(mimic, 2)).toBe(true);
    expect(isFullBleedCandidateSlide(mimic, 2)).toBe(false);

    const videoFile = baseMimic({});
    videoFile.reference_items = [
      {
        index: 1,
        role: "carousel_slide",
        vision_fetch_url: "https://cdn.example.com/clip.mp4",
        content_type: "video/mp4",
      },
    ];
    expect(isPromotionalSlide(videoFile, 1)).toBe(true);
  });

  it("flags app sponsor slides (cash back, link in bio, app name)", () => {
    const mimic = baseMimic({
      slides: [
        {
          slide_index: 4,
          on_screen_text_transcript: "and now for my latest obsession: FRANKI APP",
          text_blocks: [
            { text: "earn $$ for going out to eat!", role: "cta" },
            { text: "use my link in bio to get 10% cash back", role: "cta" },
          ],
          slide_purpose: "content",
          brand_specificity: "low",
        },
      ],
    });
    expect(isPromotionalSlide(mimic, 4)).toBe(true);
  });

  it("isExcessiveOnScreenTextSlide flags transcript + text_blocks over 600 chars", () => {
    const short = "x".repeat(600);
    const long = "y".repeat(601);
    const mimicShort = baseMimic({
      slides: [{ slide_index: 1, on_screen_text_transcript: short, slide_purpose: "content" }],
    });
    const mimicLong = baseMimic({
      slides: [
        {
          slide_index: 2,
          on_screen_text_transcript: "hook",
          text_blocks: [{ text: long, role: "body", x: 0.1, y: 0.5, w: 0.8, h: 0.2 }],
          slide_purpose: "content",
        },
      ],
    });
    expect(isExcessiveOnScreenTextSlide(mimicShort, 1)).toBe(false);
    expect(isExcessiveOnScreenTextSlide(mimicLong, 2)).toBe(true);
  });

  it("filterPromotionalSlidesFromMimicPayload keeps nemotron-only dense text but switches to hbs", () => {
    const mimic = baseMimic({
      slides: [
        { slide_index: 1, on_screen_text_transcript: "short hook", slide_purpose: "content" },
        {
          slide_index: 2,
          on_screen_text_transcript: "a".repeat(601),
          slide_purpose: "content",
        },
        { slide_index: 3, on_screen_text_transcript: "another short", slide_purpose: "content" },
      ],
    });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg" },
    ];
    const { mimic: out, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(removed_slide_indices).toEqual([]);
    expect(out.reference_items).toHaveLength(3);
    expect(out.slide_plans).toHaveLength(3);
    expect(out.slide_plans?.[1]?.render_mode).toBe("hbs");
  });

  it("filterPromotionalSlidesFromMimicPayload keeps Document AI dense text slides and switches to hbs", () => {
    const mimic = baseMimic({
      slides: [
        { slide_index: 1, on_screen_text_transcript: "short hook", slide_purpose: "content" },
        {
          slide_index: 2,
          on_screen_text_transcript: "short nemotron stub",
          slide_purpose: "content",
          document_ai_ocr_v1: {
            schema_version: "document_ai_ocr_v1",
            slide_index: 2,
            full_text: "p".repeat(601),
            text_layers: [],
            token_count: 12,
          },
        },
        { slide_index: 3, on_screen_text_transcript: "another short", slide_purpose: "content" },
      ],
    });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg", source_slide_index: 2 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg", source_slide_index: 3 },
    ];
    const { mimic: out, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(removed_slide_indices).toEqual([]);
    expect(out.reference_items).toHaveLength(3);
    expect(out.slide_plans?.[1]?.render_mode).toBe("hbs");
  });

  it("filterPromotionalSlidesFromMimicPayload ignores Nemotron skip_slide_indices", () => {
    const mimic = baseMimic({
      mimic_evaluation: {
        skip_slide_indices: [1, 3, 5],
        skip_reason: "text overlay mismatch",
        content_slide_indices: [],
      },
      slides: [
        { slide_index: 1, on_screen_text_transcript: "aries with a crush", slide_purpose: "content" },
        { slide_index: 2, on_screen_text_transcript: "taurus with a crush", slide_purpose: "content" },
        { slide_index: 3, on_screen_text_transcript: "gemini with a crush", slide_purpose: "content" },
      ],
    });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg", source_slide_index: 2 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg", source_slide_index: 3 },
    ];
    const { removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(removed_slide_indices).toEqual([]);
  });

  it("filterPromotionalSlidesFromMimicPayload removes promo frames and renumbers", () => {
    const mimic = baseMimic({
      slides: [
        { slide_index: 1, on_screen_text_transcript: "aries as food", slide_purpose: "content" },
        {
          slide_index: 2,
          on_screen_text_transcript: "use my link in bio for cash back",
          slide_purpose: "self_promo",
        },
        { slide_index: 3, on_screen_text_transcript: "taurus as food", slide_purpose: "content" },
      ],
    });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg" },
    ];
    const { mimic: out, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(removed_slide_indices).toEqual([2]);
    expect(out.reference_items).toHaveLength(2);
    expect(out.reference_items[0]?.source_slide_index).toBe(1);
    expect(out.reference_items[1]?.source_slide_index).toBe(3);
    expect(out.reference_items).toHaveLength(2);
    expect(out.slide_plans).toHaveLength(2);
    expect(out.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("filterPromotionalSlidesFromMimicPayload removes promo frames for template_bg decks too", () => {
    const mimic = baseMimic({
      slides: [
        { slide_index: 1, on_screen_text_transcript: "aries as food", slide_purpose: "content" },
        {
          slide_index: 2,
          on_screen_text_transcript: "Available now & delivered immediately as a PDF",
          slide_purpose: "product_pitch",
          brand_specificity: "high",
        },
        { slide_index: 3, on_screen_text_transcript: "taurus as food", slide_purpose: "content" },
      ],
    });
    mimic.mode = "template_bg";
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg" },
    ];

    const { mimic: out, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(removed_slide_indices).toEqual([2]);
    expect(out.reference_items).toHaveLength(2);
    expect(out.reference_items[0]?.source_slide_index).toBe(1);
    expect(out.reference_items[1]?.source_slide_index).toBe(3);
    expect(out.slide_plans).toHaveLength(2);
    expect(out.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
  });

  it("flags product-pitch transcript and PDF promos", () => {
    const mimic = baseMimic({
      slides: [
        {
          slide_index: 3,
          on_screen_text_transcript: "Available now & delivered immediately as a PDF",
          slide_purpose: "content",
          brand_specificity: "low",
        },
        {
          slide_index: 8,
          visual_description: "laptop product mockup with guide cover",
          slide_purpose: "product_pitch",
          brand_specificity: "high",
        },
      ],
    });
    expect(isPromotionalSlide(mimic, 3)).toBe(true);
    expect(isPromotionalSlide(mimic, 8)).toBe(true);
    expect(isFullBleedCandidateSlide(mimic, 3)).toBe(false);
  });

  it("keeps full_bleed for all non-promotional carousel_visual slides", () => {
    const mimic = baseMimic({
      format_pattern: "mixed",
      deck_visual_system: { overall_aesthetic: "cartoonish illustration with magical effects" },
      slides: null,
    });
    expect(isFullBleedCandidateSlide(mimic, 1)).toBe(true);
    expect(isFullBleedCandidateSlide(mimic, 2)).toBe(true);
    const reconciled = reconcileFullBleedSlidePlansAtRender({
      ...mimic,
      slide_plans: [
        { slide_index: 1, reference_index: 1, render_mode: "full_bleed" },
        { slide_index: 2, reference_index: 2, render_mode: "full_bleed" },
      ],
    });
    expect(slideMimicRenderMode(reconciled, 1)).toBe("full_bleed");
    expect(slideMimicRenderMode(reconciled, 2)).toBe("full_bleed");
    expect(mimicCarouselNeedsBackgroundPlate(reconciled)).toBe(false);
  });
});

describe("effectiveMimicSlideRenderMode", () => {
  it("keeps full_bleed when LLM copy exists (visual plate + HBS composite)", () => {
    const mimic = baseMimic({
      slides: [{ slide_index: 1, on_screen_text_transcript: "", text_density: "low" }],
    });
    mimic.slide_plans = [{ slide_index: 1, reference_index: 1, render_mode: "full_bleed" }];
    expect(
      effectiveMimicSlideRenderMode(mimic, 1, true, {
        generatedSlides: [{ headline: "New hook", body: "Fresh body" }],
      })
    ).toBe("full_bleed");
  });

  it("downgrades full_bleed to hbs when visual gen is unreachable", () => {
    const mimic = baseMimic({});
    mimic.slide_plans = [{ slide_index: 1, reference_index: 1, render_mode: "full_bleed" }];
    expect(effectiveMimicSlideRenderMode(mimic, 1, false)).toBe("hbs");
  });
});

describe("referenceItemForMimicSlide", () => {
  it("resolves 0-based archived indexes and cycles for extended decks", () => {
    const mimic = baseMimic({});
    mimic.reference_items = [
      { index: 0, role: "carousel_slide", vision_fetch_url: "https://example.com/s1.jpg" },
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/s2.jpg" },
    ];
    expect(referenceItemForMimicSlide(mimic, 1)?.vision_fetch_url).toContain("s1.jpg");
    expect(referenceItemForMimicSlide(mimic, 2)?.vision_fetch_url).toContain("s2.jpg");
    expect(referenceItemForMimicSlide(mimic, 3)?.vision_fetch_url).toContain("s1.jpg");
  });

  it("maps slide 11 and 12 to distinct references when duplicate index tags exist", () => {
    const mimic = baseMimic({});
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_01.jpg" },
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_02.jpg" },
      { index: 11, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_11.jpg" },
      { index: 11, role: "carousel_slide", vision_fetch_url: "https://example.com/slide_12.jpg" },
    ];
    mimic.slide_plans = [
      { slide_index: 11, reference_index: 11, render_mode: "full_bleed" },
      { slide_index: 12, reference_index: 12, render_mode: "full_bleed" },
    ];
    expect(referenceItemForMimicSlide(mimic, 11)?.vision_fetch_url).toContain("slide_11");
    expect(referenceItemForMimicSlide(mimic, 12)?.vision_fetch_url).toContain("slide_12");
  });
});

describe("requireMimicSlideBackgroundPlate", () => {
  it("throws when no reference item and no stored plate", async () => {
    const mimic = baseMimic({});
    mimic.mode = "template_bg";
    mimic.reference_items = [];
    await expect(
      requireMimicSlideBackgroundPlate({ query: async () => ({ rows: [] }) } as any, {} as any, {
        id: "j1",
        task_id: "TASK_1",
        project_id: "p1",
        run_id: "r1",
      }, mimic, 1)
    ).rejects.toThrow(/Mimic carousel render blocked/);
  });
});

describe("filterSlideCopyLayoutForMimic", () => {
  it("keeps first output row when source slide 1 is skipped (no source/output index mix-up)", () => {
    const mimic = baseMimic({
      mimic_evaluation: {
        content_slide_indices: [2, 3, 4, 5],
        skip_slide_indices: [1],
      },
      slides: [
        { slide_index: 1, on_screen_text_transcript: "your aries friend" },
        { slide_index: 2, on_screen_text_transcript: "your taurus friend" },
        { slide_index: 3, on_screen_text_transcript: "your gemini friend" },
        { slide_index: 4, on_screen_text_transcript: "your cancer friend" },
      ],
    });
    mimic.mode = "carousel_visual";
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg", source_slide_index: 2 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/3.jpg", source_slide_index: 3 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://x/4.jpg", source_slide_index: 4 },
    ];
    const layout = [
      { slide_index: 1, reference_on_screen_text: "your taurus friend" },
      { slide_index: 2, reference_on_screen_text: "your gemini friend" },
      { slide_index: 3, reference_on_screen_text: "your cancer friend" },
    ];
    const filtered = filterSlideCopyLayoutForMimic(mimic, layout);
    expect(filtered).toHaveLength(3);
    expect(filtered[0]?.reference_on_screen_text).toContain("taurus");
    expect(filtered[1]?.reference_on_screen_text).toContain("gemini");
  });
});

describe("expectedMimicCarouselOutputSlideCount and reconcileMimicPayloadToOutputSlideCount", () => {
  it("resolveMimicCarouselRenderSlideCount keeps planned target when LLM under-delivers", () => {
    const mimic = baseMimic({ slides: [{ slide_index: 1, on_screen_text_transcript: "a" }] });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg" },
    ];
    expect(
      resolveMimicCarouselRenderSlideCount({
        mimic,
        plannedTarget: 6,
        llmRenderableCount: 4,
      })
    ).toBe(6);
    expect(
      resolveMimicCarouselRenderSlideCount({
        mimic,
        plannedTarget: null,
        llmRenderableCount: 4,
      })
    ).toBe(4);
  });

  it("maps expanded slides through content source indices when promo frame is omitted", () => {
    const mimic = baseMimic({
      slides: [
        { slide_index: 1, on_screen_text_transcript: "aries", slide_purpose: "content" },
        {
          slide_index: 2,
          on_screen_text_transcript: "use my link in bio for cash back",
          slide_purpose: "self_promo",
        },
        { slide_index: 3, on_screen_text_transcript: "taurus", slide_purpose: "content" },
      ],
    });
    mimic.archive_reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2promo.jpg", source_slide_index: 2 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://example.com/3.jpg", source_slide_index: 3 },
    ];
    mimic.reference_items = [mimic.archive_reference_items[0]!];
    expect(contentSourceSlideIndicesForMimic(mimic, 2)).toEqual([1, 3]);
    const reconciled = reconcileMimicPayloadToOutputSlideCount(mimic, 2);
    expect(reconciled.reference_items[1]?.vision_fetch_url).toContain("/3.jpg");
    expect(reconciled.reference_items[1]?.source_slide_index).toBe(3);
    expect(reconciled.slide_plans?.[1]?.source_slide_index).toBe(3);
  });

  it("expands reference items when LLM copy exceeds stored references", () => {
    const mimic = baseMimic({});
    mimic.archive_reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg", source_slide_index: 2 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://example.com/3.jpg", source_slide_index: 3 },
      { index: 4, role: "carousel_slide", vision_fetch_url: "https://example.com/4.jpg", source_slide_index: 4 },
    ];
    mimic.reference_items = [mimic.archive_reference_items[0]!];
    expect(expectedMimicCarouselOutputSlideCount(mimic, 4)).toBe(4);
    const reconciled = reconcileMimicPayloadToOutputSlideCount(mimic, 4);
    expect(reconciled.reference_items).toHaveLength(4);
    expect(reconciled.reference_items[3]?.vision_fetch_url).toContain("/4.jpg");
    expect(reconciled.slide_plans).toHaveLength(4);
  });

  it("trims reference items when LLM copy is shorter than references", () => {
    const mimic = baseMimic({});
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg" },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://example.com/3.jpg" },
      { index: 4, role: "carousel_slide", vision_fetch_url: "https://example.com/4.jpg" },
    ];
    expect(expectedMimicCarouselOutputSlideCount(mimic, 2)).toBe(2);
    const reconciled = reconcileMimicPayloadToOutputSlideCount(mimic, 2);
    expect(reconciled.reference_items).toHaveLength(2);
    expect(reconciled.slide_plans).toHaveLength(2);
    expect(reconciled.slide_plans?.[1]?.slide_index).toBe(2);
  });

  it("keeps template_bg slide plans on hbs when trimming references", () => {
    const mimic = baseMimic({});
    mimic.mode = "template_bg";
    mimic.slide_plans = [
      { slide_index: 1, reference_index: 1, render_mode: "hbs" },
      { slide_index: 2, reference_index: 2, render_mode: "hbs" },
    ];
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg", source_slide_index: 2 },
    ];
    const reconciled = reconcileMimicPayloadToOutputSlideCount(mimic, 1);
    expect(reconciled.slide_plans?.[0]?.render_mode).toBe("hbs");
  });

  it("keeps all text slides when content_slide_indices is a narrow subset", () => {
    const mimic = baseMimic({
      mimic_evaluation: {
        content_slide_indices: [1, 3],
        skip_slide_indices: [],
      },
      slides: [
        { slide_index: 1, on_screen_text_transcript: "one" },
        { slide_index: 2, on_screen_text_transcript: "promo" },
        { slide_index: 3, on_screen_text_transcript: "three" },
        { slide_index: 4, on_screen_text_transcript: "four" },
      ],
    });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg", source_slide_index: 1 },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg", source_slide_index: 2 },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://example.com/3.jpg", source_slide_index: 3 },
      { index: 4, role: "carousel_slide", vision_fetch_url: "https://example.com/4.jpg", source_slide_index: 4 },
    ];
    const { mimic: filtered, removed_slide_indices } = filterPromotionalSlidesFromMimicPayload(mimic);
    expect(filtered.reference_items).toHaveLength(4);
    expect(removed_slide_indices).toEqual([]);
  });
});

describe("assertMimicSlideBackgroundPresent", () => {
  it("throws when background_image_url is missing", () => {
    expect(() => assertMimicSlideBackgroundPresent("TASK_1", 2, {})).toThrow(/slide 2/);
  });

  it("passes when background_image_url is set", () => {
    expect(() =>
      assertMimicSlideBackgroundPresent("TASK_1", 1, { background_image_url: "data:image/png;base64,abc" })
    ).not.toThrow();
  });
});

describe("mimic carousel copy slide count", () => {
  it("targetMimicCarouselCopySlideCount reads mimic_render_context.target_slide_count", () => {
    const mimic = baseMimic({ slides: [] });
    mimic.reference_items = [
      { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/1.jpg" },
      { index: 2, role: "carousel_slide", vision_fetch_url: "https://example.com/2.jpg" },
      { index: 3, role: "carousel_slide", vision_fetch_url: "https://example.com/3.jpg" },
      { index: 4, role: "carousel_slide", vision_fetch_url: "https://example.com/4.jpg" },
    ];
    const n = targetMimicCarouselCopySlideCount(
      { mimic_render_context: { target_slide_count: 4 } },
      mimic
    );
    expect(n).toBe(4);
  });

  it("assertMimicCarouselCopySlideCount throws when LLM returns too few slides", () => {
    const payload = { mimic_render_context: { target_slide_count: 4 } };
    const parsed = {
      slides: [
        { headline: "A", body: "First slide body text." },
        { headline: "B", body: "Second slide body text." },
      ],
    };
    expect(() => assertMimicCarouselCopySlideCount(payload, parsed)).toThrow(MimicCarouselCopySlideCountError);
  });

  it("countRenderableMimicCarouselSlides accepts string text_blocks mimic LLM output", () => {
    const body =
      "Full of spirit and energy, the Aries mother is always eager to explore new adventures with her children.";
    const parsed = {
      slides: Array.from({ length: 12 }, (_, i) =>
        i === 0
          ? { text_blocks: ["THE MOTHERS\nOF THE ZODIAC"] }
          : { text_blocks: [body, "@sistersvillage"] }
      ),
    };
    const payload = { mimic_render_context: { target_slide_count: 12 } };
    expect(countRenderableMimicCarouselSlides(parsed, { preferred_slide_count: 12 })).toBe(12);
    expect(() => assertMimicCarouselCopySlideCount(payload, parsed)).not.toThrow();
  });
});

describe("pickStoredMimicPlateUrl", () => {
  const config = {
    SUPABASE_URL: "https://example.supabase.co",
  } as import("../config.js").AppConfig;

  it("prefers MIMIC_BACKGROUND at lookup position", () => {
    const url = pickStoredMimicPlateUrl(
      config,
      [
        {
          asset_type: "MIMIC_BACKGROUND",
          position: 1,
          public_url: "https://cdn.example/bg.png",
          bucket: null,
          object_path: null,
        },
      ],
      1,
      2
    );
    expect(url).toBe("https://cdn.example/bg.png");
  });

  it("falls back to MIMIC_VISUAL_PLATE by slide index", () => {
    const url = pickStoredMimicPlateUrl(
      config,
      [
        {
          asset_type: "MIMIC_VISUAL_PLATE",
          position: 2,
          public_url: "https://cdn.example/plate3.png",
          bucket: null,
          object_path: null,
          metadata_json: { slide_index: 3 },
        },
      ],
      99,
      3
    );
    expect(url).toBe("https://cdn.example/plate3.png");
  });
});

describe("buildSlideIntentInstruction", () => {
  it("always requires art-only output with no readable text for Nemotron-guided prompts", () => {
    const minimal = buildSlideIntentInstruction({
      slidePurpose: null,
      brandSpecificity: null,
      referenceTextLength: 0,
    });
    expect(minimal).toContain("ZERO readable text");
    expect(minimal).toContain("art-only");

    const hook = buildSlideIntentInstruction({
      slidePurpose: "hook",
      brandSpecificity: null,
      referenceTextLength: 12,
    });
    expect(hook).toContain("ZERO readable text");
    expect(hook).toContain("hook/cover slide");
  });
});
