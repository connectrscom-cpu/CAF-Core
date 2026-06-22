import { describe, expect, it } from "vitest";
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import { resolveJobFlowDisplayLabel } from "./job-flow-display-label.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_VISUAL_FIRST_CAROUSEL,
} from "./top-performer-mimic-flow-types.js";

describe("resolveJobFlowDisplayLabel", () => {
  it("labels manual mimic video picks routed to HeyGen", () => {
    const info = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.VID_PROMPT, {
      candidate_data: {
        manual_mimic_pick: true,
        mimic_kind: "video",
        candidate_id: "mimic_ins_aebcb95dd2_27355_vdeep",
        video_style: "prompt_avatar",
        format: "video",
      },
    });
    expect(info.is_mimic_replication).toBe(true);
    expect(info.mimic_kind).toBe("video");
    expect(info.flow_label).toBe("Mimic · Video → HeyGen · Prompt avatar");
    expect(info.flow_type).toBe(CANONICAL_FLOW_TYPES.VID_PROMPT);
  });

  it("labels no-avatar HeyGen mimic video picks", () => {
    const info = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR, {
      candidate_data: {
        candidate_id: "mimic_ins_aebcb95dd2_27361_vdeep",
        format: "video",
      },
    });
    expect(info.flow_label).toBe("Mimic · Video → HeyGen · No avatar");
  });

  it("labels TP-grounded carousel flows as mimic", () => {
    expect(resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {}).flow_label).toBe(
      "Mimic · Carousel"
    );
    expect(resolveJobFlowDisplayLabel(FLOW_VISUAL_FIRST_CAROUSEL, {}).flow_label).toBe(
      "Mimic · Carousel (visual-first)"
    );
    expect(resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_IMAGE, {}).flow_label).toBe("Mimic · Image");
  });

  it("leaves regular carousel and video jobs unchanged", () => {
    const carousel = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.CAROUSEL, {
      candidate_data: { candidate_id: "idea_617_MQI2AQ2X_1", format: "carousel" },
    });
    expect(carousel.is_mimic_replication).toBe(false);
    expect(carousel.flow_label).toBe(CANONICAL_FLOW_TYPES.CAROUSEL);

    const video = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.VID_SCRIPT, {
      candidate_data: { candidate_id: "idea_617_MQI2AQ2X_10", format: "video" },
    });
    expect(video.is_mimic_replication).toBe(false);
    expect(video.flow_label).toBe(CANONICAL_FLOW_TYPES.VID_SCRIPT);
  });

  it("detects mimic replication from mimic_v1 on generation_payload", () => {
    const info = resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {
      mimic_v1: { mode: "template_bg", reference_items: [{ object_path: "x" }] },
    });
    expect(info.is_mimic_replication).toBe(true);
    expect(info.flow_label).toBe("Mimic · Carousel");
  });

  it("labels carousel-grounded HeyGen video jobs with carousel ref", () => {
    const info = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.VID_SCRIPT, {
      candidate_data: {
        candidate_id: "idea_617_MQI2AQ2X_10",
        format: "video",
        video_style: "script_avatar",
        grounding_insight_ids: ["ins_aebcb95dd2_27439_broad"],
      },
    });
    expect(info.is_mimic_replication).toBe(true);
    expect(info.mimic_kind).toBe("carousel");
    expect(info.flow_label).toBe("Mimic · Carousel ref → HeyGen · Script avatar");
  });
});
