import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { resolveMimicImageCall, assertMimicImageProviderConfigured } from "./mimic-image-provider.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    MIMIC_IMAGE_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-openai",
    OPENAI_API_BASE: "https://api.openai.com/v1",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    MIMIC_IMAGE_NVIDIA_MODEL: "qwen/qwen-image-edit",
    NVIDIA_NIM_API_KEY: "nvapi-test",
    NVIDIA_NIM_API_BASE: "https://integrate.api.nvidia.com/v1",
    MIMIC_IMAGE_DEFAULT_SIZE: "1024x1536",
    MIMIC_IMAGE_INPUT_FIDELITY: "high",
    MIMIC_IMAGE_QUALITY: "high",
    ...overrides,
  } as AppConfig;
}

describe("resolveMimicImageCall", () => {
  it("defaults to OpenAI gpt-image-1 edits endpoint", () => {
    const call = resolveMimicImageCall(baseConfig());
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-image-1");
    expect(call.editsEndpoint).toBe("https://api.openai.com/v1/images/edits");
    expect(call.providerLabel).toBe("openai-gpt-image-1");
  });

  it("routes to NVIDIA NIM Qwen image edit when configured", () => {
    const call = resolveMimicImageCall(
      baseConfig({
        MIMIC_IMAGE_PROVIDER: "nvidia",
        MIMIC_IMAGE_NVIDIA_MODEL: "qwen/qwen-image-edit-2511",
      })
    );
    expect(call.provider).toBe("nvidia");
    expect(call.model).toBe("qwen/qwen-image-edit-2511");
    expect(call.editsEndpoint).toBe("https://integrate.api.nvidia.com/v1/images/edits");
    expect(call.providerLabel).toBe("nvidia-qwen-image-edit-2511");
  });
});

describe("assertMimicImageProviderConfigured", () => {
  it("requires OPENAI_API_KEY for openai provider", () => {
    expect(() =>
      assertMimicImageProviderConfigured(baseConfig({ OPENAI_API_KEY: "" }))
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("requires NVIDIA_NIM_API_KEY for nvidia provider", () => {
    expect(() =>
      assertMimicImageProviderConfigured(
        baseConfig({ MIMIC_IMAGE_PROVIDER: "nvidia", NVIDIA_NIM_API_KEY: "" })
      )
    ).toThrow(/NVIDIA_NIM_API_KEY/);
  });
});
