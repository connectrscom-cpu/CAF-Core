import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  resolveMimicImageCall,
  assertMimicImageProviderConfigured,
  nvidiaImageEditModelId,
  isNvidiaVisualGenAiUnavailable,
  isVisualGenAiUnavailableError,
  dashScopeSizeParam,
} from "./mimic-image-provider.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    MIMIC_IMAGE_PROVIDER: "nvidia",
    OPENAI_API_KEY: "sk-openai",
    OPENAI_API_BASE: "https://api.openai.com/v1",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    DASHSCOPE_API_KEY: "sk-dashscope",
    DASHSCOPE_API_BASE: "https://dashscope-intl.aliyuncs.com/api/v1",
    MIMIC_IMAGE_DASHSCOPE_MODEL: "qwen-image-edit-max",
    MIMIC_IMAGE_NVIDIA_MODEL: "qwen/qwen-image-edit",
    MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI: false,
    NVIDIA_NIM_API_KEY: "nvapi-test",
    NVIDIA_NIM_API_BASE: "https://integrate.api.nvidia.com/v1",
    MIMIC_IMAGE_DEFAULT_SIZE: "1024x1536",
    MIMIC_IMAGE_INPUT_FIDELITY: "high",
    MIMIC_IMAGE_QUALITY: "high",
    ...overrides,
  } as AppConfig;
}

describe("resolveMimicImageCall", () => {
  it("routes to DashScope Qwen image edit when configured", () => {
    const call = resolveMimicImageCall(baseConfig({ MIMIC_IMAGE_PROVIDER: "dashscope" }));
    expect(call.provider).toBe("dashscope");
    expect(call.model).toBe("qwen-image-edit-max");
    expect(call.editsEndpoint).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    );
    expect(call.providerLabel).toBe("dashscope-qwen-image-edit-max");
  });

  it("routes to NVIDIA Qwen image edit when configured", () => {
    const call = resolveMimicImageCall(baseConfig());
    expect(call.provider).toBe("nvidia");
    expect(call.model).toBe("qwen/qwen-image-edit");
    expect(call.editsEndpoint).toBe("https://integrate.api.nvidia.com/v1/images/edits");
    expect(call.providerLabel).toBe("nvidia-qwen-image-edit");
  });

  it("routes to OpenAI gpt-image-1 when explicitly configured", () => {
    const call = resolveMimicImageCall(baseConfig({ MIMIC_IMAGE_PROVIDER: "openai" }));
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-image-1");
    expect(call.editsEndpoint).toBe("https://api.openai.com/v1/images/edits");
    expect(call.providerLabel).toBe("openai-gpt-image-1");
  });
});

describe("assertMimicImageProviderConfigured", () => {
  it("requires OPENAI_API_KEY for openai provider", () => {
    expect(() =>
      assertMimicImageProviderConfigured(
        baseConfig({ MIMIC_IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "" })
      )
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("requires DASHSCOPE_API_KEY for dashscope provider", () => {
    expect(() =>
      assertMimicImageProviderConfigured(
        baseConfig({ MIMIC_IMAGE_PROVIDER: "dashscope", DASHSCOPE_API_KEY: "" })
      )
    ).toThrow(/DASHSCOPE_API_KEY/);
  });

  it("requires NVIDIA_NIM_API_KEY for nvidia provider", () => {
    expect(() =>
      assertMimicImageProviderConfigured(
        baseConfig({
          MIMIC_IMAGE_PROVIDER: "nvidia",
          NVIDIA_NIM_API_KEY: "",
          MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI: false,
        })
      )
    ).toThrow(/NVIDIA_NIM_API_KEY/);
  });

  it("falls back to OpenAI config when NVIDIA key missing but fallback explicitly enabled", () => {
    const call = assertMimicImageProviderConfigured(
      baseConfig({ NVIDIA_NIM_API_KEY: "", MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI: true })
    );
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-image-1");
  });
});

describe("dashScopeSizeParam", () => {
  it("converts CAF WxH to DashScope W*H", () => {
    expect(dashScopeSizeParam("1024x1536")).toBe("1024*1536");
    expect(dashScopeSizeParam("auto")).toBe("1024*1536");
    expect(dashScopeSizeParam(undefined)).toBe("1024*1536");
  });
});

describe("nvidiaImageEditModelId", () => {
  it("strips vendor prefix for catalog model id", () => {
    expect(nvidiaImageEditModelId("qwen/qwen-image-edit-2511")).toBe("qwen-image-edit-2511");
  });
});

describe("isNvidiaVisualGenAiUnavailable", () => {
  it("detects integrate 404 page", () => {
    expect(isNvidiaVisualGenAiUnavailable(404, "404 page not found\n")).toBe(true);
    expect(isNvidiaVisualGenAiUnavailable(401, "unauthorized")).toBe(false);
  });
});

describe("isVisualGenAiUnavailableError", () => {
  it("matches nvidia unavailable message", () => {
    expect(
      isVisualGenAiUnavailableError(
        "NVIDIA NIM Qwen image edit failed (404): Visual GenAI endpoint is not available on integrate.api.nvidia.com"
      )
    ).toBe(true);
    expect(isVisualGenAiUnavailableError("timeout")).toBe(false);
  });
});
