import { describe, expect, it } from "vitest";
import {
  assignVideoFlowForPlanningRow,
  DEFAULT_VIDEO_ROUTING,
  flowTypeMatchesVideoIntent,
  isSceneAssemblyFlowType,
  normalizeVideoStyle,
  pickVideoFlowForIntent,
  resolveVideoIntent,
  VideoPlanningSlotBudget,
} from "./video-flow-routing.js";

describe("video-flow-routing", () => {
  it("normalizes video_style aliases", () => {
    expect(normalizeVideoStyle("script_led")).toBe("script_avatar");
    expect(normalizeVideoStyle("broll")).toBe("no_avatar");
    expect(normalizeVideoStyle("multi_scene")).toBe("no_avatar");
  });

  it("resolves explicit video_style first", () => {
    const d = resolveVideoIntent(
      { format: "video", video_style: "script_avatar", platform: "Instagram" },
      DEFAULT_VIDEO_ROUTING
    );
    expect(d.intent).toBe("script_avatar");
    expect(d.confidence).toBe("explicit");
  });

  it("maps b-roll language to no_avatar", () => {
    const d = resolveVideoIntent(
      {
        format: "video",
        summary: "Visual montage with stock b-roll, no talking head",
      },
      DEFAULT_VIDEO_ROUTING
    );
    expect(d.intent).toBe("no_avatar");
    expect(d.confidence).toBe("heuristic");
  });

  it("excludes scene assembly from routing", () => {
    expect(isSceneAssemblyFlowType("FLOW_VID_SCENES")).toBe(true);
    expect(flowTypeMatchesVideoIntent("FLOW_VID_SCENES", "no_avatar", null)).toBe(false);
  });

  it("picks script flow for script_avatar intent", () => {
    const ft = pickVideoFlowForIntent(
      [
        { flow_type: "FLOW_VID_PROMPT", priority_weight: 10 },
        { flow_type: "FLOW_VID_SCRIPT", priority_weight: 5 },
      ],
      "script_avatar",
      new Map()
    );
    expect(ft).toBe("FLOW_VID_SCRIPT");
  });

  it("picks no-avatar flow for no_avatar intent", () => {
    const ft = pickVideoFlowForIntent(
      [
        { flow_type: "FLOW_VID_PROMPT", priority_weight: 10 },
        { flow_type: "FLOW_VID_PROMPT_NO_AVATAR", priority_weight: 1 },
      ],
      "no_avatar",
      new Map()
    );
    expect(ft).toBe("FLOW_VID_PROMPT_NO_AVATAR");
  });

  it("prefers core HeyGen flows over product video flows at higher priority", () => {
    const ft = pickVideoFlowForIntent(
      [
        { flow_type: "FLOW_PRODUCT_PROBLEM", priority_weight: 6 },
        { flow_type: "FLOW_VID_PROMPT", priority_weight: 0.7 },
      ],
      "prompt_avatar",
      new Map([["FLOW_PRODUCT_PROBLEM", "prompt_led"]])
    );
    expect(ft).toBe("FLOW_VID_PROMPT");
  });

  it("falls back to product flow when no core flow matches intent", () => {
    const ft = pickVideoFlowForIntent(
      [{ flow_type: "FLOW_PRODUCT_FEATURE", priority_weight: 5 }],
      "prompt_avatar",
      new Map([["FLOW_PRODUCT_FEATURE", "prompt_led"]])
    );
    expect(ft).toBe("FLOW_PRODUCT_FEATURE");
  });

  it("matches product flow to script_avatar via script_led mode", () => {
    expect(
      flowTypeMatchesVideoIntent("FLOW_PRODUCT_FEATURE", "script_avatar", "script_led")
    ).toBe(true);
    expect(
      flowTypeMatchesVideoIntent("FLOW_PRODUCT_FEATURE", "prompt_avatar", "script_led")
    ).toBe(false);
  });

  it("distributes default-routed video ideas across open HeyGen lanes", () => {
    const enabledFlows = [
      { flow_type: "FLOW_VID_PROMPT", priority_weight: 0.7 },
      { flow_type: "FLOW_VID_SCRIPT", priority_weight: 0.7 },
      { flow_type: "FLOW_VID_PROMPT_NO_AVATAR", priority_weight: 0.7 },
    ];
    const budget = new VideoPlanningSlotBudget(enabledFlows, {
      maxVideoPlan: 20,
      perFlowCaps: {
        FLOW_VID_PROMPT: 1,
        FLOW_VID_SCRIPT: 1,
        FLOW_VID_PROMPT_NO_AVATAR: 1,
      },
    });
    const rows = [
      { format: "video", idea_id: "idea_a", platform: "Instagram", confidence: 0.9 },
      { format: "video", idea_id: "idea_b", platform: "Instagram", confidence: 0.8 },
      { format: "video", idea_id: "idea_c", platform: "Instagram", confidence: 0.7 },
    ];

    const assigned = rows.map((row) =>
      assignVideoFlowForPlanningRow(row, DEFAULT_VIDEO_ROUTING, enabledFlows, new Map(), budget)
    );

    expect(assigned.map((a) => a?.flowType)).toEqual([
      "FLOW_VID_PROMPT",
      "FLOW_VID_SCRIPT",
      "FLOW_VID_PROMPT_NO_AVATAR",
    ]);
    expect(assigned[1]?.assignment).toBe("slot_fill");
    expect(assigned[2]?.assignment).toBe("slot_fill");
  });

  it("keeps explicit video_style on its lane even when other lanes are open", () => {
    const enabledFlows = [
      { flow_type: "FLOW_VID_PROMPT", priority_weight: 0.7 },
      { flow_type: "FLOW_VID_SCRIPT", priority_weight: 0.7 },
    ];
    const budget = new VideoPlanningSlotBudget(enabledFlows, {
      maxVideoPlan: 20,
      perFlowCaps: { FLOW_VID_PROMPT: 1, FLOW_VID_SCRIPT: 1 },
    });

    assignVideoFlowForPlanningRow(
      { format: "video", video_style: "script_avatar", platform: "Instagram" },
      DEFAULT_VIDEO_ROUTING,
      enabledFlows,
      new Map(),
      budget
    );

    const second = assignVideoFlowForPlanningRow(
      { format: "video", video_style: "script_avatar", platform: "Instagram" },
      DEFAULT_VIDEO_ROUTING,
      enabledFlows,
      new Map(),
      budget
    );

    expect(second).toBeNull();
  });
});
