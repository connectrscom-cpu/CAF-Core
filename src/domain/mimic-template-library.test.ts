import { describe, expect, it } from "vitest";
import {
  mimicTemplateLibraryObjectPath,
  referenceIndexForTemplateSlot,
  resolveTemplateStorageDecision,
  templateBgAssetPositionsForSlideIndices,
  templateBgSlideIndicesForSlot,
  templateBgSlidePlanRef,
  templateBgSlotForIndex,
} from "./mimic-template-library.js";

describe("resolveTemplateStorageDecision", () => {
  it("returns reusable for uniform high-replicability text-on-template decks", () => {
    const d = resolveTemplateStorageDecision(
      {
        format_pattern: "listicle",
        aesthetic_analysis_json: {
          mimic_evaluation: {
            recommended_mode: "text_on_template",
            background_replicability: "high",
            template_consistency: "uniform",
            background_description: "flat dark green gradient with subtle grain",
            template_storage_quality: "reusable",
            content_slide_indices: [1, 2, 3, 4],
            skip_slide_indices: [],
          },
          slides: [
            { slide_index: 1, slide_purpose: "hook", brand_specificity: "none" },
            { slide_index: 2, slide_purpose: "listicle_item", brand_specificity: "none" },
          ],
        },
      },
      "template_bg"
    );
    expect(d.quality).toBe("reusable");
    expect(d.eligible_for_library).toBe(true);
    expect(d.pin_project_template).toBe(true);
  });

  it("returns reject for not_suitable", () => {
    const d = resolveTemplateStorageDecision({
      aesthetic_analysis_json: {
        mimic_evaluation: {
          recommended_mode: "not_suitable",
          template_storage_quality: "reject",
        },
      },
    });
    expect(d.quality).toBe("reject");
    expect(d.eligible_for_library).toBe(false);
  });

  it("returns job_only for full_bleed visual decks", () => {
    const d = resolveTemplateStorageDecision(
      {
        aesthetic_analysis_json: {
          mimic_evaluation: {
            recommended_mode: "full_bleed_visual",
            background_replicability: "high",
            template_consistency: "varied",
          },
        },
      },
      "carousel_visual"
    );
    expect(d.quality).toBe("job_only");
    expect(d.eligible_for_library).toBe(false);
  });

  it("downgrades to job_only for theme-specific background descriptions", () => {
    const d = resolveTemplateStorageDecision(
      {
        format_pattern: "listicle",
        aesthetic_analysis_json: {
          mimic_evaluation: {
            recommended_mode: "text_on_template",
            background_replicability: "high",
            template_consistency: "uniform",
            background_description: "zodiac constellation wheel behind text",
          },
        },
      },
      "template_bg"
    );
    expect(d.quality).toBe("job_only");
    expect(d.eligible_for_library).toBe(false);
  });

  it("nemotron reject overrides borderline reusable programmatic score", () => {
    const d = resolveTemplateStorageDecision({
      aesthetic_analysis_json: {
        mimic_evaluation: {
          recommended_mode: "text_on_template",
          background_replicability: "high",
          template_consistency: "uniform",
          template_storage_quality: "reject",
          template_storage_reason: "Branded product mockup frame",
        },
      },
    });
    expect(d.quality).toBe("reject");
  });
});

describe("referenceIndexForTemplateSlot", () => {
  it("skips promotional slides when picking cover source", () => {
    const idx = referenceIndexForTemplateSlot(
      {
        aesthetic_analysis_json: {
          mimic_evaluation: { skip_slide_indices: [1] },
          slides: [
            { slide_index: 1, slide_purpose: "product_pitch", brand_specificity: "high" },
            { slide_index: 2, slide_purpose: "hook", brand_specificity: "none" },
          ],
        },
      },
      "cover",
      3
    );
    expect(idx).toBe(2);
  });
});

describe("templateBgSlotForIndex", () => {
  it("labels cover, body, and cta slots", () => {
    expect(templateBgSlotForIndex(1, 5)).toBe("cover");
    expect(templateBgSlotForIndex(3, 5)).toBe("body");
    expect(templateBgSlotForIndex(5, 5)).toBe("cta");
  });
});

describe("templateBgSlideIndicesForSlot", () => {
  it("returns cover, middle, and cta slide indices for a 12-slide deck", () => {
    expect(templateBgSlideIndicesForSlot("cover", 12)).toEqual([1]);
    expect(templateBgSlideIndicesForSlot("body", 12)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(templateBgSlideIndicesForSlot("cta", 12)).toEqual([12]);
    expect(templateBgAssetPositionsForSlideIndices([2, 11], 12)).toEqual([1]);
    expect(templateBgAssetPositionsForSlideIndices([1, 12], 12)).toEqual([0, 11]);
  });
});

describe("templateBgSlidePlanRef", () => {
  const entry = {
    aesthetic_analysis_json: {
      slides: [
        { slide_index: 1, slide_purpose: "hook" },
        { slide_index: 2, slide_purpose: "listicle_item" },
        { slide_index: 3, slide_purpose: "listicle_item" },
        { slide_index: 4, slide_purpose: "cta" },
      ],
    },
  };

  it("maps uniform template slides to cover/body/cta reference frames", () => {
    const cover = templateBgSlidePlanRef(entry, 1, 4, 4, true);
    const body = templateBgSlidePlanRef(entry, 2, 4, 4, true);
    const cta = templateBgSlidePlanRef(entry, 4, 4, 4, true);
    expect(cover.reference_index).toBe(1);
    expect(body.reference_index).toBe(3);
    expect(cta.reference_index).toBe(4);
    expect(cover.source_slide_index).toBe(1);
    expect(cta.source_slide_index).toBe(4);
  });
});

describe("mimicTemplateLibraryObjectPath", () => {
  it("uses project and insights id in path", () => {
    expect(mimicTemplateLibraryObjectPath("proj-1", "ins_abc", "body")).toMatch(
      /^mimic_template_library\/proj-1\/ins_abc\/body_v1\.png$/
    );
  });
});
