import { describe, expect, it } from "vitest";
import {
  mimicTemplateLibraryObjectPath,
  referenceIndexForTemplateSlot,
  resolveTemplateStorageDecision,
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

describe("mimicTemplateLibraryObjectPath", () => {
  it("uses project and insights id in path", () => {
    expect(mimicTemplateLibraryObjectPath("proj-1", "ins_abc", "body")).toMatch(
      /^mimic_template_library\/proj-1\/ins_abc\/body_v1\.png$/
    );
  });
});
