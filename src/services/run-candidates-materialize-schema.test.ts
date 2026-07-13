import { describe, expect, it } from "vitest";
import { runCandidatesMaterializeBodySchema } from "./run-candidates-materialize.js";

describe("runCandidatesMaterializeBodySchema", () => {
  it("accepts manual mode with why_carousel mimic picks", () => {
    const parsed = runCandidatesMaterializeBodySchema.safeParse({
      mode: "manual",
      idea_ids: ["idea_1"],
      mimic_picks: [{ insights_id: "ins_car_1", mimic_kind: "why_carousel" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts manual mode with only mimic picks", () => {
    const parsed = runCandidatesMaterializeBodySchema.safeParse({
      mode: "manual",
      mimic_picks: [
        { insights_id: "ins_a", mimic_kind: "carousel" },
        { insights_id: "ins_b", mimic_kind: "why_carousel" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts manual mode with idea_picks from content cart", () => {
    const parsed = runCandidatesMaterializeBodySchema.safeParse({
      mode: "manual",
      idea_ids: ["idea_1"],
      idea_picks: [
        {
          idea_id: "idea_1",
          target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
          platform: "Instagram",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts manual mode with only cart_manifest (marketer content cart)", () => {
    const parsed = runCandidatesMaterializeBodySchema.safeParse({
      mode: "manual",
      cart_manifest: [
        {
          cart_item_id: "idea_idea_712_x",
          kind: "idea",
          target_flow_type: "FLOW_CAROUSEL",
          platform: "Instagram",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown mimic_kind", () => {
    const parsed = runCandidatesMaterializeBodySchema.safeParse({
      mode: "manual",
      mimic_picks: [{ insights_id: "ins_a", mimic_kind: "why_mimic" }],
    });
    expect(parsed.success).toBe(false);
  });
});
