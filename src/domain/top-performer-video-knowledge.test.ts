import { describe, expect, it } from "vitest";
import { buildTopPerformerVideoKnowledgeForLlm } from "./top-performer-video-knowledge.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "./signal-pack-top-performer-knowledge.js";

describe("buildTopPerformerVideoKnowledgeForLlm", () => {
  it("returns scoped video knowledge for grounded insight", () => {
    const derived = {
      [SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]: {
        entries: [
          {
            insights_id: "ins_vid_1",
            analysis_tier: "top_performer_video",
            format_pattern: "talking_head",
            why_it_worked: "Strong opener",
            aesthetic_analysis_json: {
              hook_visual: "Face close-up",
              video_arc: "Hook → list → CTA",
              replication_blueprint: {
                steps_to_remake: ["Open with face hook", "List 3 beats"],
              },
              frames: [{ frame_index: 1, visual_description: "Talking head center" }],
            },
          },
        ],
      },
    };

    const knowledge = buildTopPerformerVideoKnowledgeForLlm(derived, ["ins_vid_1"]);
    expect(knowledge).toMatchObject({
      insights_id: "ins_vid_1",
      format_pattern: "talking_head",
      hook_visual: "Face close-up",
    });
    expect(knowledge?.replication_blueprint).toMatchObject({
      steps_to_remake: ["Open with face hook", "List 3 beats"],
    });
    expect(Array.isArray(knowledge?.frames)).toBe(true);
  });

  it("returns null when no video tier match", () => {
    expect(buildTopPerformerVideoKnowledgeForLlm(null, ["ins_missing"])).toBeNull();
  });
});
