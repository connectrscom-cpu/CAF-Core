import { describe, expect, it } from "vitest";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  buildDefaultLlmSlideFromInsightSlide,
  listCarouselMimicReferencesFromSignalPack,
} from "./mimic-text-overlay-lab-load.js";

describe("mimic-text-overlay-lab-load", () => {
  it("lists only carousel mimic references from a signal pack", () => {
    const pack = {
      derived_globals_json: {
        [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
          entries: [
            {
              insights_id: "ins_deep",
              analysis_tier: "top_performer_deep",
              hook_text_preview: "Image hook",
              inspection_media: { items: [{ public_url: "https://x/a.jpg" }] },
            },
            {
              insights_id: "ins_car",
              analysis_tier: "top_performer_carousel",
              hook_text_preview: "Carousel hook",
              format_pattern: "listicle",
              inspection_media: { items: [{ public_url: "https://x/b.jpg" }] },
            },
          ],
        },
      },
    } as unknown as SignalPackRow;

    const refs = listCarouselMimicReferencesFromSignalPack(pack);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.insights_id).toBe("ins_car");
    expect(refs[0]?.mimic_kind).toBe("carousel");
  });

  it("buildDefaultLlmSlideFromInsightSlide maps text_blocks to lab copy", () => {
    const llm = buildDefaultLlmSlideFromInsightSlide({
      text_blocks: [{ role: "headline", text: "ARIES" }],
    });
    expect(llm.text_blocks).toEqual([{ role: "headline", text: "[NEW] ARIES" }]);
  });
});
