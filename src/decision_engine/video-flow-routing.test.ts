import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_ROUTING,
  flowTypeMatchesVideoIntent,
  isSceneAssemblyFlowType,
  normalizeVideoStyle,
  pickVideoFlowForIntent,
  resolveVideoIntent,
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

  it("matches product flow to script_avatar via script_led mode", () => {
    expect(
      flowTypeMatchesVideoIntent("FLOW_PRODUCT_FEATURE", "script_avatar", "script_led")
    ).toBe(true);
    expect(
      flowTypeMatchesVideoIntent("FLOW_PRODUCT_FEATURE", "prompt_avatar", "script_led")
    ).toBe(false);
  });
});
