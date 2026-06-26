import { describe, expect, it } from "vitest";
import {
  shouldExpandMimicCarouselPickForRow,
  shouldExpandVisualFirstCarouselForRow,
  shouldExpandWhyMimicCarouselForRow,
  shouldSkipMimicFlowExpansion,
} from "./mimic-planning-guards.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_VISUAL_FIRST_CAROUSEL,
  FLOW_WHY_MIMIC_CAROUSEL,
} from "../domain/top-performer-mimic-flow-types.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";

const carouselDerived = {
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

describe("mimic-planning-guards carousel lanes", () => {
  it("allows manual mimic carousel picks only on mimic flow", () => {
    const row = {
      manual_mimic_pick: true,
      mimic_kind: "carousel",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(shouldExpandMimicCarouselPickForRow(row, carouselDerived)).toBe(true);
    expect(shouldExpandVisualFirstCarouselForRow(row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, row, carouselDerived)).toBe(
      false
    );
    expect(shouldSkipMimicFlowExpansion(FLOW_VISUAL_FIRST_CAROUSEL, row, carouselDerived)).toBe(true);
  });

  it("allows visual_first ideas only on visual-first flow", () => {
    const row = {
      format: "carousel",
      carousel_style: "visual_first",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(shouldExpandVisualFirstCarouselForRow(row, carouselDerived)).toBe(true);
    expect(shouldExpandMimicCarouselPickForRow(row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_VISUAL_FIRST_CAROUSEL, row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, row, carouselDerived)).toBe(
      true
    );
  });

  it("blocks text_heavy carousel from both TP-grounded flows", () => {
    const row = {
      format: "carousel",
      carousel_style: "text_heavy",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(shouldExpandVisualFirstCarouselForRow(row, carouselDerived)).toBe(false);
    expect(shouldExpandMimicCarouselPickForRow(row, carouselDerived)).toBe(false);
  });

  it("allows manual why_carousel picks only on FLOW_WHY_MIMIC_CAROUSEL", () => {
    const row = {
      manual_mimic_pick: true,
      mimic_kind: "why_carousel",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(shouldExpandWhyMimicCarouselForRow(row, carouselDerived)).toBe(true);
    expect(shouldExpandMimicCarouselPickForRow(row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_WHY_MIMIC_CAROUSEL, row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, row, carouselDerived)).toBe(true);
  });
});
