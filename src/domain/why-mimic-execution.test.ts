import { describe, expect, it } from "vitest";
import { deriveSlideIntelligenceFromAnalysis } from "./slide-intelligence.js";
import {
  buildWhyMimicContentLogSummary,
  buildWhyMimicFluxSlideInput,
  buildWhyMimicSlidePlansFromSil,
  isWhyMimicExecution,
  MIMIC_EXECUTION_MODE_WHY,
} from "./why-mimic-execution.js";
import { FLOW_WHY_MIMIC_CAROUSEL } from "./why-mimic-carousel-flow-types.js";

const carouselAesthetic = {
  slides: [
    { slide_index: 1, slide_purpose: "hook", visual_description: "mysterious castle on hill" },
    { slide_index: 2, slide_purpose: "proof", visual_description: "chart showing growth" },
  ],
};

describe("buildWhyMimicSlidePlansFromSil", () => {
  it("builds role-ordered slide plans from SIL", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: carouselAesthetic,
      mediaKind: "carousel",
    });
    expect(bundle).not.toBeNull();
    const plans = buildWhyMimicSlidePlansFromSil(bundle!, "carousel_visual", 2);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.slide_index).toBe(1);
    expect(plans[0]?.render_mode).toBe("full_bleed");
    expect(plans[1]?.slide_index).toBe(2);
  });
});

describe("buildWhyMimicFluxSlideInput", () => {
  it("includes strategic fields and generated copy", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: carouselAesthetic,
      mediaKind: "carousel",
    });
    const input = buildWhyMimicFluxSlideInput(bundle!, 1, {
      parsedSlide: { headline: "Wait — what?", body: "This changes everything." },
      safeZoneHint: "Keep top third smooth.",
    });
    expect(input?.slide_index).toBe(1);
    expect(input?.generated_headline).toBe("Wait — what?");
    expect(input?.safe_zone_hint).toContain("smooth");
    expect(input?.slide_role).toBeTruthy();
  });
});

describe("isWhyMimicExecution", () => {
  it("is true for FLOW_WHY_MIMIC_CAROUSEL and execution_mode slice", () => {
    expect(isWhyMimicExecution(FLOW_WHY_MIMIC_CAROUSEL, null)).toBe(true);
    expect(isWhyMimicExecution("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", { execution_mode: MIMIC_EXECUTION_MODE_WHY })).toBe(
      true
    );
    expect(isWhyMimicExecution("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", { execution_mode: "classic" })).toBe(false);
  });
});

describe("buildWhyMimicContentLogSummary", () => {
  it("exports rich per-slide reinterpretation context for content log", () => {
    const bundle = deriveSlideIntelligenceFromAnalysis({
      aesthetic: carouselAesthetic,
      mediaKind: "carousel",
    });
    const summary = buildWhyMimicContentLogSummary(FLOW_WHY_MIMIC_CAROUSEL, {
      mimic_v1: {
        schema_version: 1,
        execution_mode: MIMIC_EXECUTION_MODE_WHY,
        mode: "carousel_visual",
        classified_at: new Date().toISOString(),
        source_insights_id: "ins_test",
        analysis_tier: "top_performer_carousel",
        reference_items: [{ index: 1, role: "slide", vision_fetch_url: "https://x" }],
        twist_brief: { visual_only: true, legal_note: "Preserve persuasion strategy only." },
        slide_intelligence: bundle,
      },
      mimic_job_grounding: {
        slide_copy_layout: [
          {
            slide_index: 1,
            reference_on_screen_text: "When your birthday trip gets canceled",
            visual_description: "Cartoon ram character looking frustrated",
            layout_template: "centered meme",
            image_or_photo_role: "character focal",
            text_density: "medium",
            slide_purpose: "hook",
            graphic_elements: null,
            color_tokens: null,
            typography: null,
            text_blocks: [{ role: "title", text: "When your birthday trip gets canceled" }],
          },
        ],
      },
      draft_package_snapshot: {
        mimic_carousel_package: {
          copy: {
            slides: [{ slide_index: 1, headline: "Plans changed?", body: "We feel you." }],
          },
        },
      },
    });

    expect(summary?.schema).toBe("why_mimic_content_log_v2");
    expect(summary?.execution_mode).toBe(MIMIC_EXECUTION_MODE_WHY);
    expect(summary?.reinterpretation_contract).toMatchObject({
      legal_note: "Preserve persuasion strategy only.",
    });
    const slides = summary?.slides as Array<Record<string, unknown>>;
    expect(slides?.length).toBeGreaterThanOrEqual(2);
    const slide1 = slides?.find((s) => s.slide_index === 1);
    expect(slide1?.reference).toMatchObject({
      on_screen_text: "When your birthday trip gets canceled",
      visual_description: "Cartoon ram character looking frustrated",
    });
    expect(slide1?.generated).toMatchObject({ headline: "Plans changed?" });
    expect(typeof slide1?.reinterpretation_brief).toBe("string");
    expect(String(slide1?.reinterpretation_brief)).toContain("Reference on-screen text");
    expect(String(slide1?.reinterpretation_brief)).toContain("rephrase");
  });
});
