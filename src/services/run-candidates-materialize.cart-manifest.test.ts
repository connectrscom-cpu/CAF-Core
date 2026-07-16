import { describe, expect, it } from "vitest";
import { plannerRowsFromCartManifest, type CartManifestItem } from "./run-candidates-materialize.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";

const CUISINA_13_MANIFEST: CartManifestItem[] = [
  { cart_item_id: "idea_idea_712_MRIA25ST_19", kind: "idea", title: "The Secret to Meal Variety", target_flow_type: "FLOW_VID_HOOK_FIRST", format: "video", platform: "Instagram" },
  { cart_item_id: "idea_idea_712_MRIA25ST_18", kind: "idea", title: "Dinner Time Dilemmas Solved", target_flow_type: "FLOW_VID_HOOK_FIRST", format: "video", platform: "Instagram" },
  { cart_item_id: "idea_idea_712_MRIA25ST_8", kind: "idea", title: "Healthy Comfort Food Reimagined", target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL", format: "carousel", platform: "Facebook" },
  { cart_item_id: "idea_idea_712_MRIA25ST_9", kind: "idea", title: "Rotating Themed Dinner Nights", target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL", format: "carousel", platform: "Instagram", use_brand_visual_system: false },
  { cart_item_id: "idea_idea_712_MRIA25ST_3", kind: "idea", title: "Balancing Meals with Your Schedule", target_flow_type: "FLOW_CAROUSEL", format: "carousel", platform: "Instagram" },
  { cart_item_id: "idea_idea_712_MRIA25ST_2", kind: "idea", title: "My Most Adventurous Grocery Haul", target_flow_type: "FLOW_CAROUSEL", format: "carousel", platform: "Instagram" },
  { cart_item_id: "idea_idea_712_MRIA25ST_23", kind: "idea", title: "Grocery Efficiency", target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL", format: "carousel", platform: "Facebook" },
  { cart_item_id: "tp_ins_894d424d84_28762_cdeep", kind: "top_performer", title: "TP story", target_flow_type: "FLOW_VID_PROMPT", format: "story", platform: "Instagram", insights_id: "ins_894d424d84_28762_cdeep", mimic_kind: "video", video_intent: "prompt_avatar" },
  { cart_item_id: "tp_ins_894d424d84_28808_cdeep", kind: "top_performer", title: "TP carousel", target_flow_type: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", format: "unknown", platform: "Instagram", insights_id: "ins_894d424d84_28808_cdeep", mimic_kind: "carousel" },
  { cart_item_id: "tp_ins_894d424d84_28767_vdeep", kind: "top_performer", title: "TP mixed", target_flow_type: "FLOW_VID_PROMPT", format: "mixed", platform: "Instagram", insights_id: "ins_894d424d84_28767_vdeep", mimic_kind: "video", video_intent: "prompt_avatar" },
  { cart_item_id: "tp_ins_894d424d84_28770_vdeep", kind: "top_performer", title: "TP unknown", target_flow_type: "FLOW_VID_PROMPT", format: "unknown", platform: "Instagram", insights_id: "ins_894d424d84_28770_vdeep", mimic_kind: "video", video_intent: "prompt_avatar" },
  { cart_item_id: "tp_ins_894d424d84_28657_vdeep", kind: "top_performer", title: "TP mixed 2", target_flow_type: "FLOW_VID_PROMPT", format: "mixed", platform: "Instagram", insights_id: "ins_894d424d84_28657_vdeep", mimic_kind: "video", video_intent: "prompt_avatar" },
  { cart_item_id: "tp_ins_894d424d84_28765_vdeep", kind: "top_performer", title: "TP no avatar", target_flow_type: "FLOW_VID_PROMPT_NO_AVATAR", format: "text_on_screen", platform: "Instagram", insights_id: "ins_894d424d84_28765_vdeep", mimic_kind: "video", video_intent: "no_avatar" },
];

describe("plannerRowsFromCartManifest", () => {
  it("throws when top_performer cart picks cannot resolve visual guideline entries", () => {
    const pack = {
      id: "pack-1",
      project_id: "proj-1",
      run_id: "712_MRIA25ST",
      jobs_json: [],
      ideas_json: [],
      overall_candidates_json: [],
      derived_globals_json: {},
    } as unknown as SignalPackRow;

    expect(() => plannerRowsFromCartManifest(pack, CUISINA_13_MANIFEST, "RUN_TEST")).toThrow(
      /visual guideline entry|visual_guidelines_pack_v1/
    );
  });

  it("returns stamped rows when pack has matching visual guideline entries", () => {
    const tpVideoEntry = {
      insights_id: "ins_894d424d84_28762_cdeep",
      analysis_tier: "top_performer_video",
      hook_text_preview: "Which sign is the chaos gremlin?",
      why_it_worked: "Sign-specific listicle hook",
      format_pattern: "story",
      evidence_kind: "instagram_post",
    };
    const tpCarouselEntry = {
      insights_id: "ins_894d424d84_28808_cdeep",
      analysis_tier: "top_performer_carousel",
      hook_text_preview: "Carousel hook",
      why_it_worked: "Strong saves",
      format_pattern: "listicle",
      evidence_kind: "instagram_post",
    };
    const pack = {
      id: "pack-1",
      project_id: "proj-1",
      run_id: "712_MRIA25ST",
      jobs_json: [
        { id: "idea_712_MRIA25ST_19", title: "Hook 1", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_18", title: "Hook 2", format: "video", platform: "Instagram" },
      ],
      ideas_json: [
        { id: "idea_712_MRIA25ST_19", title: "The Secret to Meal Variety", format: "video", platform: "Instagram" },
        { id: "idea_712_MRIA25ST_18", title: "Dinner Time Dilemmas Solved", format: "video", platform: "Instagram" },
      ],
      overall_candidates_json: [],
      derived_globals_json: {
        visual_guidelines_pack_v1: {
          entries: [
            tpVideoEntry,
            { ...tpVideoEntry, insights_id: "ins_894d424d84_28767_vdeep", format_pattern: "mixed" },
            { ...tpVideoEntry, insights_id: "ins_894d424d84_28770_vdeep", format_pattern: "unknown" },
            { ...tpVideoEntry, insights_id: "ins_894d424d84_28657_vdeep", format_pattern: "mixed" },
            {
              ...tpVideoEntry,
              insights_id: "ins_894d424d84_28765_vdeep",
              format_pattern: "text_on_screen",
            },
            tpCarouselEntry,
          ],
        },
      },
    } as unknown as SignalPackRow;

    const rows = plannerRowsFromCartManifest(pack, CUISINA_13_MANIFEST, "RUN_TEST");

    expect(rows).toHaveLength(13);
    expect(rows.filter((r) => r.target_flow_type === "FLOW_VID_HOOK_FIRST")).toHaveLength(2);
    expect(rows.filter((r) => r.target_flow_type === "FLOW_VID_PROMPT")).toHaveLength(4);
    expect(rows.every((r) => r.content_cart_pick === true)).toBe(true);
    expect(String(rows[7]?.content_idea ?? "")).toContain("chaos gremlin");
  });
});
