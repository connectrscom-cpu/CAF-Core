import { describe, expect, it } from "vitest";
import { defaultMaxJobsPerFlowType, DEFAULT_VIDEO_FLOW_PLAN_CAP } from "./default-plan-caps.js";
import { normalizePerFlowCaps } from "../repositories/core.js";

describe("defaultMaxJobsPerFlowType", () => {
  it("merges with DB caps: explicit override wins", () => {
    const merged = {
      ...defaultMaxJobsPerFlowType(),
      ...normalizePerFlowCaps({ FLOW_SCENE_ASSEMBLY: 5 }),
    };
    expect(merged.FLOW_SCENE_ASSEMBLY).toBe(5);
    expect(merged.HeyGen_Avatar_Script).toBe(1);
  });

  it("includes Flow Engine workbook keys and legacy video aliases", () => {
    const d = defaultMaxJobsPerFlowType();
    expect(d.Video_Scene_Generator).toBe(1);
    expect(d.Video_Script_Generator).toBe(1);
    expect(d.Video_Prompt_Generator).toBe(1);
    expect(d.HeyGen_Render_Video).toBe(1);
    expect(d.FLOW_SCENE_ASSEMBLY).toBe(1);
    expect(d.FLOW_HEYGEN_AVATAR_SCRIPT).toBe(1);
    expect(d.FLOW_HEYGEN_AVATAR_PROMPT).toBe(1);
    expect(d.FLOW_HEYGEN_NO_AVATAR_PROMPT).toBe(1);
    expect(d.Video_Script_HeyGen_Avatar).toBe(1);
    expect(d.Video_Prompt_HeyGen_Avatar).toBe(1);
    expect(d.Video_Prompt_HeyGen_NoAvatar).toBe(1);
  });

  it("defaults carousel flow keys to 10", () => {
    const d = defaultMaxJobsPerFlowType();
    expect(d.FLOW_CAROUSEL).toBe(10);
    expect(d.Flow_Carousel_Copy).toBe(10);
  });

  it("exports video default cap constant", () => {
    expect(DEFAULT_VIDEO_FLOW_PLAN_CAP).toBe(1);
  });
});
