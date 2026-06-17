import { describe, expect, it } from "vitest";
import {
  resolveExtractVideoFramesFromSource,
  resolvePreferSourceVideoDownload,
  resolveWhisperSkipWhenCaptionChars,
  shouldRunWhisper,
} from "./inputs-video-evidence-preparation.js";
import { pickSourceVideoUrlFromStoredInspectionMedia } from "../repositories/inputs-evidence-insights.js";

function miniConfig(overrides: Record<string, unknown> = {}) {
  return {
    CAF_TOP_PERFORMER_EXTRACT_VIDEO_FRAMES: "auto",
    CAF_TOP_PERFORMER_DOWNLOAD_SOURCE_VIDEO: "auto",
    CAF_TOP_PERFORMER_VIDEO_WHISPER: "auto",
    CAF_TOP_PERFORMER_WHISPER_SKIP_CAPTION_CHARS: 0,
    ...overrides,
  } as import("../config.js").AppConfig;
}

describe("resolveExtractVideoFramesFromSource", () => {
  it("defaults to enabled in auto mode", () => {
    expect(resolveExtractVideoFramesFromSource(miniConfig(), {})).toBe(true);
  });

  it("respects env off", () => {
    expect(resolveExtractVideoFramesFromSource(miniConfig({ CAF_TOP_PERFORMER_EXTRACT_VIDEO_FRAMES: "off" }), {})).toBe(
      false
    );
  });

  it("respects criteria disable", () => {
    expect(
      resolveExtractVideoFramesFromSource(miniConfig(), {
        top_performer: { extract_frames_from_video: false },
      })
    ).toBe(false);
  });

  it("criteria can force on when env auto", () => {
    expect(
      resolveExtractVideoFramesFromSource(miniConfig(), {
        top_performer: { extract_frames_from_video: true },
      })
    ).toBe(true);
  });
});

describe("resolvePreferSourceVideoDownload", () => {
  it("defaults to enabled in auto mode", () => {
    expect(resolvePreferSourceVideoDownload(miniConfig(), {})).toBe(true);
  });

  it("respects env off", () => {
    expect(resolvePreferSourceVideoDownload(miniConfig({ CAF_TOP_PERFORMER_DOWNLOAD_SOURCE_VIDEO: "off" }), {})).toBe(
      false
    );
  });

  it("respects criteria disable", () => {
    expect(
      resolvePreferSourceVideoDownload(miniConfig(), {
        top_performer: { download_source_video: false },
      })
    ).toBe(false);
  });
});

describe("pickSourceVideoUrlFromStoredInspectionMedia", () => {
  it("returns public_url for archived source_video item", () => {
    const url = pickSourceVideoUrlFromStoredInspectionMedia({
      items: [
        { role: "video_frame", ok: true, public_url: "https://cdn.example/frame.jpg" },
        { role: "source_video", ok: true, public_url: "https://supabase.example/source.mp4" },
      ],
    });
    expect(url).toBe("https://supabase.example/source.mp4");
  });
});

describe("shouldRunWhisper (transcribe all)", () => {
  it("runs Whisper even when caption is long (default skip threshold 0)", () => {
    const longCaption = "x".repeat(500);
    expect(shouldRunWhisper(longCaption, miniConfig(), {})).toBe(true);
  });

  it("skips when whisper_skip_when_caption_chars is set", () => {
    const longCaption = "x".repeat(500);
    expect(
      shouldRunWhisper(longCaption, miniConfig(), {
        top_performer: { whisper_skip_when_caption_chars: 80 },
      })
    ).toBe(false);
    expect(resolveWhisperSkipWhenCaptionChars(miniConfig(), { top_performer: { whisper_skip_when_caption_chars: 80 } })).toBe(
      80
    );
  });
});
