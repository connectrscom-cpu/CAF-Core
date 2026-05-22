import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  clampMultimodalImagesForProvider,
  resolveProcessingVisionCall,
} from "./processing-vision-client.js";

function miniConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PROCESSING_VISION_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-openai",
    OPENAI_API_BASE: "https://api.openai.com/v1",
    NVIDIA_NIM_API_KEY: "nv-nim",
    NVIDIA_NIM_API_BASE: "https://integrate.api.nvidia.com/v1",
    PROCESSING_VISION_NVIDIA_MODEL: "nvidia/nemotron-nano-12b-v2-vl",
    PROCESSING_VISION_NVIDIA_MAX_IMAGES: 4,
    ...overrides,
  } as AppConfig;
}

describe("resolveProcessingVisionCall", () => {
  it("defaults to OpenAI with profile model", () => {
    const call = resolveProcessingVisionCall(miniConfig(), "gpt-4o-mini");
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.apiKey).toBe("sk-openai");
    expect(call.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.maxImagesPerRequest).toBeNull();
  });

  it("uses Nemotron when PROCESSING_VISION_PROVIDER=nvidia", () => {
    const call = resolveProcessingVisionCall(
      miniConfig({ PROCESSING_VISION_PROVIDER: "nvidia" }),
      "gpt-4o-mini"
    );
    expect(call.provider).toBe("nvidia");
    expect(call.model).toBe("nvidia/nemotron-nano-12b-v2-vl");
    expect(call.apiKey).toBe("nv-nim");
    expect(call.maxImagesPerRequest).toBe(4);
  });

  it("honors profile nvidia model id when set", () => {
    const call = resolveProcessingVisionCall(miniConfig({ PROCESSING_VISION_PROVIDER: "nvidia" }), "nvidia/custom-vl");
    expect(call.model).toBe("nvidia/custom-vl");
  });
});

describe("clampMultimodalImagesForProvider", () => {
  it("leaves content unchanged when under cap", () => {
    const input = [
      { type: "text" as const, text: "hello" },
      { type: "image_url" as const, image_url: { url: "https://a.test/1.jpg" } },
    ];
    expect(clampMultimodalImagesForProvider(input, 4)).toEqual(input);
  });

  it("trims excess slide images and adds provider note", () => {
    const input = [
      { type: "text" as const, text: "Slide count: 6" },
      { type: "image_url" as const, image_url: { url: "https://a.test/1.jpg" } },
      { type: "image_url" as const, image_url: { url: "https://a.test/2.jpg" } },
      { type: "image_url" as const, image_url: { url: "https://a.test/3.jpg" } },
      { type: "image_url" as const, image_url: { url: "https://a.test/4.jpg" } },
      { type: "image_url" as const, image_url: { url: "https://a.test/5.jpg" } },
      { type: "image_url" as const, image_url: { url: "https://a.test/6.jpg" } },
    ];
    const out = clampMultimodalImagesForProvider(input, 4, { deckSlideCount: 6 });
    expect(out.filter((p) => p.type === "image_url")).toHaveLength(4);
    expect(out[0]?.type === "text" && out[0].text).toContain("Vision provider limit");
    expect(out[0]?.type === "text" && out[0].text).toContain("6 slide(s)");
  });
});
