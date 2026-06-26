import { describe, expect, it } from "vitest";

import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";

import {

  carouselRenderStyleFromMimicPayload,

  resolveJobFlowDisplayLabel,

} from "./job-flow-display-label.js";

import {

  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,

  FLOW_TOP_PERFORMER_MIMIC_IMAGE,

  FLOW_VISUAL_FIRST_CAROUSEL,

  FLOW_WHY_MIMIC_CAROUSEL,

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



  it("labels TP-grounded carousel lanes with render path in the title", () => {

    expect(resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {}).flow_label).toBe(

      "Reference Replica · Carousel"

    );

    expect(

      resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {

        mimic_v1: { mode: "carousel_visual" },

      }).flow_label

    ).toBe("Reference Replica · Carousel · Full-bleed");

    expect(

      resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {

        mimic_v1: { mode: "template_bg" },

      }).flow_label

    ).toBe("Reference Replica · Carousel · Listicle");



    expect(resolveJobFlowDisplayLabel(FLOW_VISUAL_FIRST_CAROUSEL, {}).flow_label).toBe(

      "Visual-First · Carousel"

    );

    expect(

      resolveJobFlowDisplayLabel(FLOW_VISUAL_FIRST_CAROUSEL, {

        mimic_v1: { mode: "carousel_visual" },

      }).flow_label

    ).toBe("Visual-First · Carousel · Full-bleed");



    expect(resolveJobFlowDisplayLabel(FLOW_WHY_MIMIC_CAROUSEL, {}).flow_label).toBe("Why Mimic · Carousel");

    expect(

      resolveJobFlowDisplayLabel(FLOW_WHY_MIMIC_CAROUSEL, {

        mimic_v1: { mode: "template_bg", execution_mode: "why_mimic" },

      }).flow_label

    ).toBe("Why Mimic · Carousel · Listicle · Text prompt");



    expect(resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_IMAGE, {}).flow_label).toBe(

      "Mimic · Image · Ref edit"

    );

  });



  it("resolves why_carousel mimic_kind from flow_type without candidate_data", () => {

    const info = resolveJobFlowDisplayLabel(FLOW_WHY_MIMIC_CAROUSEL, {

      mimic_v1: { mode: "carousel_visual", execution_mode: "why_mimic" },

    });

    expect(info.mimic_kind).toBe("why_carousel");

    expect(info.flow_label).toBe("Why Mimic · Carousel · Full-bleed · Text prompt");

  });



  it("builds flow_detail from mimic_render_settings snapshot", () => {

    const info = resolveJobFlowDisplayLabel(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, {

      mimic_v1: { mode: "carousel_visual", schema_version: 1, reference_items: [] },

      mimic_render_context: { visual_similarity_pct: 70 },

      mimic_render_settings: {

        schema_version: 1,

        image_provider: "bfl",

        bfl_model: "flux-2-flex",

        visual_similarity_pct: 70,

        image_input_mode: "reference_edit",

        carousel_text_via_flux: false,

        why_mimic_copy_enabled: false,

      },

    });

    expect(info.flow_detail).toBe(

      "FLUX Flex · 70% similarity · reference image edit · DocAI / HTML overlay"

    );

  });



  it("leaves regular carousel and video jobs unchanged", () => {

    const carousel = resolveJobFlowDisplayLabel(CANONICAL_FLOW_TYPES.CAROUSEL, {

      candidate_data: { candidate_id: "idea_617_MQI2AQ2X_1", format: "carousel" },

    });

    expect(carousel.is_mimic_replication).toBe(false);

    expect(carousel.flow_label).toBe(CANONICAL_FLOW_TYPES.CAROUSEL);

    expect(carousel.flow_detail).toBeNull();



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

    expect(info.flow_label).toBe("Reference Replica · Carousel · Listicle");

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



describe("carouselRenderStyleFromMimicPayload", () => {

  it("maps mimic_v1.mode to visual vs listicle", () => {

    expect(carouselRenderStyleFromMimicPayload({ mimic_v1: { mode: "carousel_visual" } })).toBe(

      "visual"

    );

    expect(carouselRenderStyleFromMimicPayload({ mimic_v1: { mode: "template_bg" } })).toBe("listicle");

    expect(carouselRenderStyleFromMimicPayload({})).toBeNull();

  });

});


