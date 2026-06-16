import { describe, expect, it } from "vitest";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import { CANONICAL_FLOW_TYPES } from "../domain/canonical-flow-types.js";
import { FLOW_TOP_PERFORMER_MIMIC_VIDEO } from "../domain/top-performer-mimic-flow-types.js";
import {
  buildSignalPackMimicReferencesForUi,
  mimicKindToFlowType,
  mimicRenderLabelForMode,
  groupMimicReferencesByTab,
} from "./signal-pack-mimic-ui.js";
import { plannerRowsFromMimicPicks } from "./run-candidates-materialize.js";

describe("buildSignalPackMimicReferencesForUi", () => {
  it("groups visual guideline entries by mimic kind", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_deep_1",
              analysis_tier: "top_performer_deep",
              source_evidence_row_id: "101",
              evidence_kind: "instagram_post",
              hook_text_preview: "Moon sign hook",
              why_it_worked: "Strong opener",
              inspection_media: { items: [{ public_url: "https://x/a.jpg" }] },
            },
            {
              insights_id: "ins_car_1",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "202",
              evidence_kind: "instagram_post",
              hook_text_preview: "12-slide deck",
              format_pattern: "listicle",
              inspection_media: { items: [{ public_url: "https://x/b.jpg" }] },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mimic_kind).sort()).toEqual(["carousel", "image"]);

    const grouped = groupMimicReferencesByTab(rows);
    expect(grouped.get("mimic_image")).toHaveLength(1);
    expect(grouped.get("mimic_carousel")).toHaveLength(1);
    expect(grouped.get("mimic_video")).toHaveLength(0);

    const imageRow = rows.find((r) => r.mimic_kind === "image");
    expect(imageRow?.predicted_render_label).toBe("Image");

    const carouselRow = rows.find((r) => r.mimic_kind === "carousel");
    expect(carouselRow?.predicted_render_label).toBeTruthy();
  });

  it("includes pack-level mode_override on mimic reference rows", () => {
    const pack = {
      derived_globals_json: {
        mimic_mode_overrides: { ins_car_1: "carousel_visual" },
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_car_1",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "202",
              evidence_kind: "instagram_post",
              hook_text_preview: "Deck",
              inspection_media: { items: [{ public_url: "https://x/b.jpg" }] },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows[0]?.mode_override).toBe("carousel_visual");
    expect(rows[0]?.predicted_render_label).toBe("Full bleed");
  });

  it("predicts Template from top-level mimic_evaluation on pack entry", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_pack_root",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "401",
              evidence_kind: "instagram_post",
              hook_text_preview: "Tarot-style deck",
              mimic_evaluation: {
                recommended_mode: "text_on_template",
                mode_reason: "Shared plate with centered copy",
                template_consistency: "uniform",
              },
              inspection_media: {
                items: [{ public_url: "https://x/a.jpg" }, { public_url: "https://x/b.jpg" }],
              },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows[0]?.predicted_render_label).toBe("Template");
    expect(rows[0]?.predicted_mimic_mode).toBe("template_bg");
  });

  it("predicts Template vs Full bleed from mimic_evaluation", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_tpl",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "301",
              evidence_kind: "instagram_post",
              hook_text_preview: "Text deck",
              aesthetic_analysis_json: {
                mimic_evaluation: {
                  recommended_mode: "text_on_template",
                  mode_reason: "Uniform serif template across slides",
                  template_consistency: "uniform",
                },
                slides: [
                  { slide_index: 1, text_density: "high", image_or_photo_role: "none" },
                  { slide_index: 2, text_density: "high", image_or_photo_role: "none" },
                ],
              },
              inspection_media: { items: [{ public_url: "https://x/a.jpg" }, { public_url: "https://x/b.jpg" }] },
            },
            {
              insights_id: "ins_bleed",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "302",
              evidence_kind: "instagram_post",
              hook_text_preview: "Visual deck",
              aesthetic_analysis_json: {
                mimic_evaluation: {
                  recommended_mode: "full_bleed_visual",
                  mode_reason: "Illustration-led cover and list slides",
                },
                deck_visual_system: { overall_aesthetic: "cartoon illustration" },
                slides: [
                  { slide_index: 1, text_density: "low", image_or_photo_role: "hero_illustration" },
                  { slide_index: 2, text_density: "low", image_or_photo_role: "supporting_visual" },
                ],
              },
              inspection_media: { items: [{ public_url: "https://x/c.jpg" }] },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows.find((r) => r.insights_id === "ins_tpl")?.predicted_render_label).toBe("Template");
    expect(rows.find((r) => r.insights_id === "ins_bleed")?.predicted_render_label).toBe("Full bleed");
  });
});

describe("mimicRenderLabelForMode", () => {
  it("labels mixed slide plans", () => {
    expect(
      mimicRenderLabelForMode("carousel_visual", [
        { slide_index: 1, render_mode: "full_bleed", reference_index: 1 },
        { slide_index: 2, render_mode: "hbs", reference_index: 2 },
      ])
    ).toBe("Mixed");
  });
});

describe("plannerRowsFromMimicPicks", () => {
  it("creates target_flow_type planner rows with grounding insight ids", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_car_1",
              analysis_tier: "top_performer_carousel",
              source_evidence_row_id: "202",
              evidence_kind: "instagram_post",
              hook_text_preview: "Deck hook",
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = plannerRowsFromMimicPicks(
      pack,
      [{ insights_id: "ins_car_1", mimic_kind: "carousel" }],
      "RUN_TEST"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_flow_type).toBe(mimicKindToFlowType("carousel"));
    expect(rows[0]?.grounding_insight_ids).toEqual(["ins_car_1"]);
    expect(rows[0]?.manual_mimic_pick).toBe(true);
  });

  it("routes video mimic picks to HeyGen flow from format_pattern", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_vid_1",
              analysis_tier: "top_performer_video",
              source_evidence_row_id: "303",
              evidence_kind: "tiktok_video",
              hook_text_preview: "UGC hook",
              format_pattern: "ugc",
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = plannerRowsFromMimicPicks(
      pack,
      [{ insights_id: "ins_vid_1", mimic_kind: "video" }],
      "RUN_TEST"
    );
    expect(rows[0]?.target_flow_type).toBe(CANONICAL_FLOW_TYPES.VID_SCRIPT);
    expect(rows[0]?.video_style).toBe("script_avatar");
    expect(rows[0]?.target_flow_type).not.toBe(FLOW_TOP_PERFORMER_MIMIC_VIDEO);
  });

  it("shows HeyGen lane label for video references in UI", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_vid_2",
              analysis_tier: "top_performer_video",
              source_evidence_row_id: "304",
              evidence_kind: "tiktok_video",
              hook_text_preview: "B-roll style",
              format_pattern: "b_roll",
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = buildSignalPackMimicReferencesForUi(pack);
    expect(rows[0]?.predicted_render_label).toContain("No avatar");
    expect(rows[0]?.predicted_render_detail).toContain("FLOW_VID_PROMPT_NO_AVATAR");
  });
});
