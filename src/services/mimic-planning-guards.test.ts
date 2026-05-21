import { describe, expect, it } from "vitest";
import { shouldExpandTopPerformerMimicImageForRow } from "./mimic-planning-guards.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";

describe("mimic-planning-guards", () => {
  it("skips post-format ideas without grounding to a deep single-frame reference", () => {
    expect(
      shouldExpandTopPerformerMimicImageForRow(
        { format: "post", idea_id: "idea_a" },
        null
      )
    ).toBe(false);
  });

  it("allows manual mimic image picks", () => {
    expect(
      shouldExpandTopPerformerMimicImageForRow(
        { manual_mimic_pick: true, mimic_kind: "image", grounding_insight_ids: ["ins_x"] },
        null
      )
    ).toBe(true);
  });

  it("rejects grounding to multi-frame carousel-only reference for image mimic", () => {
    const derived = {
      [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
        entries: [
          {
            insights_id: "ins_car_2f",
            analysis_tier: "top_performer_carousel",
            stored_inspection_media_json: {
              items: [
                { index: 1, vision_fetch_url: "https://x/1.jpg" },
                { index: 2, vision_fetch_url: "https://x/2.jpg" },
              ],
            },
          },
        ],
      },
    };
    expect(
      shouldExpandTopPerformerMimicImageForRow(
        { format: "post", grounding_insight_ids: ["ins_car_2f"] },
        derived
      )
    ).toBe(false);
  });
});
