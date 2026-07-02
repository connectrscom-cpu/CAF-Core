import { describe, expect, it, vi } from "vitest";
import {
  shouldExpandMimicCarouselPickForRow,
  shouldExpandVisualFirstCarouselForRow,
  shouldExpandWhyMimicCarouselForRow,
  shouldSkipMimicFlowExpansion,
  whyMimicSilPlanningEligible,
} from "./mimic-planning-guards.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_VISUAL_FIRST_CAROUSEL,
  FLOW_WHY_MIMIC_CAROUSEL,
} from "../domain/top-performer-mimic-flow-types.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";

vi.mock("../config.js", () => ({
  loadConfig: () => ({
    WHY_MIMIC_REQUIRE_SUBSTANTIVE_SIL: true,
    WHY_MIMIC_MIN_SUBSTANTIVE_SLIDE_RATIO: 1,
    SIL_WHY_IT_WORKS_MIN_CHARS: 144,
    SIL_VISUAL_DESCRIPTION_MIN_CHARS: 96,
    SIL_STRATEGIC_THESIS_MIN_CHARS: 240,
  }),
}));

const LONG_WHY =
  "Opens with sign identity and sets meme expectation for the carousel series. The hook names the audience tribe immediately so scrollers self-select, and the visual tone signals humor without needing to read every line.";
const LONG_WHY_2 =
  "Deepens the series with a darker humor beat that rewards swipers who stayed after the hook. It escalates the joke without breaking the astrological frame established on slide one while keeping shareable pacing.";
const LONG_VISUAL =
  "Cartoon zodiac character on bold flat color background with large centered sign name as headline text and playful meme composition.";
const LONG_VISUAL_2 =
  "Same meme grid layout with Scorpio caricature and punchline caption below the character portrait on saturated background with crisp outline art.";
const DECK_WHY =
  "Strong information gap on the cover and concrete proof before the ask — builds trust before CTA. The deck sequences education with social proof so the audience feels informed before the follow prompt, using curiosity on slide one and credibility beats before the close.";

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

const carouselDerivedSubstantive = {
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
        aesthetic_analysis_json: {
          why_it_worked: DECK_WHY,
          deck_as_whole_summary:
            "Educational listicle that escalates from hook to proof to CTA while keeping visual consistency and meme pacing across every swipe.",
          slides: [
            { slide_index: 1, why_it_works: LONG_WHY, visual_description: LONG_VISUAL },
            { slide_index: 2, why_it_works: LONG_WHY_2, visual_description: LONG_VISUAL_2 },
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

  it("blocks Why Mimic when SIL is only heuristic-padded", () => {
    const row = {
      manual_mimic_pick: true,
      mimic_kind: "why_carousel",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(whyMimicSilPlanningEligible(carouselDerived, ["ins_car_2f"])).toBe(false);
    expect(shouldExpandWhyMimicCarouselForRow(row, carouselDerived)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_WHY_MIMIC_CAROUSEL, row, carouselDerived)).toBe(true);
  });

  it("allows manual why_carousel picks when SIL is substantive", () => {
    const row = {
      manual_mimic_pick: true,
      mimic_kind: "why_carousel",
      grounding_insight_ids: ["ins_car_2f"],
    };
    expect(whyMimicSilPlanningEligible(carouselDerivedSubstantive, ["ins_car_2f"])).toBe(true);
    expect(shouldExpandWhyMimicCarouselForRow(row, carouselDerivedSubstantive)).toBe(true);
    expect(shouldExpandMimicCarouselPickForRow(row, carouselDerivedSubstantive)).toBe(false);
    expect(shouldSkipMimicFlowExpansion(FLOW_WHY_MIMIC_CAROUSEL, row, carouselDerivedSubstantive)).toBe(
      false
    );
    expect(shouldSkipMimicFlowExpansion(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, row, carouselDerivedSubstantive)).toBe(
      true
    );
  });
});
