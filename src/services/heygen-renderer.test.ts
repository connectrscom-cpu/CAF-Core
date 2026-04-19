import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { HeygenConfigRow } from "../repositories/project-config.js";
import {
  applyHeygenEnvAvatarDefaults,
  buildHeyGenRequestBody,
  buildHeyGenVideoAgentRequestBody,
  firstHeyGenVideoInputUsesSilenceVoice,
  inferHeygenRenderModeFromFlowType,
  mapHeyGenV2StyleBodyToV3CreateVideoAvatar,
  normalizeHeyGenVideoAgentRequestForV3,
  mergeHeygenConfig,
  mergeHeygenConfigForJob,
  normalizeHeyGenLifecycleToken,
  pickHeyGenDownloadUrlFromStatus,
  resolveHeygenAgentDurationSec,
  resolveHeygenGeneratePath,
  resolveHeygenRenderMode,
  sanitizeGenForHeygenNoAvatar,
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

describe("resolveHeygenGeneratePath", () => {
  it("uses v3 direct video for script-led HEYGEN_AVATAR (n8n SCRIPT_AVATAR)", () => {
    expect(resolveHeygenGeneratePath("Video_Script_HeyGen_Avatar", "HEYGEN_AVATAR")).toBe("/v3/videos");
    expect(resolveHeygenGeneratePath("FLOW_HEYGEN_AVATAR_SCRIPT", "HEYGEN_AVATAR")).toBe("/v3/videos");
  });

  it("uses Video Agent v3 for prompt-led HEYGEN_AVATAR (n8n PROMPT_AVATAR)", () => {
    expect(resolveHeygenGeneratePath("Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR")).toBe("/v3/video-agents");
  });

  it("uses Video Agent v3 for HEYGEN_NO_AVATAR (n8n SCRIPT_NO_AVATAR)", () => {
    expect(resolveHeygenGeneratePath("Video_Prompt_HeyGen_NoAvatar", "HEYGEN_NO_AVATAR")).toBe("/v3/video-agents");
  });
});

describe("normalizeHeyGenLifecycleToken", () => {
  it("maps HeyGen OpenAPI-style labels to the first token before colon", () => {
    expect(normalizeHeyGenLifecycleToken("completed: Video rendered successfully")).toBe("completed");
    expect(normalizeHeyGenLifecycleToken("pending: Waiting in queue")).toBe("pending");
    expect(normalizeHeyGenLifecycleToken("failed: Rendering failed")).toBe("failed");
  });

  it("leaves plain statuses unchanged", () => {
    expect(normalizeHeyGenLifecycleToken("processing")).toBe("processing");
    expect(normalizeHeyGenLifecycleToken("COMPLETED")).toBe("completed");
  });
});

describe("pickHeyGenDownloadUrlFromStatus", () => {
  it("prefers video_url_caption over video_url (n8n Supabase upload binary)", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: {
        video_url: "https://cdn.example/plain.mp4",
        video_url_caption: "https://cdn.example/captions.mp4",
      },
    });
    expect(out.url).toBe("https://cdn.example/captions.mp4");
    expect(out.usedVideoUrlCaption).toBe(true);
  });

  it("falls back to video_url when caption URL absent", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: { video_url: "https://cdn.example/only.mp4" },
    });
    expect(out.url).toBe("https://cdn.example/only.mp4");
    expect(out.usedVideoUrlCaption).toBe(false);
  });

  it("falls back to data.download_url when video_url absent", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: { download_url: "https://cdn.example/dl.mp4", status: "completed" },
    });
    expect(out.url).toBe("https://cdn.example/dl.mp4");
    expect(out.usedVideoUrlCaption).toBe(false);
  });

  it("reads video_url nested under data.result", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: {
        status: "completed",
        result: { video_url: "https://cdn.example/nested.mp4" },
      },
    });
    expect(out.url).toBe("https://cdn.example/nested.mp4");
    expect(out.usedVideoUrlCaption).toBe(false);
  });

  it("reads top-level video_url_caption", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      video_url_caption: "https://cdn.example/top-cap.mp4",
    });
    expect(out.url).toBe("https://cdn.example/top-cap.mp4");
    expect(out.usedVideoUrlCaption).toBe(true);
  });

  it("prefers HeyGen v3 captioned_video_url when present", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: {
        video_url: "https://cdn.example/plain.mp4",
        captioned_video_url: "https://cdn.example/cap-v3.mp4",
      },
    });
    expect(out.url).toBe("https://cdn.example/cap-v3.mp4");
    expect(out.usedVideoUrlCaption).toBe(true);
  });

  it("surfaces v3 subtitle_url for the local-burn flow (data.subtitle_url)", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: {
        video_url: "https://cdn.example/plain.mp4",
        subtitle_url: "https://files.heygen.com/captions.srt",
        duration: 12.5,
      },
    });
    expect(out.url).toBe("https://cdn.example/plain.mp4");
    expect(out.usedVideoUrlCaption).toBe(false);
    expect(out.subtitleUrl).toBe("https://files.heygen.com/captions.srt");
    expect(out.durationSec).toBe(12.5);
  });

  it("falls back to caption_url alias and reads duration_sec when present", () => {
    const out = pickHeyGenDownloadUrlFromStatus({
      data: {
        video_url: "https://cdn.example/v.mp4",
        caption_url: "https://files.heygen.com/x.srt",
        duration_sec: 30,
      },
    });
    expect(out.subtitleUrl).toBe("https://files.heygen.com/x.srt");
    expect(out.durationSec).toBe(30);
  });

  it("returns null subtitleUrl + durationSec when HeyGen does not expose them", () => {
    const out = pickHeyGenDownloadUrlFromStatus({ data: { video_url: "https://cdn.example/v.mp4" } });
    expect(out.subtitleUrl).toBeNull();
    expect(out.durationSec).toBeNull();
  });
});

describe("normalizeHeyGenVideoAgentRequestForV3", () => {
  it("drops duration_sec and keeps only v3-allowed keys", () => {
    const raw = buildHeyGenVideoAgentRequestBody(
      { prompt_avatar_id: "av1" },
      { spoken_script: "Hello world this is long enough for the test script body here" },
      undefined,
      { agentMode: "prompt_avatar", flowType: "Video_Prompt_HeyGen_Avatar", taskId: "t1" }
    );
    const v3 = normalizeHeyGenVideoAgentRequestForV3(raw);
    expect(v3.duration_sec).toBeUndefined();
    expect(v3.prompt).toBeTruthy();
    expect(v3.avatar_id).toBe("av1");
  });
});

describe("mapHeyGenV2StyleBodyToV3CreateVideoAvatar", () => {
  it("maps video_inputs avatar script voice to v3 type avatar", () => {
    const v3 = mapHeyGenV2StyleBodyToV3CreateVideoAvatar({
      orientation: "portrait",
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: "look_123" },
          script_text: "Hello from the script.",
          voice: { type: "text", voice_id: "voice_abc", input_text: "Hello from the script." },
        },
      ],
    });
    expect(v3.type).toBe("avatar");
    expect(v3.avatar_id).toBe("look_123");
    expect(v3.script).toBe("Hello from the script.");
    expect(v3.voice_id).toBe("voice_abc");
    expect(v3.aspect_ratio).toBe("9:16");
  });

  it("omits voice_id when video_inputs has no voice (HeyGen uses avatar default)", () => {
    const v3 = mapHeyGenV2StyleBodyToV3CreateVideoAvatar({
      orientation: "portrait",
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: "look_123" },
          script_text: "Hello from the script.",
        },
      ],
    });
    expect(v3.voice_id).toBeUndefined();
    expect(v3.script).toBe("Hello from the script.");
  });

  it("injects caption: { file_format: 'srt' } so HeyGen returns subtitle_url for the local-burn flow", () => {
    const v3 = mapHeyGenV2StyleBodyToV3CreateVideoAvatar({
      orientation: "portrait",
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: "av1" },
          script_text: "Hi",
          voice: { type: "text", voice_id: "v1", input_text: "Hi" },
        },
      ],
    });
    expect(v3.caption).toEqual({ file_format: "srt" });
  });

  it("preserves caller-provided caption setting (does not overwrite explicit value)", () => {
    const v3 = mapHeyGenV2StyleBodyToV3CreateVideoAvatar({
      orientation: "portrait",
      caption: { file_format: "vtt" },
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: "av1" },
          script_text: "Hi",
          voice: { type: "text", voice_id: "v1", input_text: "Hi" },
        },
      ],
    });
    expect(v3.caption).toEqual({ file_format: "vtt" });
  });

  it("respects caption: false opt-out (omits caption from v3 body)", () => {
    const v3 = mapHeyGenV2StyleBodyToV3CreateVideoAvatar({
      orientation: "portrait",
      caption: false,
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: "av1" },
          script_text: "Hi",
          voice: { type: "text", voice_id: "v1", input_text: "Hi" },
        },
      ],
    });
    expect(v3.caption).toBeUndefined();
  });
});

describe("firstHeyGenVideoInputUsesSilenceVoice", () => {
  it("detects silence discriminator on first video input", () => {
    expect(
      firstHeyGenVideoInputUsesSilenceVoice({
        video_inputs: [{ voice: { type: "silence", duration: "12" }, prompt: "visual only" }],
      })
    ).toBe(true);
    expect(
      firstHeyGenVideoInputUsesSilenceVoice({
        video_inputs: [{ voice: { type: "text", voice_id: "x" }, script_text: "hi" }],
      })
    ).toBe(false);
  });
});

describe("resolveHeygenAgentDurationSec", () => {
  const bounds = { minSec: 20, maxSec: 300, missingFallbackSec: 30 };

  it("uses missing fallback when duration is absent or invalid", () => {
    expect(resolveHeygenAgentDurationSec(undefined, bounds)).toBe(30);
    expect(resolveHeygenAgentDurationSec("", bounds)).toBe(30);
    expect(resolveHeygenAgentDurationSec("x", bounds)).toBe(30);
  });

  it("bumps sub-min values instead of letting HeyGen default to ultra-short renders", () => {
    expect(resolveHeygenAgentDurationSec(5, bounds)).toBe(20);
    expect(resolveHeygenAgentDurationSec(4, bounds)).toBe(20);
  });

  it("respects explicit in-range values", () => {
    expect(resolveHeygenAgentDurationSec(45, bounds)).toBe(45);
  });
});

describe("buildHeyGenVideoAgentRequestBody", () => {
  it("builds prompt + duration + orientation + avatar_id for prompt_avatar", () => {
    const body = buildHeyGenVideoAgentRequestBody(
      { prompt_avatar_id: "av1", default_orientation: "landscape" },
      { spoken_script: "Hello world this is long enough", hook: "Hi" },
      undefined,
      { agentMode: "prompt_avatar", flowType: "Video_Prompt_HeyGen_Avatar", taskId: "t1" }
    );
    expect(body.avatar_id).toBe("av1");
    expect(body.orientation).toBe("landscape");
    expect(body.duration_sec).toBe(30);
    expect(String(body.prompt)).toContain("Main spoken content:");
    expect(String(body.prompt)).toContain("Use the assigned avatar");
  });

  it("omits avatar_id for no_avatar", () => {
    const body = buildHeyGenVideoAgentRequestBody(
      { prompt_avatar_id: "av1" },
      { spoken_script: "Hello world this is long enough" },
      undefined,
      { agentMode: "no_avatar", flowType: "Video_Script_HeyGen_NoAvatar", taskId: "t1" }
    );
    expect(body.avatar_id).toBeUndefined();
    expect(String(body.prompt)).toContain("Do not show an avatar");
  });

  it("does not duplicate synthesized plan when video_prompt is already full", () => {
    const gen = {
      hook: "Test hook here",
      spoken_script: "word ".repeat(25).trim(),
      video_prompt:
        "Hook: Test hook here. scene style: X. DUPLICATE_PLAN_TOKEN_XYZZY. Editing pacing: fast.",
      visual_direction: { scene_style: "X", lighting: "Y", background: "Z" },
      camera_instructions: { framing: "close", movement: "pan" },
      editing_notes: { pacing: "fast", cuts: "jump" },
      on_screen_text: ["A", "B"],
    };
    const body = buildHeyGenVideoAgentRequestBody({ prompt_avatar_id: "av_dup_test" }, gen, undefined, {
      agentMode: "prompt_avatar",
      flowType: "Video_Prompt_HeyGen_Avatar",
      taskId: "t1",
    });
    const p = String(body.prompt);
    expect((p.match(/DUPLICATE_PLAN_TOKEN_XYZZY/g) ?? []).length).toBe(1);
  });

  it("rewrites on-camera camera_instructions for no_avatar agent jobs", () => {
    const gen = {
      spoken_script: "Hello world this is long enough for the test script body here",
      camera_instructions: { framing: "Medium close-up centered on the speaker", movement: "dolly in" },
    };
    const sanitized = sanitizeGenForHeygenNoAvatar(gen as Record<string, unknown>);
    expect(String((sanitized.camera_instructions as { framing?: string }).framing)).toContain(
      "No on-camera talent"
    );
  });
});

describe("mergeHeygenConfig", () => {
  it("matches Sheets PROMPT render_mode to HEYGEN_AVATAR on prompt-led flows", () => {
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "p1",
        config_key: "heygen_model",
        value: "auto",
        render_mode: "PROMPT",
        platform: null,
        flow_type: null,
      }),
    ];
    const m = mergeHeygenConfig(rows, "TikTok", "Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(m.heygen_model).toBe("auto");
  });

  it("does not match SCRIPT rows to prompt-led flows", () => {
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "s1",
        config_key: "script_voice_id",
        value: "only_script",
        render_mode: "SCRIPT",
        platform: null,
        flow_type: null,
      }),
    ];
    const m = mergeHeygenConfig(rows, "TikTok", "Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(m.script_voice_id).toBeUndefined();
  });

  it("matches flow_type case-insensitively (sheet vs job casing)", () => {
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "av",
        config_key: "prompt_avatar_id",
        value: "avatar_xyz",
        platform: "instagram",
        flow_type: "video_prompt_heygen_avatar",
      }),
    ];
    const m = mergeHeygenConfig(rows, "Instagram", "Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(m.prompt_avatar_id).toBe("avatar_xyz");
  });
});

describe("applyHeygenEnvAvatarDefaults", () => {
  it("fills avatar ids when merged config has no avatar source", () => {
    const merged: Record<string, unknown> = {};
    applyHeygenEnvAvatarDefaults(merged, {
      HEYGEN_DEFAULT_AVATAR_ID: "avatar_env_1",
    } as AppConfig);
    expect(merged.avatar_id).toBe("avatar_env_1");
    expect(merged.prompt_avatar_id).toBe("avatar_env_1");
    expect(merged.script_avatar_id).toBe("avatar_env_1");
  });

  it("fills avatar_pool_json when no ids or pools", () => {
    const merged: Record<string, unknown> = {};
    applyHeygenEnvAvatarDefaults(merged, {
      HEYGEN_DEFAULT_AVATAR_POOL_JSON: '[{"avatar_id":"a1","voice_id":"v1"}]',
    } as AppConfig);
    expect(merged.avatar_pool_json).toContain("a1");
  });

  it("does not override existing DB merge", () => {
    const merged: Record<string, unknown> = { prompt_avatar_id: "from_db" };
    applyHeygenEnvAvatarDefaults(merged, {
      HEYGEN_DEFAULT_AVATAR_ID: "env_only",
    } as AppConfig);
    expect(merged.prompt_avatar_id).toBe("from_db");
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

  it("reuses avatar pool from another HeyGen flow row on the same platform when strict flow_type merge hid it", () => {
    const pool = JSON.stringify([
      { avatar_id: "22ad967055a94286a5aee1a4c6556a98", voice_id: "c76a2a4b9976410aa76a1c5f57f38c78" },
    ]);
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "pool_on_prompt_flow",
        config_key: "prompt_avatar_pool_json",
        value: pool,
        platform: "Instagram",
        flow_type: "Video_Prompt_HeyGen_Avatar",
        render_mode: "PROMPT",
      }),
    ];
    const merged = mergeHeygenConfigForJob(rows, "Instagram", "Video_Script_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(String(merged.prompt_avatar_pool_json ?? "")).toContain("22ad967055a94286a5aee1a4c6556a98");
  });

  it("reuses avatar pool from another platform when job platform has no pool (e.g. TikTok job, Instagram-only pool row)", () => {
    const igPool = JSON.stringify([{ avatar_id: "ig_avatar_only", voice_id: "ig_voice" }]);
    const ttPool = JSON.stringify([{ avatar_id: "tt_avatar", voice_id: "tt_voice" }]);
    const rows: HeygenConfigRow[] = [
      row({
        config_id: "ig_pool",
        config_key: "avatar_pool_json",
        value: igPool,
        platform: "Instagram",
        flow_type: null,
        render_mode: null,
      }),
      row({
        config_id: "tt_pool",
        config_key: "avatar_pool_json",
        value: ttPool,
        platform: "TikTok",
        flow_type: null,
        render_mode: null,
      }),
    ];
    const merged = mergeHeygenConfigForJob(rows, "TikTok", "Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(String(merged.avatar_pool_json ?? "")).toContain("tt_avatar");
    const mergedNoTt = mergeHeygenConfigForJob([rows[0]!], "TikTok", "Video_Prompt_HeyGen_Avatar", "HEYGEN_AVATAR");
    expect(String(mergedNoTt.avatar_pool_json ?? "")).toContain("ig_avatar_only");
  });
});

describe("buildHeyGenRequestBody", () => {
  it("injects voice from defaultVoiceId when config has no voice", () => {
    const body = buildHeyGenRequestBody({}, { spoken_script: "hello" }, undefined, {
      defaultVoiceId: "def_voice_1",
    });
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual({
      type: "text",
      voice_id: "def_voice_1",
      input_text: "hello",
    });
  });

  it("uses built-in fallback voice when no config, pool, or defaultVoiceId", () => {
    const body = buildHeyGenRequestBody({}, { spoken_script: "hello" }, undefined, {});
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual(
      expect.objectContaining({
        type: "text",
        voice_id: expect.stringMatching(/^[a-f0-9]{32}$/i),
        input_text: "hello",
      })
    );
  });

  it("uses generic avatar_id when prompt_avatar_id is absent (common sheet key)", () => {
    const body = buildHeyGenRequestBody(
      { avatar_id: "sheet_avatar_only", voice: "v9" },
      { spoken_script: "hello" },
      undefined,
      { flowType: "Video_Prompt_HeyGen_Avatar", taskId: "t_sheet" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect((vi[0].character as Record<string, unknown>).avatar_id).toBe("sheet_avatar_only");
  });

  it("picks avatar+voice from prompt_avatar_pool_json using taskId (stable) and strips internal keys", () => {
    const pool = JSON.stringify([
      { avatar_id: "a1", voice_id: "v1" },
      { avatar_id: "a2", voice_id: "v2" },
      { avatar_id: "a3", voice_id: "v3" },
    ]);
    const merged = {
      prompt_avatar_pool_json: pool,
      heygen_model: "auto",
    };
    const a = buildHeyGenRequestBody(merged, { spoken_script: "hi" }, undefined, {
      flowType: "Video_Prompt_HeyGen_Avatar",
      taskId: "TASK_stable_seed",
    });
    const b = buildHeyGenRequestBody(merged, { spoken_script: "hi" }, undefined, {
      flowType: "Video_Prompt_HeyGen_Avatar",
      taskId: "TASK_stable_seed",
    });
    expect(a.prompt_avatar_pool_json).toBeUndefined();
    expect(a.heygen_model).toBeUndefined();
    const via = a.video_inputs as Record<string, unknown>[];
    const vib = b.video_inputs as Record<string, unknown>[];
    expect(via[0].voice).toEqual(vib[0].voice);
    expect(String((via[0].character as Record<string, unknown>).avatar_id)).toMatch(/^[a-z0-9]+$/i);
  });

  it("fills voice from defaultVoiceId when override replaces video_inputs without voice", () => {
    const body = buildHeyGenRequestBody(
      {},
      { spoken_script: "hi" },
      { video_inputs: [{ script_text: "hi" }] },
      { defaultVoiceId: "fallback_voice_9" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual({
      type: "text",
      voice_id: "fallback_voice_9",
      input_text: "hi",
    });
  });

  it("uses script_avatar_pool_json for script-led flows", () => {
    const pool = JSON.stringify([{ avatar_id: "sa1", voice_id: "sv1" }]);
    const body = buildHeyGenRequestBody(
      { script_avatar_pool_json: pool },
      { spoken_script: "x" },
      undefined,
      { flowType: "Video_Script_HeyGen_Avatar", taskId: "t1" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual({ type: "text", voice_id: "sv1", input_text: "x" });
    expect((vi[0].character as Record<string, unknown>).avatar_id).toBe("sa1");
  });

  it("uses prompt_avatar_pool_json for script-led flows when script pool is absent", () => {
    const pool = JSON.stringify([{ avatar_id: "pa1", voice_id: "pv1" }]);
    const body = buildHeyGenRequestBody(
      { prompt_avatar_pool_json: pool },
      { spoken_script: "hello" },
      undefined,
      { flowType: "Video_Script_HeyGen_Avatar", taskId: "task_x" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect((vi[0].character as Record<string, unknown>).avatar_id).toBe("pa1");
    expect(vi[0].voice).toEqual({ type: "text", voice_id: "pv1", input_text: "hello" });
  });

  it("does not inject unrelated merged voice when pool entry has avatar_id only on script-led v3 jobs", () => {
    const pool = JSON.stringify([{ avatar_id: "avatar_only_1" }]);
    const body = buildHeyGenRequestBody(
      { prompt_avatar_pool_json: pool, voice_id: "shared_voice_99" },
      { spoken_script: "y" },
      undefined,
      { flowType: "Video_Script_HeyGen_Avatar", taskId: "t2" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect((vi[0].character as Record<string, unknown>).avatar_id).toBe("avatar_only_1");
    expect(vi[0].voice).toBeUndefined();
  });

  it("still uses merged voice when pool entry has avatar_id only on prompt-led flows (v2-style voice required)", () => {
    const pool = JSON.stringify([{ avatar_id: "avatar_only_1" }]);
    const body = buildHeyGenRequestBody(
      { prompt_avatar_pool_json: pool, voice_id: "shared_voice_99" },
      { spoken_script: "y" },
      undefined,
      { flowType: "Video_Prompt_HeyGen_Avatar", taskId: "t2" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect((vi[0].character as Record<string, unknown>).avatar_id).toBe("avatar_only_1");
    expect(vi[0].voice).toEqual({ type: "text", voice_id: "shared_voice_99", input_text: "y" });
  });

  it("uses HeyGen silence when only video_prompt exists so TTS does not read the visual description", () => {
    const body = buildHeyGenRequestBody(
      { voice: "v_only" },
      { video_prompt: "Cinematic café scene with warm light." },
      undefined,
      { defaultVoiceId: "def_v", visualOnlySilenceDurationSec: 12 }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual({ type: "silence", duration: "12" });
  });

  it("uses text TTS from spoken_script when both script and video_prompt exist", () => {
    const body = buildHeyGenRequestBody(
      {},
      { spoken_script: "Hello from the script.", video_prompt: "Sunset b-roll." },
      undefined,
      { defaultVoiceId: "v1" }
    );
    const vi = body.video_inputs as Record<string, unknown>[];
    expect(vi[0].voice).toEqual({
      type: "text",
      voice_id: "v1",
      input_text: "Hello from the script.",
    });
  });

  it("throws when avatar flow has no avatar in heygen_config", () => {
    expect(() =>
      buildHeyGenRequestBody(
        { voice: "v_only" },
        { spoken_script: "Hi" },
        undefined,
        { flowType: "Video_Prompt_HeyGen_Avatar", defaultVoiceId: "v1", taskId: "t1" }
      )
    ).toThrow(/HeyGen avatar flow requires an avatar/);
  });
});
