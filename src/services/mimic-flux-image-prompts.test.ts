import { describe, expect, it } from "vitest";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  buildDeterministicFluxImagePrompt,
  buildMimicFluxSlideAnalysisInput,
  resolveMimicSlideImagePrompt,
} from "./mimic-flux-image-prompts.js";

function minimalMimic(overrides?: Partial<MimicPayloadV1>): MimicPayloadV1 {
  return {
    mode: "full_bleed",
    reference_items: [{ slide_index: 1, vision_fetch_url: "https://example.com/1.jpg" }],
    visual_guideline: {
      why_it_worked: "Bold contrast hooks attention",
      deck_visual_system: { overall_aesthetic: "warm editorial" },
      slides: [
        {
          slide_index: 1,
          slide_purpose: "hook",
          layout_template: "hero portrait",
          visual_description: "Person holding coffee in golden hour light",
          composition_blueprint: {
            visual_hierarchy: "face dominant, background soft",
            layout_structure: "subject left third",
          },
          text_blocks: [{ text: "Title", bbox_norm: { x: 0.1, y: 0.08, w: 0.8, h: 0.12 } }],
        },
      ],
    },
    slide_plans: [{ slide_index: 1, source_slide_index: 1 }],
    ...overrides,
  };
}

describe("mimic-flux-image-prompts", () => {
  it("buildMimicFluxSlideAnalysisInput pulls Nemotron fields and safe zones", () => {
    const mimic = minimalMimic();
    const input = buildMimicFluxSlideAnalysisInput(mimic, 1, {
      layoutRow: {
        slide_index: 1,
        reference_on_screen_text: "Morning ritual",
        layout_template: "hero portrait",
        visual_description: "fallback visual",
      },
    });
    expect(input).not.toBeNull();
    expect(input!.slide_purpose).toBe("hook");
    expect(input!.deck_why_it_worked).toContain("Bold contrast");
    expect(input!.safe_zone_hint).toContain("low-detail");
    expect(input!.copy_theme).toContain("Morning ritual");
  });

  it("buildDeterministicFluxImagePrompt is art-only and includes analysis fields", () => {
    const mimic = minimalMimic();
    const input = buildMimicFluxSlideAnalysisInput(mimic, 1)!;
    const prompt = buildDeterministicFluxImagePrompt(input);
    expect(prompt.toLowerCase()).toContain("zero readable text");
    expect(prompt).toContain("golden hour");
    expect(prompt).toContain("warm editorial");
  });

  it("resolveMimicSlideImagePrompt uses stored flux prompt in analysis_t2i mode", () => {
    const mimic = minimalMimic({
      flux_image_prompts: {
        "1": {
          slide_index: 1,
          flux_image_prompt: "Sunlit cafe scene, art-only, no text.",
          image_input_mode: "analysis_t2i",
        },
      },
    });
    const resolved = resolveMimicSlideImagePrompt(mimic, 1, "reference edit prompt", "analysis_t2i");
    expect(resolved.usesReferenceImage).toBe(false);
    expect(resolved.prompt).toContain("Sunlit cafe");
    expect(resolved.imageInputMode).toBe("analysis_t2i");
  });

  it("resolveMimicSlideImagePrompt keeps reference edit in reference_edit mode", () => {
    const mimic = minimalMimic();
    const resolved = resolveMimicSlideImagePrompt(mimic, 1, "edit from reference", "reference_edit");
    expect(resolved.usesReferenceImage).toBe(true);
    expect(resolved.prompt).toBe("edit from reference");
  });

  it("resolveMimicSlideImagePrompt falls back to deterministic t2i without stored prompts", () => {
    const mimic = minimalMimic();
    const resolved = resolveMimicSlideImagePrompt(mimic, 1, "edit from reference", "analysis_t2i");
    expect(resolved.usesReferenceImage).toBe(false);
    expect(resolved.prompt.toLowerCase()).toContain("zero readable text");
  });

  it("resolveMimicSlideImagePrompt falls back to reference_edit when Nemotron analysis is thin", () => {
    const mimic = minimalMimic({
      visual_guideline: {
        slides: [
          {
            slide_index: 1,
            slide_purpose: "content",
            layout_template: "N/A",
            visual_description: "N/A",
          },
        ],
      },
      flux_image_prompts: {
        "1": {
          slide_index: 1,
          flux_image_prompt: "Generic weak prompt from thin analysis.",
          image_input_mode: "analysis_t2i",
        },
      },
    });
    const resolved = resolveMimicSlideImagePrompt(mimic, 1, "edit from reference", "analysis_t2i");
    expect(resolved.usesReferenceImage).toBe(true);
    expect(resolved.imageInputMode).toBe("reference_edit");
    expect(resolved.analysisFallbackReason).toBe("insufficient_slide_analysis");
    expect(resolved.prompt).toBe("edit from reference");
  });

  it("resolveMimicSlideImagePrompt attaches BVS image refs for new visual carousel", () => {
    const mimic: MimicPayloadV1 = {
      mode: "carousel_visual",
      execution_mode: "new_visual",
      bvs_enabled: true,
      reference_items: [],
      slide_plans: [{ slide_index: 1 }],
      flux_image_prompts: {
        "1": {
          slide_index: 1,
          flux_image_prompt: "Cinematic hero plate, art-only, no text.",
          image_input_mode: "analysis_t2i",
        },
      },
      bvs_bible_snapshot: {
        schema_version: "brand_bible_v1",
        palette: ["#0B0B16"],
        application_guide: { instructions: "Use cosmic guide on CTA." },
        asset_refs: [
          { asset_id: "bg1", role: "background" },
          { asset_id: "m1", role: "mascot" },
        ],
        resolved_assets: [
          {
            asset_id: "bg1",
            role: "background",
            label: "Starfield",
            public_url: "https://cdn/bg.png",
          },
          {
            asset_id: "m1",
            role: "mascot",
            label: "Guide waving",
            public_url: "https://cdn/mascot.png",
          },
        ],
      },
    };
    const resolved = resolveMimicSlideImagePrompt(mimic, 1, "unused", "analysis_t2i");
    expect(resolved.bvsReferenceUrls).toEqual(["https://cdn/bg.png", "https://cdn/mascot.png"]);
    expect(resolved.prompt).toContain("Brand asset reference images (2 attached to Flux");
    expect(resolved.prompt).toContain("subject-first original carousel plates");
  });
});
