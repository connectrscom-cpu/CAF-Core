import { describe, expect, it } from "vitest";
import { cartBvsOverrides, cartItemsToMaterializeBody } from "./cart-run-materialize";
import type { ContentCartItem } from "./types";

describe("cartBvsOverrides", () => {
  it("maps idea and mimic keys with default BVS on", () => {
    const items: ContentCartItem[] = [
      {
        id: "idea_abc",
        kind: "idea",
        title: "Idea",
        flowDestination: "Carousel",
        flowTypeRaw: "FLOW_CAROUSEL",
      },
      {
        id: "tp_ins1",
        kind: "top_performer",
        title: "TP",
        flowDestination: "Visual mimic",
        flowTypeRaw: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
        useBrandVisualSystem: false,
      },
    ];
    const overrides = cartBvsOverrides(items);
    expect(overrides).toEqual([
      { key: "idea_abc", enabled: true },
      { key: "mimic:carousel:ins1", enabled: false },
    ]);
  });

  it("includes bvs_overrides in materialize body", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "idea_x",
        kind: "idea",
        title: "X",
        flowDestination: "Carousel",
        flowTypeRaw: "FLOW_CAROUSEL",
        useBrandVisualSystem: true,
      },
    ]);
    expect(body.bvs_overrides).toEqual([{ key: "idea_x", enabled: true }]);
  });

  it("maps video top performers to mimic video with lane override", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "tp_ins_video",
        kind: "top_performer",
        title: "Demo reel",
        flowDestination: "Script avatar",
        flowTypeRaw: "FLOW_VID_SCRIPT",
        format: "product_demo",
        videoIntent: "script_avatar",
      },
    ]);
    expect(body.mimic_picks).toEqual([
      { insights_id: "ins_video", mimic_kind: "video", video_intent: "script_avatar" },
    ]);
  });

  it("carries assigned HeyGen presenter onto mimic picks and cart manifest", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "tp_ins_video",
        kind: "top_performer",
        title: "Demo reel",
        flowDestination: "Script avatar",
        flowTypeRaw: "FLOW_VID_SCRIPT",
        format: "product_demo",
        videoIntent: "script_avatar",
        heygenAvatarId: "av_host_1",
        heygenVoiceId: "voice_host_1",
      },
      {
        id: "idea_idea_vid_1",
        kind: "idea",
        title: "Talking tip",
        flowDestination: "Script avatar",
        flowTypeRaw: "FLOW_VID_SCRIPT",
        format: "video",
        heygenAvatarId: "av_brand_2",
        heygenVoiceId: "voice_brand_2",
      },
    ]);
    expect(body.mimic_picks[0]).toMatchObject({
      insights_id: "ins_video",
      heygen_avatar_id: "av_host_1",
      heygen_voice_id: "voice_host_1",
    });
    expect(body.idea_picks[0]).toMatchObject({
      idea_id: "idea_vid_1",
      heygen_avatar_id: "av_brand_2",
      heygen_voice_id: "voice_brand_2",
    });
    expect(body.cart_manifest.map((l) => l.heygen_avatar_id)).toEqual(["av_host_1", "av_brand_2"]);
  });

  it("derives video_intent from flowTypeRaw when cart lane is explicit", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "tp_ins_prompt",
        kind: "top_performer",
        title: "Story TP",
        flowDestination: "Prompt avatar",
        flowTypeRaw: "FLOW_VID_PROMPT",
        format: "story",
      },
    ]);
    expect(body.mimic_picks).toEqual([
      { insights_id: "ins_prompt", mimic_kind: "video", video_intent: "prompt_avatar" },
    ]);
  });

  it("includes idea_picks with cart flow and platform per idea", () => {
    const body = cartItemsToMaterializeBody([
      {
        id: "idea_idea_712_MRIA25ST_7",
        kind: "idea",
        title: "Fresh Summer Salad Series",
        flowDestination: "Brand-style carousel",
        flowTypeRaw: "FLOW_VISUAL_FIRST_CAROUSEL",
        format: "carousel",
        platform: "Instagram",
        useBrandVisualSystem: true,
      },
      {
        id: "idea_idea_712_MRIA25ST_1",
        kind: "idea",
        title: "Creative Meal Planning Hacks",
        flowDestination: "Carousel",
        flowTypeRaw: "FLOW_CAROUSEL",
        format: "carousel",
        platform: "Instagram",
        useBrandVisualSystem: false,
      },
    ]);
    expect(body.idea_ids).toEqual(["idea_712_MRIA25ST_7", "idea_712_MRIA25ST_1"]);
    expect(body.idea_picks).toEqual([
      {
        idea_id: "idea_712_MRIA25ST_7",
        target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
        platform: "Instagram",
        use_brand_visual_system: true,
      },
      {
        idea_id: "idea_712_MRIA25ST_1",
        target_flow_type: "FLOW_CAROUSEL",
        platform: "Instagram",
        use_brand_visual_system: false,
      },
    ]);
  });
});

describe("cartItemsToMaterializeBody — CUISINA 15-item cart", () => {
  it("maps to 10 idea picks + 5 mimic picks (15 planner rows)", () => {
    const lines = [
      ["idea_idea_712_MRIA25ST_19", "idea", "FLOW_VID_HOOK_FIRST", "video", "Instagram", true],
      ["idea_idea_712_MRIA25ST_18", "idea", "FLOW_VID_HOOK_FIRST", "video", "Instagram", true],
      ["idea_idea_712_MRIA25ST_20", "idea", "FLOW_VID_HOOK_FIRST", "video", "Instagram", true],
      ["idea_idea_712_MRIA25ST_1", "idea", "FLOW_CAROUSEL", "carousel", "Instagram", false],
      ["idea_idea_712_MRIA25ST_2", "idea", "FLOW_CAROUSEL", "carousel", "Instagram", true],
      ["idea_idea_712_MRIA25ST_9", "idea", "FLOW_VISUAL_FIRST_CAROUSEL", "carousel", "Instagram", true],
      ["idea_idea_712_MRIA25ST_11", "idea", "FLOW_VISUAL_FIRST_CAROUSEL", "carousel", "Instagram", true],
      ["idea_idea_712_MRIA25ST_23", "idea", "FLOW_VISUAL_FIRST_CAROUSEL", "carousel", "Facebook", true],
      ["idea_idea_712_MRIA25ST_22", "idea", "FLOW_VISUAL_FIRST_CAROUSEL", "carousel", "Instagram", true],
      ["idea_idea_712_MRIA25ST_26", "idea", "FLOW_VID_PROMPT", "video", "Instagram", true],
      ["tp_ins_894d424d84_28762_cdeep", "top_performer", "FLOW_VID_PROMPT", "story", "Instagram", true],
      ["tp_ins_894d424d84_28658_vdeep", "top_performer", "FLOW_VID_PROMPT", "unknown", "Instagram", true],
      ["tp_ins_894d424d84_28763_vdeep", "top_performer", "FLOW_VID_PROMPT", "product_demo", "Instagram", true],
      ["tp_ins_894d424d84_28692_cdeep", "top_performer", "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", "unknown", "Instagram", true],
      ["tp_ins_894d424d84_28657_vdeep", "top_performer", "FLOW_VID_PROMPT", "mixed", "Instagram", true],
    ] as const;

    const items: ContentCartItem[] = lines.map(([id, kind, flow, format, platform, bvs]) => ({
      id,
      kind: kind as ContentCartItem["kind"],
      title: id,
      flowDestination: flow,
      flowTypeRaw: flow,
      format,
      platform,
      useBrandVisualSystem: bvs,
      ...(kind === "top_performer" && format === "story"
        ? { mimicMode: "why_carousel" as const, renderMode: "full_bleed" as const }
        : {}),
      ...(id.includes("28692") ? { mimicMode: "replica" as const, renderMode: "full_bleed" as const } : {}),
      ...(id.includes("28658") || id.includes("28763") || id.includes("28657")
        ? { videoIntent: "prompt_avatar" as const }
        : {}),
    }));

    const body = cartItemsToMaterializeBody(items);
    expect(body.idea_ids).toHaveLength(10);
    expect(body.idea_picks).toHaveLength(10);
    expect(body.mimic_picks).toHaveLength(5);
    expect(body.idea_picks.find((p) => p.idea_id.endsWith("_23"))?.platform).toBe("Facebook");
    expect(body.idea_picks.find((p) => p.idea_id.endsWith("_26"))?.target_flow_type).toBe("FLOW_VID_PROMPT");
    expect(body.mimic_picks.filter((p) => p.mimic_kind === "video")).toHaveLength(4);
    expect(body.mimic_picks.find((p) => p.insights_id.includes("28692"))?.mimic_kind).toBe("carousel");
    expect(body.cart_manifest).toHaveLength(15);
  });
});
