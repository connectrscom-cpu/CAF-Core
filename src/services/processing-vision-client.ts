/**
 * Processing-only multimodal vision (top-performer deep passes).
 * Does not affect job generation, mimic render, or approval review.
 */
import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import {
  openaiChatMultimodal,
  type ChatContentPart,
} from "./openai-chat-multimodal.js";
import { assertVisionImageUrlsSafeForRemoteFetch } from "./inputs-top-performer-vision-relay.js";

export type ProcessingVisionProvider = "openai" | "nvidia";

export interface ProcessingVisionCallConfig {
  provider: ProcessingVisionProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  /** When set, image_url parts are trimmed to this count (Nemotron VL limit). */
  maxImagesPerRequest: number | null;
}

function chatCompletionsUrl(apiBase: string): string {
  const base = apiBase.replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function isNvidiaModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("nvidia/") || m.includes("nemotron");
}

/**
 * Clamp image parts for providers with a per-request image cap (e.g. Nemotron VL ≤4).
 */
export function clampMultimodalImagesForProvider(
  user_content: ChatContentPart[],
  maxImages: number | null,
  opts?: { deckSlideCount?: number }
): ChatContentPart[] {
  if (maxImages == null || maxImages < 1) return user_content;

  const textParts = user_content.filter((p): p is { type: "text"; text: string } => p.type === "text");
  const imageParts = user_content.filter((p) => p.type === "image_url");
  if (imageParts.length <= maxImages) return user_content;

  const deckTotal = opts?.deckSlideCount ?? imageParts.length;
  const note =
    `\n\nVision provider limit: deck has ${deckTotal} slide(s) but only the first ${maxImages} ` +
    `slide image(s) are attached. Return a slides array with exactly ${maxImages} entries ` +
    `(slide_index 1..${maxImages}). Deck-wide summary fields may use caption + attached slides only.`;

  const firstText = textParts[0]?.text ?? "";
  const mergedText = firstText.includes("Vision provider limit:") ? firstText : `${firstText}${note}`;

  const out: ChatContentPart[] = [{ type: "text", text: mergedText }];
  for (const part of imageParts.slice(0, maxImages)) {
    out.push(part);
  }
  return out;
}

export function resolveProcessingVisionCall(
  config: AppConfig,
  profileModel: string,
  opts?: { provider?: ProcessingVisionProvider; defaultNvidiaModel?: string }
): ProcessingVisionCallConfig {
  const provider = opts?.provider ?? config.PROCESSING_VISION_PROVIDER;
  const trimmedProfileModel = profileModel.trim();
  const defaultNvidia = opts?.defaultNvidiaModel?.trim() || config.PROCESSING_VISION_NVIDIA_MODEL;

  if (provider === "nvidia") {
    const model =
      trimmedProfileModel && isNvidiaModelId(trimmedProfileModel)
        ? trimmedProfileModel
        : defaultNvidia;
    return {
      provider: "nvidia",
      apiKey: config.NVIDIA_NIM_API_KEY?.trim() ?? "",
      endpoint: chatCompletionsUrl(config.NVIDIA_NIM_API_BASE),
      model,
      maxImagesPerRequest: config.PROCESSING_VISION_NVIDIA_MAX_IMAGES,
    };
  }

  return {
    provider: "openai",
    apiKey: config.OPENAI_API_KEY?.trim() ?? "",
    endpoint: chatCompletionsUrl(config.OPENAI_API_BASE),
    model: trimmedProfileModel || config.OPENAI_APPROVAL_REVIEW_MODEL || "gpt-4o-mini",
    maxImagesPerRequest: null,
  };
}

/** Vision client for post-approval generated-output analysis (Nemotron by default). */
export function resolveApprovalReviewVisionCall(config: AppConfig): ProcessingVisionCallConfig {
  const model =
    config.APPROVAL_REVIEW_NVIDIA_MODEL?.trim() ||
    config.PROCESSING_VISION_NVIDIA_MODEL;
  return resolveProcessingVisionCall(config, model, {
    provider: config.APPROVAL_REVIEW_VISION_PROVIDER,
    defaultNvidiaModel: model,
  });
}

export function assertApprovalReviewVisionConfigured(config: AppConfig): ProcessingVisionCallConfig {
  const call = resolveApprovalReviewVisionCall(config);
  if (!call.apiKey) {
    if (call.provider === "nvidia") {
      throw new Error("NVIDIA_NIM_API_KEY is required when APPROVAL_REVIEW_VISION_PROVIDER=nvidia");
    }
    throw new Error("OPENAI_API_KEY is required when APPROVAL_REVIEW_VISION_PROVIDER=openai");
  }
  return call;
}

export function assertProcessingVisionConfigured(config: AppConfig, profileModel: string): ProcessingVisionCallConfig {
  const call = resolveProcessingVisionCall(config, profileModel);
  if (!call.apiKey) {
    if (call.provider === "nvidia") {
      throw new Error("NVIDIA_NIM_API_KEY is required when PROCESSING_VISION_PROVIDER=nvidia");
    }
    throw new Error("OPENAI_API_KEY is required for processing vision (PROCESSING_VISION_PROVIDER=openai)");
  }
  return call;
}

export async function processingVisionChatMultimodal(
  config: AppConfig,
  profileModel: string,
  params: {
    system_prompt: string;
    user_content: ChatContentPart[];
    max_tokens: number;
    response_format?: "json_object" | "text";
    deckSlideCount?: number;
  },
  audit?: OpenAiAuditContext | null,
  opts?: { provider?: ProcessingVisionProvider; defaultNvidiaModel?: string }
): Promise<{ content: string; model: string; total_tokens: number; provider: ProcessingVisionProvider }> {
  const call = opts?.provider
    ? (() => {
        const c = resolveProcessingVisionCall(config, profileModel, opts);
        if (!c.apiKey) {
          throw new Error(
            c.provider === "nvidia"
              ? "NVIDIA_NIM_API_KEY is required for Nemotron vision"
              : "OPENAI_API_KEY is required for OpenAI vision"
          );
        }
        return c;
      })()
    : assertProcessingVisionConfigured(config, profileModel);
  const user_content = clampMultimodalImagesForProvider(params.user_content, call.maxImagesPerRequest, {
    deckSlideCount: params.deckSlideCount,
  });

  const imageUrls = user_content
    .filter((p): p is { type: "image_url"; image_url: { url: string } } => p.type === "image_url")
    .map((p) => p.image_url.url);
  assertVisionImageUrlsSafeForRemoteFetch(imageUrls);

  const out = await openaiChatMultimodal(
    call.apiKey,
    {
      model: call.model,
      system_prompt: params.system_prompt,
      user_content,
      max_tokens: params.max_tokens,
      response_format: params.response_format,
    },
    audit,
    {
      endpoint: call.endpoint,
      provider: call.provider,
      timeoutMs: config.PROCESSING_VISION_CHAT_TIMEOUT_MS,
    }
  );

  return { ...out, provider: call.provider };
}
