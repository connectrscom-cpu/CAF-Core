import { describe, expect, it } from "vitest";
import {
  composeMimicCarouselDraftPackage,
  serializeSlideCopyLayoutForLlmPrompt,
  slimVisualGuidelineFromEntry,
} from "../domain/mimic-carousel-package.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { validateAndNormalizeDraftPackage } from "../services/draft-package-contract.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL } from "../domain/top-performer-mimic-flow-types.js";

describe("mimic_carousel_package", () => {
  it("infers mimic_carousel_package for mimic carousel flow (not carousel_package)", () => {
    const r = validateAndNormalizeDraftPackage(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {
      caption: "Test caption",
      hashtags: ["astrology"],
      carousel: { slides: [{ headline: "Hook", body: "Body copy for slide one with enough text." }] },
    });
    expect(r.package_type).toBe("mimic_carousel_package");
    expect(r.errors).toHaveLength(0);
  });

  it("composes copy + visual reference + render plan after mimic prep", () => {
    const mimic: MimicPayloadV1 = {
      schema_version: 1,
      mode: "carousel_visual",
      classified_at: "2026-01-01T00:00:00.000Z",
      source_insights_id: "ins_1",
      source_evidence_row_id: "22927",
      analysis_tier: "top_performer_carousel",
      reference_items: [
        {
          index: 1,
          role: "carousel_slide",
          vision_fetch_url: "https://example.com/s1.jpg",
          bucket: "assets",
          object_path: "assets/top_performer_inspection/SNS/row_22927/slide_01.jpg",
        },
      ],
      storage_folder_prefix: "assets/top_performer_inspection/SNS/row_22927/",
      storage_folder_label: "assets · assets/top_performer_inspection/SNS/row_22927/",
      visual_guideline: slimVisualGuidelineFromEntry({
        format_pattern: "listicle",
        deck_as_whole_summary: "May horoscope carousel",
      }) as unknown as Record<string, unknown>,
      twist_brief: { visual_only: true, legal_note: "pattern only" },
      slide_plans: [{ slide_index: 1, render_mode: "full_bleed", reference_index: 1 }],
    };

    const gp = {
      generated_output: {
        package_type: "mimic_carousel_package",
        caption: "Cap",
        carousel: { slides: [{ headline: "H", body: "B".repeat(220) }] },
      },
    };

    const pkg = composeMimicCarouselDraftPackage(gp, mimic);
    expect(pkg.package_type).toBe("mimic_carousel_package");
    expect(pkg.render_plan.strategy).toBe("per_slide_mimic");
    expect(pkg.render_plan.mode).toBe("carousel_visual");
    expect(pkg.visual_reference.reference_items[0]?.object_path).toContain("slide_01");
    expect(pkg.visual_guideline.format_pattern).toBe("listicle");
  });

  it("serializeSlideCopyLayoutForLlmPrompt strips geometry from text_blocks", () => {
    const layout: MimicSlideCopyLayoutForLlm[] = [
      {
        slide_index: 1,
        reference_on_screen_text: "Aries thrives on change",
        visual_description: "zodiac wheel",
        layout_template: "list item",
        image_or_photo_role: null,
        text_density: null,
        slide_purpose: null,
        graphic_elements: null,
        color_tokens: null,
        typography: null,
        text_blocks: [
          {
            text: "Aries thrives",
            role: "title",
            x: 0.1,
            y: 0.2,
            w: 0.8,
            h: 0.1,
            align: null,
            font_size_px: 40,
            font_weight: null,
            color_hex: "#fff",
          },
        ],
      },
    ];
    const slim = serializeSlideCopyLayoutForLlmPrompt(layout);
    expect(slim).toHaveLength(1);
    expect(slim[0]?.text_blocks).toEqual([{ role: "title", text: "Aries thrives" }]);
    expect(JSON.stringify(slim)).not.toContain('"x":');
  });

  it("maps template_bg to template_background strategy", () => {
    const mimic: MimicPayloadV1 = {
      schema_version: 1,
      mode: "template_bg",
      classified_at: "2026-01-01T00:00:00.000Z",
      source_insights_id: "ins_1",
      analysis_tier: "top_performer_carousel",
      reference_items: [
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://example.com/s1.jpg" },
      ],
      twist_brief: { visual_only: true, legal_note: "pattern only" },
    };
    const pkg = composeMimicCarouselDraftPackage({ generated_output: { caption: "x" } }, mimic);
    expect(pkg.render_plan.strategy).toBe("template_background");
  });
});
