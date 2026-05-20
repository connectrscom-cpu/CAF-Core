import { describe, expect, it } from "vitest";
import {
  buildTopPerformerKnowledgeV1,
  mergeTopPerformerKnowledgeIntoDerivedGlobals,
  pickTopPerformerKnowledgeForStep,
  SIGNAL_PACK_DERIVED_GLOBALS_KEYS,
} from "./signal-pack-top-performer-knowledge.js";

describe("signal-pack-top-performer-knowledge", () => {
  const derived = {
    visual_guidelines_pack_v1: {
      entries: [
        {
          insights_id: "ins_car_1",
          analysis_tier: "top_performer_carousel",
          format_pattern: "listicle",
          why_it_worked: "Strong hook on slide 1",
        },
        {
          insights_id: "ins_vid_1",
          analysis_tier: "top_performer_video",
          format_pattern: "talking_head",
          why_it_worked: "Fast pattern interrupt in first 2s",
        },
        {
          insights_id: "ins_img_1",
          analysis_tier: "top_performer_deep",
          format_pattern: "promo",
          why_it_worked: "Bold type hierarchy",
        },
      ],
    },
    hashtag_leaderboard_v1: [{ hashtag: "#astrology", count: 3 }],
    hashtag_leaderboard_rows_scanned: 100,
    top_performer_styling_cues_v1: ["Use high contrast headline bands"],
    creative_design_intelligence_v1: {
      carousel_structure_hints: { text_density: "mixed" },
    },
  };

  it("splits visual guideline entries by media lane (analysis_tier), not content format", () => {
    const v1 = buildTopPerformerKnowledgeV1(derived);
    expect(v1.media_lanes.carousel.entry_count).toBe(1);
    expect(v1.media_lanes.video.entry_count).toBe(1);
    expect(v1.media_lanes.image.entry_count).toBe(1);
    expect(v1.media_lanes.carousel.entries[0]?.insights_id).toBe("ins_car_1");
    expect(v1.media_lanes.video.content_format_groups[0]?.content_format_key).toBe("talking_head");
  });

  it("routes pipeline steps to the correct slice", () => {
    const merged = mergeTopPerformerKnowledgeIntoDerivedGlobals(derived);
    const carousel = pickTopPerformerKnowledgeForStep(merged, "carousel_copy");
    expect("media_lane" in carousel && carousel.media_lane).toBe("carousel");

    const video = pickTopPerformerKnowledgeForStep(merged, "video_prompt");
    expect("media_lane" in video && video.media_lane).toBe("video");

    const pub = pickTopPerformerKnowledgeForStep(merged, "publication");
    expect("hashtag_leaderboard_v1" in pub && pub.hashtag_leaderboard_v1).toHaveLength(1);
  });

  it("writes top_performer_knowledge_v1 key on merge", () => {
    const merged = mergeTopPerformerKnowledgeIntoDerivedGlobals(derived);
    expect(merged[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.topPerformerKnowledgeV1]).toBeDefined();
    expect(derived[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.topPerformerKnowledgeV1]).toBeUndefined();
  });
});
