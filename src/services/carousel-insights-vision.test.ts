import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  carouselVisionImageDetail,
  defaultCarouselVisionMaxTokens,
  resolveCarouselVisionChunkSize,
} from "./carousel-insights-vision.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PROCESSING_VISION_PROVIDER: "nvidia",
    PROCESSING_VISION_NVIDIA_MAX_IMAGES: 4,
    PROCESSING_VISION_NVIDIA_MODEL: "nvidia/nemotron-nano-12b-v2-vl",
    PROCESSING_VISION_CHAT_TIMEOUT_MS: 300_000,
    NVIDIA_NIM_API_KEY: "test",
    NVIDIA_NIM_API_BASE: "https://integrate.api.nvidia.com/v1",
    OPENAI_API_KEY: "test",
    OPENAI_API_BASE: "https://api.openai.com/v1",
    ...overrides,
  } as AppConfig;
}

describe("carousel-insights-vision nvidia tuning", () => {
  it("caps nvidia carousel chunks at 2 images", () => {
    expect(resolveCarouselVisionChunkSize(baseConfig(), "nvidia/nemotron-nano-12b-v2-vl")).toBe(2);
  });

  it("uses low detail for nvidia and lower max tokens", () => {
    expect(carouselVisionImageDetail("nvidia", 0, 12)).toBe("low");
    expect(carouselVisionImageDetail("openai", 0, 12)).toBe("high");
    expect(carouselVisionImageDetail("openai", 3, 12)).toBe("low");
    expect(defaultCarouselVisionMaxTokens("nvidia")).toBe(4096);
    expect(defaultCarouselVisionMaxTokens("openai")).toBe(8192);
  });
});
