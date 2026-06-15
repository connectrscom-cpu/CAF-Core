import { describe, expect, it } from "vitest";
import {
  classifyMimicMode,
  clampSlidePlansToOutputCount,
  extendSlidePlansForOutputCount,
  reconcileMimicPayloadAtRender,
} from "./mimic-mode-classifier.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "../domain/top-performer-mimic-flow-types.js";
import { pickMimicPayload, mergeMimicPayloadSlice } from "../domain/mimic-payload.js";
import { bucketForFlowType } from "../decision_engine/format-routing.js";
import { isImageFlow } from "../decision_engine/flow-kind.js";

describe("classifyMimicMode", () => {
  it("returns image_full for mimic image flow", () => {
    expect(classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_IMAGE, {}).mode).toBe("image_full");
  });

  it("returns template_bg with cover/body/cta slot references for listicle decks", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "listicle",
        mimic_evaluation: { template_consistency: "uniform" },
        slides: [
          { slide_index: 1, text_density: "high", image_or_photo_role: "none", slide_purpose: "hook" },
          { slide_index: 2, text_density: "high", image_or_photo_role: "none", slide_purpose: "listicle_item" },
          { slide_index: 3, text_density: "high", image_or_photo_role: "none", slide_purpose: "listicle_item" },
          { slide_index: 4, text_density: "high", image_or_photo_role: "none", slide_purpose: "cta" },
        ],
      },
      stored_inspection_media_json: {
        items: [
          { index: 1, vision_fetch_url: "https://x/1.jpg" },
          { index: 2, vision_fetch_url: "https://x/2.jpg" },
          { index: 3, vision_fetch_url: "https://x/3.jpg" },
          { index: 4, vision_fetch_url: "https://x/4.jpg" },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("template_bg");
    expect(r.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
    expect(r.slide_plans?.[0]?.reference_index).toBe(1);
    expect(r.slide_plans?.[3]?.reference_index).toBe(4);
  });

  it("plans carousel_visual slides as full_bleed (visual plate + HBS at render)", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        deck_visual_system: { overall_aesthetic: "cinematic photo carousel" },
        slides: [
          {
            text_density: "low",
            image_or_photo_role: "full-bleed photo",
            on_screen_text_transcript: "Bold hook line",
          },
          {
            text_density: "low",
            image_or_photo_role: "full-bleed photo",
            on_screen_text_transcript: "Short CTA",
          },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("carousel_visual");
    expect(r.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("plans full_bleed for photo-only slides without on-screen text", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        deck_visual_system: { overall_aesthetic: "cinematic photo carousel" },
        slides: [
          { text_density: "low", image_or_photo_role: "full-bleed photo", on_screen_text_transcript: "" },
          { text_density: "low", image_or_photo_role: "full-bleed photo", on_screen_text_transcript: "" },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("returns template_bg when on-screen transcript exceeds char threshold", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        slides: [
          {
            text_density: "low",
            image_or_photo_role: "full-bleed photo",
            on_screen_text_transcript: "A".repeat(220),
          },
        ],
      },
    };
    expect(classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry).mode).toBe("template_bg");
  });

  it("returns carousel_visual with per-slide plans for image-led deck", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        slides: [
          { text_density: "low", image_or_photo_role: "full-bleed photo" },
          { text_density: "high", image_or_photo_role: "none" },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("carousel_visual");
    expect(r.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("defaults missing photo role to full_bleed when text density is not high", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        slides: [{ text_density: "medium" }],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("carousel_visual");
    expect(r.slide_plans?.[0]?.render_mode).toBe("full_bleed");
  });

  it("plans one slide per archived reference frame when aesthetic slides are missing", () => {
    const entry = {
      stored_inspection_media_json: {
        items: [
          { index: 1, vision_fetch_url: "https://x/1.jpg" },
          { index: 2, vision_fetch_url: "https://x/2.jpg" },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.slide_plans).toHaveLength(2);
    expect(r.slide_plans?.[1]?.reference_index).toBe(2);
  });

  it("returns template_bg with hbs slide plans for celestial text-overlay carousel", () => {
    const entry = {
      format_pattern: "mixed (reflective messaging with visual storytelling)",
      deck_visual_system: {
        repeated_template: "centered text over celestial backgrounds; similar layout across slides",
      },
      stored_inspection_media_json: {
        items: [
          { index: 0, vision_fetch_url: "https://x/1.jpg" },
          { index: 1, vision_fetch_url: "https://x/2.jpg" },
        ],
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("template_bg");
    expect(r.slide_plans).toHaveLength(2);
    expect(r.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
    expect(r.slide_plans?.every((p) => p.reference_index === 1)).toBe(true);
  });

  it("extendSlidePlansForOutputCount cycles reference frames for extra output slides", () => {
    const plans = extendSlidePlansForOutputCount(
      {
        mode: "template_bg",
        reference_items: [{ index: 0 }, { index: 1 }],
        slide_plans: [
          { slide_index: 1, render_mode: "hbs", reference_index: 1 },
          { slide_index: 2, render_mode: "hbs", reference_index: 2 },
        ],
      },
      5
    );
    expect(plans).toHaveLength(5);
    expect(plans[4]?.render_mode).toBe("hbs");
    expect(plans[3]?.reference_index).toBe(2);
    expect(plans[4]?.reference_index).toBe(1);
  });

  it("returns template_bg when deck has uniform backdrop but no per-slide aesthetic rows", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        visual_consistency: "Strong - uniform blue backdrop and medieval color palette across deck",
        deck_visual_system: {
          repeated_template: "mishandled",
          overall_aesthetic: "vintage_bardic_style",
        },
      },
      stored_inspection_media_json: {
        items: Array.from({ length: 12 }, (_, i) => ({
          index: i + 1,
          vision_fetch_url: `https://x/slide_${i + 1}.jpg`,
        })),
      },
    };
    const r = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(r.mode).toBe("template_bg");
    expect(r.slide_plans).toHaveLength(12);
    expect(r.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
    expect(r.slide_plans?.[0]?.reference_index).toBe(1);
    expect(r.slide_plans?.[11]?.reference_index).toBe(12);
  });

  it("clampSlidePlansToOutputCount drops plans beyond output slide count", () => {
    const plans = clampSlidePlansToOutputCount(
      [
        { slide_index: 1, render_mode: "full_bleed", reference_index: 1 },
        { slide_index: 8, render_mode: "full_bleed", reference_index: 8 },
      ],
      7
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]?.slide_index).toBe(1);
  });

  it("extendSlidePlansForOutputCount maps cover/body/cta refs for uniform template_bg extras", () => {
    const plans = extendSlidePlansForOutputCount(
      {
        mode: "template_bg",
        reference_items: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
        visual_guideline: {
          format_pattern: "listicle",
          mimic_evaluation: { template_consistency: "uniform" },
        },
        slide_plans: [{ slide_index: 1, render_mode: "hbs", reference_index: 1, source_slide_index: 1 }],
      },
      4
    );
    expect(plans).toHaveLength(4);
    expect(plans[0]?.reference_index).toBe(1);
    expect(plans[3]?.reference_index).toBe(4);
  });
});

describe("reconcileMimicPayloadAtRender", () => {
  it("coerces carousel_visual to template_bg when background plate + text-overlay deck cues exist", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "carousel_visual" as const,
      classified_at: "2026-05-28T00:00:00.000Z",
      source_insights_id: "ins_x",
      analysis_tier: "top_performer_carousel" as const,
      background_image_url: "https://cdn.example/mimic_backgrounds/slide_001_bg_v1.png",
      reference_items: [
        { index: 1, role: "carousel_slide" as const, vision_fetch_url: "https://x/1.jpg" },
      ],
      visual_guideline: {
        format_pattern: "educational",
        deck_visual_system: {
          repeated_template: "text_on_water",
          overall_aesthetic: "natural_ocean",
        },
      },
      slide_plans: [
        { slide_index: 1, render_mode: "full_bleed" as const, reference_index: 1 },
        { slide_index: 2, render_mode: "full_bleed" as const, reference_index: 2 },
      ],
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const reconciled = reconcileMimicPayloadAtRender(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, mimic);
    expect(reconciled.mode).toBe("template_bg");
    expect(reconciled.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
  });

  it("coerces carousel_visual to template_bg when MIMIC_BACKGROUND assets exist on listicle deck", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "carousel_visual" as const,
      classified_at: "2026-05-28T00:00:00.000Z",
      source_insights_id: "ins_x",
      analysis_tier: "top_performer_carousel" as const,
      reference_items: [
        { index: 1, role: "carousel_slide" as const, vision_fetch_url: "https://x/1.jpg" },
      ],
      visual_guideline: {
        format_pattern: "listicle",
        aesthetic_analysis_json: {
          format_pattern: "listicle",
          slides: [
            { text_density: "high", image_or_photo_role: "none" },
            { text_density: "high", image_or_photo_role: "none" },
          ],
        },
        deck_visual_system: { overall_aesthetic: "text list" },
      },
      slide_plans: [{ slide_index: 1, render_mode: "full_bleed" as const, reference_index: 1 }],
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const reconciled = reconcileMimicPayloadAtRender(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, mimic, {
      hasStoredBackgroundPlates: true,
    });
    expect(reconciled.mode).toBe("template_bg");
    expect(reconciled.slide_plans?.every((p) => p.render_mode === "hbs")).toBe(true);
  });

  it("keeps carousel_visual when leftover bg assets exist on image-led deck", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "carousel_visual" as const,
      classified_at: "2026-05-28T00:00:00.000Z",
      source_insights_id: "ins_x",
      analysis_tier: "top_performer_carousel" as const,
      reference_items: [
        { index: 1, role: "carousel_slide" as const, vision_fetch_url: "https://x/1.jpg" },
      ],
      visual_guideline: {
        format_pattern: "mixed",
        aesthetic_analysis_json: {
          format_pattern: "mixed",
          deck_visual_system: { overall_aesthetic: "cinematic photo carousel" },
          slides: [
            {
              text_density: "low",
              image_or_photo_role: "full-bleed photo",
              on_screen_text_transcript: "Taurus as tacos",
            },
          ],
        },
      },
      slide_plans: [{ slide_index: 1, render_mode: "full_bleed" as const, reference_index: 1 }],
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const reconciled = reconcileMimicPayloadAtRender(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, mimic, {
      hasStoredBackgroundPlates: true,
    });
    expect(reconciled.mode).toBe("carousel_visual");
    expect(reconciled.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("honors mode_override carousel_visual even with text-overlay deck cues", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "carousel_visual" as const,
      mode_override: "carousel_visual" as const,
      classified_at: "2026-05-28T00:00:00.000Z",
      source_insights_id: "ins_x",
      analysis_tier: "top_performer_carousel" as const,
      background_image_url: "https://cdn.example/mimic_backgrounds/slide_001_bg_v1.png",
      reference_items: [
        { index: 1, role: "carousel_slide" as const, vision_fetch_url: "https://x/1.jpg" },
      ],
      visual_guideline: {
        format_pattern: "educational",
        deck_visual_system: {
          repeated_template: "text_on_water",
          overall_aesthetic: "natural_ocean",
        },
      },
      slide_plans: [{ slide_index: 1, render_mode: "full_bleed" as const, reference_index: 1 }],
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const reconciled = reconcileMimicPayloadAtRender(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, mimic);
    expect(reconciled.mode).toBe("carousel_visual");
    expect(reconciled.slide_plans?.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });
});

describe("mimic-payload", () => {
  it("round-trips mimic_v1 on generation_payload", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "image_full" as const,
      classified_at: "2026-01-01T00:00:00.000Z",
      source_insights_id: "ins_a",
      analysis_tier: "top_performer_deep",
      reference_items: [
        {
          index: 1,
          role: "carousel_slide",
          vision_fetch_url: "https://example.com/a.jpg",
          bucket: "assets",
          object_path: "top-performer/x/slide_01.png",
        },
      ],
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const gp = mergeMimicPayloadSlice({}, mimic);
    const picked = pickMimicPayload(gp);
    expect(picked?.mode).toBe("image_full");
    expect(picked?.reference_items).toHaveLength(1);
    expect(picked?.reference_items[0]?.bucket).toBe("assets");
    expect(picked?.reference_items[0]?.object_path).toBe("top-performer/x/slide_01.png");
  });

  it("preserves docai_layer_positions across pick and merge", () => {
    const mimic = {
      schema_version: 1 as const,
      mode: "carousel_visual" as const,
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
      twist_brief: { visual_only: true as const, legal_note: "pattern only" },
    };
    const positions = {
      "1": [{ layer_key: "body@100,200:hello", x_px: 10, y_px: 20, w_px: 300, h_px: 80 }],
    };
    const gp = mergeMimicPayloadSlice(
      { mimic_v1: { ...mimic, docai_layer_positions: positions } },
      mimic
    );
    expect((gp.mimic_v1 as Record<string, unknown>).docai_layer_positions).toEqual(positions);
    const picked = pickMimicPayload(gp);
    expect(picked?.docai_layer_positions).toEqual(positions);
  });
});

describe("flow routing", () => {
  it("maps mimic image flow to post bucket", () => {
    expect(bucketForFlowType(FLOW_TOP_PERFORMER_MIMIC_IMAGE)).toBe("post");
    expect(isImageFlow(FLOW_TOP_PERFORMER_MIMIC_IMAGE)).toBe(true);
  });
});
