import { describe, expect, it } from "vitest";
import {
  applyBvsOverridesToPlannerRows,
  applyIdeaPicksToPlannerRows,
} from "./run-candidates-materialize.js";

describe("applyBvsOverridesToPlannerRows", () => {
  it("stamps use_brand_visual_system on matching idea rows", () => {
    const rows = applyBvsOverridesToPlannerRows(
      [{ idea_id: "idea_a", content_idea: "Hook" }],
      [{ key: "idea_a", enabled: true }]
    );
    expect(rows[0]?.use_brand_visual_system).toBe(true);
  });

  it("stamps mimic rows by mimic key", () => {
    const rows = applyBvsOverridesToPlannerRows(
      [
        {
          idea_id: "mimic_ins9",
          manual_mimic_pick: true,
          mimic_kind: "carousel",
          grounding_insight_ids: ["ins9"],
        },
      ],
      [{ key: "mimic:carousel:ins9", enabled: true }]
    );
    expect(rows[0]?.use_brand_visual_system).toBe(true);
  });
});

describe("applyIdeaPicksToPlannerRows", () => {
  it("stamps target_flow_type and platform from content cart picks", () => {
    const rows = applyIdeaPicksToPlannerRows(
      [
        {
          idea_id: "idea_a",
          platform: "Facebook",
          format: "carousel",
          content_idea: "Hook",
        },
      ],
      [
        {
          idea_id: "idea_a",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Instagram",
          use_brand_visual_system: true,
        },
      ]
    );
    expect(rows[0]?.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
    expect(rows[0]?.platform).toBe("Instagram");
    expect(rows[0]?.target_platform).toBe("Instagram");
    expect(rows[0]?.use_brand_visual_system).toBe(true);
    expect(rows[0]?.content_cart_pick).toBe(true);
  });

  it("matches picks via candidate_id when idea_id is absent", () => {
    const rows = applyIdeaPicksToPlannerRows(
      [{ candidate_id: "712_MRIA25ST_7", format: "carousel", content_idea: "Salad" }],
      [
        {
          idea_id: "idea_712_MRIA25ST_7",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Instagram",
        },
      ]
    );
    expect(rows[0]?.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
    expect(rows[0]?.content_cart_pick).toBe(true);
  });

  it("falls back to positional picks when keys differ but counts align", () => {
    const rows = applyIdeaPicksToPlannerRows(
      [{ candidate_id: "row_a", format: "video", content_idea: "Hook video" }],
      [{ idea_id: "unrelated_key", target_flow_type: "FLOW_VID_HOOK_FIRST", platform: "Instagram" }],
      ["row_a"]
    );
    expect(rows[0]?.target_flow_type).toBe("FLOW_VID_HOOK_FIRST");
  });
});
