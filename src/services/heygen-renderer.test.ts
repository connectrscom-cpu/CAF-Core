import { describe, expect, it } from "vitest";
import type { HeygenConfigRow } from "../repositories/project-config.js";
import {
  buildHeyGenRequestBody,
  inferHeygenRenderModeFromFlowType,
  mergeHeygenConfig,
  mergeHeygenConfigForJob,
  resolveHeygenRenderMode,
} from "./heygen-renderer.js";

function row(partial: Partial<HeygenConfigRow> & Pick<HeygenConfigRow, "config_id" | "config_key" | "value">): HeygenConfigRow {
  return {
    id: "i",
    project_id: "p",
    platform: null,
    flow_type: null,
    render_mode: null,
    value_type: "string",
    is_active: true,
    notes: null,
    ...partial,
  };
}

describe("resolveHeygenRenderMode", () => {
  it("infers HEYGEN_NO_AVATAR for Video_Prompt_HeyGen_NoAvatar", () => {
    expect(resolveHeygenRenderMode("Video_Prompt_HeyGen_NoAvatar", undefined)).toBe("HEYGEN_NO_AVATAR");
  });

  it("infers HEYGEN_AVATAR for Video_Prompt_HeyGen_Avatar", () => {
    expect(resolveHeygenRenderMode("Video_Prompt_HeyGen_Avatar", undefined)).toBe("HEYGEN_AVATAR");
  });

  it("uses explicit render_mode over inference", () => {
    expect(resolveHeygenRenderMode("Video_Prompt_HeyGen_NoAvatar", "HEYGEN_AVATAR")).toBe("HEYGEN_AVATAR");
  });
});

describe("inferHeygenRenderModeFromFlowType", () => {
  it("returns null for unrelated flow names", () => {
    expect(inferHeygenRenderModeFromFlowType("FLOW_CAROUSEL")).toBeNull();
  });
});

describe("mergeHeygenConfigForJob", () => {
  it("pulls voice from a row that matches flow but not render_mode", () => {
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "a",
        config_key: "voice",
        value: "voice_from_avatar_row",
        flow_type: "Video_Prompt_HeyGen_NoAvatar",
        platform: "TikTok",
        render_mode: "HEYGEN_AVATAR",
      }),
    ];
    const strict = mergeHeygenConfig(rows, "TikTok", "Video_Prompt_HeyGen_NoAvatar", "HEYGEN_NO_AVATAR");
    expect(strict.voice).toBeUndefined();

    const merged = mergeHeygenConfigForJob(rows, "TikTok", "Video_Prompt_HeyGen_NoAvatar", "HEYGEN_NO_AVATAR");
    expect(merged.voice).toBe("voice_from_avatar_row");
  });
});

describe("buildHeyGenRequestBody", () => {
  it("injects voice from defaultVoiceId when config has no voice", () => {
    const body = buildHeyGenRequestBody({}, { spoken_script: "hello" }, undefined, {
      defaultVoiceId: "def_voice_1",
    });
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toBe("def_voice_1");
  });
});
