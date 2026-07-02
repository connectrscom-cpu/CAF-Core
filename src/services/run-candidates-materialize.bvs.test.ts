import { describe, expect, it } from "vitest";
import { applyBvsOverridesToPlannerRows } from "./run-candidates-materialize.js";

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
