import { describe, expect, it } from "vitest";
import {
  appendMimicGroundedReferenceToUserPrompt,
  buildMimicJobPlanningGrounding,
  buildMimicJobPlanningGroundingFromEntry,
  enrichGuidelineEntryFromLineageInsight,
  findVisualGuidelinePackEntry,
  groundingInsightIdsFromCandidate,
} from "./mimic-job-grounding.js";

describe("mimic-job-grounding", () => {
  it("resolves grounding ids from candidate_data", () => {
    expect(
      groundingInsightIdsFromCandidate({
        grounding_insight_ids: ["ins_a", "ins_b"],
      })
    ).toEqual(["ins_a", "ins_b"]);
  });

  it("finds pack entry for grounded insight", () => {
    const derived = {
      visual_guidelines_pack_v1: {
        entries: [
          { insights_id: "ins_other", deck_as_whole_summary: "other" },
          {
            insights_id: "ins_target",
            aesthetic_analysis_json: {
              format_pattern: "listicle",
              slides: [{ slide_index: 1, on_screen_text_transcript: "Aries thrives" }],
              mimic_evaluation: { recommended_mode: "full_bleed_visual" },
            },
          },
        ],
      },
    };
    expect(findVisualGuidelinePackEntry(derived, ["ins_target"])?.insights_id).toBe("ins_target");
  });

  it("buildMimicJobPlanningGrounding returns only this job reference", async () => {
    const g = await buildMimicJobPlanningGrounding(
      null,
      "",
      {
        visual_guidelines_pack_v1: {
          entries: [
            { insights_id: "ins_other" },
            {
              insights_id: "ins_target",
              aesthetic_analysis_json: {
                slides: [
                  {
                    slide_index: 1,
                    on_screen_text_transcript: "Hook line",
                    visual_description: "Bold title on gradient",
                    text_blocks: [
                      {
                        text: "Hook line",
                        role: "title",
                        bbox_norm: { x: 0.1, y: 0.15, w: 0.8, h: 0.12 },
                        font_size_px: 48,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      { grounding_insight_ids: ["ins_target"] }
    );
    expect(g?.source_insights_id).toBe("ins_target");
    expect(g?.visual_guideline_for_copy.slides?.[0]?.on_screen_text_transcript).toContain("Hook");
    expect(g?.slide_copy_layout).toHaveLength(1);
    expect(g?.slide_copy_layout[0]?.reference_on_screen_text).toContain("Hook");
    expect(g?.slide_copy_layout[0]?.visual_description).toContain("Bold");
    expect(g?.slide_copy_layout[0]?.text_blocks?.[0]?.role).toBe("title");
  });

  it("buildMimicJobPlanningGroundingFromEntry includes slide_copy_layout from full entry", () => {
    const g = buildMimicJobPlanningGroundingFromEntry(
      {
        insights_id: "ins_x",
        aesthetic_analysis_json: {
          slides: [
            {
              slide_index: 2,
              on_screen_text_transcript: "Taurus steady",
              typography: { text_placement: "centered stack", headline_guess: "bold" },
            },
          ],
        },
      },
      ["ins_x"]
    );
    expect(g.slide_copy_layout[0]?.slide_index).toBe(2);
    expect(g.slide_copy_layout[0]?.typography?.text_placement).toBe("centered stack");
  });

  it("enrichGuidelineEntryFromLineageInsight prefers full row slides", () => {
    const pack = {
      aesthetic_analysis_json: {
        slides: [{ slide_index: 1, on_screen_text_transcript: "short" }],
      },
    };
    const row = {
      aesthetic_analysis_json: {
        slides: [
          {
            slide_index: 1,
            on_screen_text_transcript: "Aries thrives on change",
            text_blocks: [{ text: "Aries thrives", role: "title", bbox_norm: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 } }],
          },
        ],
      },
      hook_text: "zodiac_arc",
    };
    const out = enrichGuidelineEntryFromLineageInsight(pack, row);
    const aes = out.aesthetic_analysis_json as Record<string, unknown>;
    const slides = aes.slides as Record<string, unknown>[];
    expect(slides[0]?.text_blocks).toBeDefined();
    expect(out.hook_text_preview).toBe("zodiac_arc");
  });

  it("appendMimicGroundedReferenceToUserPrompt adds slide_copy_layout with placement hints", () => {
    const out = appendMimicGroundedReferenceToUserPrompt("Base prompt", {
      mimic_render_context: { target_slide_count: 8 },
      slide_copy_layout: [
        {
          slide_index: 1,
          reference_on_screen_text: "Aries",
          visual_description: "zodiac wheel",
          layout_template: "list item",
          image_or_photo_role: null,
          text_density: null,
          slide_purpose: null,
          graphic_elements: null,
          color_tokens: null,
          typography: { text_placement: "top", headline_guess: null, body_guess: null, accent_guess: null, relative_scale: null, hierarchy: null, font_size_px_headline: null, font_size_px_body: null },
          text_blocks: [{ text: "Aries", role: "title", x: 0.1, y: 0.2, w: 0.8, h: 0.1, align: null, font_size_px: 40, font_weight: null, color_hex: null }],
        },
      ],
    });
    expect(out).toContain("Base prompt");
    expect(out).toContain("slide_copy_layout");
    expect(out).toContain("reference_on_screen_text");
    expect(out).toContain("text_blocks");
    expect(out).toContain("this job only");
    expect(out).not.toContain("mimic_visual_guideline_for_copy");
  });
});
