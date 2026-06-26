import { describe, expect, it } from "vitest";

import type { MimicPayloadV1 } from "./mimic-payload.js";

import type { WhyMimicFluxSlideInput } from "./why-mimic-execution.js";

import { deriveSlideIntelligenceFromAnalysis } from "./slide-intelligence.js";

import {

  auditSlideIntelligenceWhyQuality,

  isMimicFluxAnalysisSufficientForT2i,

  isNaOrPlaceholderAnalysisValue,

  isSlideIntelligenceWhyItWorksSufficient,

  isWhyMimicFluxInputSufficientForT2i,

  mimicSlideHasUsableReference,

  SIL_WHY_IT_WORKS_MIN_CHARS_DEFAULT,
  SIL_VISUAL_DESCRIPTION_MIN_CHARS_DEFAULT,
} from "./mimic-slide-analysis-quality.js";

const LONG_WHY =
  "Opens with sign identity and sets meme expectation for the series. The hook frames the joke format so swipers know the payoff is coming on the next slides.";

const LONG_VISUAL =
  "Warm portrait with soft bokeh background, golden hour rim light, shallow depth of field, and clean negative space along the top third for headline overlay.";



describe("mimic-slide-analysis-quality", () => {

  it("isNaOrPlaceholderAnalysisValue treats N/A and empty as placeholder", () => {

    expect(isNaOrPlaceholderAnalysisValue("")).toBe(true);

    expect(isNaOrPlaceholderAnalysisValue("N/A")).toBe(true);

    expect(isNaOrPlaceholderAnalysisValue("n/a — text only")).toBe(true);

    expect(isNaOrPlaceholderAnalysisValue("Please specify")).toBe(true);

    expect(isNaOrPlaceholderAnalysisValue("Person in golden light")).toBe(false);

  });



  it("isSlideIntelligenceWhyItWorksSufficient enforces minimum length", () => {

    expect(isSlideIntelligenceWhyItWorksSufficient("Short.")).toBe(false);

    expect(

      isSlideIntelligenceWhyItWorksSufficient(

        LONG_WHY

      )

    ).toBe(true);

    expect(isSlideIntelligenceWhyItWorksSufficient("Short.", { whyMinChars: 5 })).toBe(true);

  });



  it("auditSlideIntelligenceWhyQuality flags thin slides", () => {

    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: {
        slides: [
          {
            slide_index: 1,
            slide_purpose: "hook",
            why_it_works: "Please specify",
          },
          {
            slide_index: 2,
            slide_purpose: "body",
            why_it_works:
              "Contrastive humor with absurd astrological traits for virality and social satire in the feed. The beat rewards swipers who stayed after the hook with a shareable punchline that deepens the meme arc.",
          },
        ],
      },
      mediaKind: "carousel",
    });

    const report = auditSlideIntelligenceWhyQuality(bundle)!;

    // derive + enrich replaces placeholder slide 1 with synthesized why/visual
    expect(report.slides_with_sufficient_why).toBe(2);
    expect(report.slides_with_sufficient_visual).toBe(2);
    expect(report.why_min_chars).toBe(SIL_WHY_IT_WORKS_MIN_CHARS_DEFAULT);
    expect(report.visual_min_chars).toBe(SIL_VISUAL_DESCRIPTION_MIN_CHARS_DEFAULT);
  });

  it("auditSlideIntelligenceWhyQuality flags placeholder fields on un-enriched bundles", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: {
        slides: [{ slide_index: 1, slide_purpose: "hook", why_it_works: "Please specify" }],
      },
    })!;
    const raw = {
      ...bundle,
      slides: bundle.slides.map((s) =>
        s.slide_index === 1
          ? { ...s, why_it_works: "Please specify", visual_description: "N/A" }
          : s
      ),
    };
    const report = auditSlideIntelligenceWhyQuality(raw)!;
    expect(report.thin_slides.some((t) => t.slide_index === 1 && t.field === "why_it_works")).toBe(true);
    expect(report.thin_slides.some((t) => t.slide_index === 1 && t.field === "visual_description")).toBe(true);
  });



  it("isMimicFluxAnalysisSufficientForT2i rejects content-only slides without visual cues", () => {

    expect(

      isMimicFluxAnalysisSufficientForT2i({

        slide_purpose: "content",

        layout_template: null,

        visual_description: "N/A",

        visual_hierarchy: null,

        layout_structure: null,

      })

    ).toBe(false);

  });



  it("isMimicFluxAnalysisSufficientForT2i accepts concrete visual_description", () => {

    expect(

      isMimicFluxAnalysisSufficientForT2i({

        slide_purpose: "content",

        visual_description: LONG_VISUAL,

      })

    ).toBe(true);

  });



  it("isWhyMimicFluxInputSufficientForT2i requires strategic signal", () => {

    const thin: WhyMimicFluxSlideInput = {

      slide_index: 2,

      slide_role: null,

      narrative_function: null,

      psychological_trigger: null,

      persuasion_mechanism: null,

      curiosity_mechanism: null,

      attention_device: null,

      visual_role: null,

      emotion: null,

      why_it_works: null,
      visual_description: null,

      symbolic_elements: [],

      deck_strategic_thesis: null,

      deck_dominant_mechanism: null,

      deck_narrative_spine: [],

      brand_preserved_function: null,

      brand_preserved_mechanism: null,

      brand_visual_style: null,

      brand_tone: null,

      generated_headline: null,

      generated_body: null,

      safe_zone_hint: "",

    };

    expect(isWhyMimicFluxInputSufficientForT2i(thin)).toBe(false);



    expect(

      isWhyMimicFluxInputSufficientForT2i({

        ...thin,

        slide_role: "hook",

        why_it_works: "Too short",

      })

    ).toBe(false);



    expect(

      isWhyMimicFluxInputSufficientForT2i({

        ...thin,

        slide_role: "hook",
        why_it_works: LONG_WHY,
        visual_description: LONG_VISUAL,
      })
    ).toBe(true);

  });



  it("mimicSlideHasUsableReference finds archived frames by source_slide_index", () => {

    const mimic: Pick<MimicPayloadV1, "reference_items" | "slide_plans" | "archive_reference_items"> = {

      reference_items: [

        { index: 1, role: "slide", vision_fetch_url: "https://example.com/1.jpg", source_slide_index: 1 },

      ],

      slide_plans: [{ slide_index: 1, render_mode: "full_bleed", reference_index: 1, source_slide_index: 1 }],

    };

    expect(mimicSlideHasUsableReference(mimic, 1)).toBe(true);

    expect(mimicSlideHasUsableReference({ reference_items: [] }, 1)).toBe(false);

  });

});


