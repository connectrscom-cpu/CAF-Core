import { describe, expect, it } from "vitest";
import {
  resolveExtractVideoFramesFromSource,
  resolvePreferSourceVideoDownload,
} from "./inputs-video-evidence-preparation.js";

function miniConfig(overrides: Record<string, unknown> = {}) {
  return {
    CAF_TOP_PERFORMER_EXTRACT_VIDEO_FRAMES: "auto",
    CAF_TOP_PERFORMER_DOWNLOAD_SOURCE_VIDEO: "auto",
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
