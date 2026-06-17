import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  defaultVideoVisionMaxTokens,
  resolveVideoVisionChunkSize,
  videoVisionImageDetail,
} from "./video-insights-vision.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PROCESSING_VISION_PROVIDER: "nvidia",
    PROCESSING_VISION_NVIDIA_MAX_IMAGES: 4,
    PROCESSING_VISION_NVIDIA_MODEL: "nvidia/nemotron-nano-12b-v2-vl",
    NVIDIA_NIM_API_KEY: "test",
    NVIDIA_NIM_API_BASE: "https://integrate.api.nvidia.com/v1",
    OPENAI_API_KEY: "test",
    OPENAI_API_BASE: "https://api.openai.com/v1",
    ...overrides,
  } as AppConfig;
}

describe("video-insights-vision nvidia tuning", () => {
  it("caps nvidia video chunks at 2 images even when provider max is 4", () => {
    expect(resolveVideoVisionChunkSize(baseConfig(), "nvidia/nemotron-nano-12b-v2-vl")).toBe(2);
    expect(resolveVideoVisionChunkSize(baseConfig({ PROCESSING_VISION_NVIDIA_MAX_IMAGES: 1 }), "x")).toBe(1);
  });

  it("returns null chunk size for openai provider", () => {
    expect(
      resolveVideoVisionChunkSize(baseConfig({ PROCESSING_VISION_PROVIDER: "openai" }), "gpt-4o-mini")
    ).toBeNull();
  });

  it("uses low detail for all nvidia frames and lower max tokens", () => {
    expect(videoVisionImageDetail("nvidia", 0)).toBe("low");
    expect(videoVisionImageDetail("nvidia", 5)).toBe("low");
    expect(videoVisionImageDetail("openai", 0)).toBe("high");
    expect(videoVisionImageDetail("openai", 2)).toBe("low");
    expect(defaultVideoVisionMaxTokens("nvidia")).toBe(4096);
    expect(defaultVideoVisionMaxTokens("openai")).toBe(12_000);
  });
});
