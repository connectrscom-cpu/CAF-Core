import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import {
  processingVisionChatMultimodal,
  resolveProcessingVisionCall,
  type ProcessingVisionProvider,
} from "./processing-vision-client.js";
import {
  mergeVideoInsightChunks,
  TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT,
  TOP_PERFORMER_VIDEO_NVIDIA_JSON_APPENDIX,
} from "./video-insights-llm-normalize.js";

export interface VideoFramesVisionResult {
  content: string;
  model: string;
  parsed: Record<string, unknown> | null;
}

/** Nemotron VL is sensitive to multi-image payloads — keep video chunks small. */
const NVIDIA_VIDEO_MAX_IMAGES_PER_CHUNK = 2;

export function resolveVideoVisionChunkSize(config: AppConfig, profileModel: string): number | null {
  const call = resolveProcessingVisionCall(config, profileModel);
  if (call.provider !== "nvidia") return null;
  const providerCap = call.maxImagesPerRequest ?? 4;
  return Math.min(Math.max(1, providerCap), NVIDIA_VIDEO_MAX_IMAGES_PER_CHUNK);
}

export function videoVisionImageDetail(provider: ProcessingVisionProvider, frameIndex: number): "high" | "low" {
  if (provider === "nvidia") return "low";
  return frameIndex < 2 ? "high" : "low";
}

export function defaultVideoVisionMaxTokens(provider: ProcessingVisionProvider): number {
  return provider === "nvidia" ? 4096 : 12_000;
}

function buildFrameImageParts(
  visionFrameUrls: string[],
  finalizeImageUrl: (url: string) => string,
  provider: ProcessingVisionProvider
): ChatContentPart[] {
  return visionFrameUrls.map((url, fi) => {
    const visionUrl = url.startsWith("data:image/") ? url : finalizeImageUrl(url);
    return {
      type: "image_url" as const,
      image_url: { url: visionUrl, detail: videoVisionImageDetail(provider, fi) },
    };
  });
}

function isNvidiaEngineFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /NVIDIA NIM API error 5\d\d/i.test(msg) || /EngineCore encountered/i.test(msg);
}

async function callVideoVisionMultimodal(args: {
  config: AppConfig;
  profileModel: string;
  system_prompt: string;
  user_content: ChatContentPart[];
  max_tokens: number;
  frameCount: number;
  audit: OpenAiAuditContext;
}): Promise<{ content: string; model: string }> {
  const out = await processingVisionChatMultimodal(
    args.config,
    args.profileModel,
    {
      system_prompt: args.system_prompt,
      user_content: args.user_content,
      max_tokens: args.max_tokens,
      response_format: "json_object",
      deckSlideCount: args.frameCount,
    },
    args.audit
  );
  return { content: out.content, model: out.model };
}

async function analyzeVideoVisionChunkWithFallback(args: {
  config: AppConfig;
  profileModel: string;
  provider: ProcessingVisionProvider;
  fullSystem: string;
  userText: string;
  chunkUrls: string[];
  globalStart: number;
  frameCount: number;
  finalizeImageUrl: (url: string) => string;
  maxTokens: number;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  isFirstChunk: boolean;
}): Promise<{ content: string; model: string; parsed: Record<string, unknown> | null }> {
  const {
    config,
    profileModel,
    provider,
    fullSystem,
    userText,
    chunkUrls,
    globalStart,
    frameCount,
    finalizeImageUrl,
    maxTokens,
    audit,
    auditStep,
    isFirstChunk,
  } = args;

  const globalEnd = globalStart + chunkUrls.length - 1;
  const chunkUserText =
    `${userText}\n\n` +
    `Attached frame images: ${globalStart}-${globalEnd} of ${frameCount} total in this video sample. ` +
    `Return frame_index values ${globalStart} through ${globalEnd} for these attachments.`;

  const system = isFirstChunk ? fullSystem : TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT;
  const user_content: ChatContentPart[] = [
    { type: "text", text: chunkUserText },
    ...buildFrameImageParts(chunkUrls, finalizeImageUrl, provider),
  ];

  try {
    const out = await callVideoVisionMultimodal({
      config,
      profileModel,
      system_prompt: system,
      user_content,
      max_tokens: maxTokens,
      frameCount: chunkUrls.length,
      audit: { ...audit, step: auditStep },
    });
    return { ...out, parsed: parseJsonObjectFromLlmText(out.content) };
  } catch (err) {
    if (provider !== "nvidia" || chunkUrls.length <= 1 || !isNvidiaEngineFailure(err)) {
      throw err;
    }
  }

  const singleFrameParsed: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  for (let i = 0; i < chunkUrls.length; i++) {
    const frameIndex = globalStart + i;
    const singleUserText =
      `${userText}\n\n` +
      `Attached frame image: ${frameIndex} of ${frameCount} total in this video sample. ` +
      `Return frame_index ${frameIndex} for this attachment.`;

    const singleUserContent: ChatContentPart[] = [
      { type: "text", text: singleUserText },
      ...buildFrameImageParts([chunkUrls[i]!], finalizeImageUrl, provider),
    ];

    const out = await callVideoVisionMultimodal({
      config,
      profileModel,
      system_prompt: isFirstChunk && i === 0 ? fullSystem : TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT,
      user_content: singleUserContent,
      max_tokens: maxTokens,
      frameCount: 1,
      audit: { ...audit, step: `${auditStep}_frame_${frameIndex}_fallback` },
    });

    lastModel = out.model;
    lastContent = out.content;
    singleFrameParsed.push(parseJsonObjectFromLlmText(out.content));
  }

  const merged = mergeVideoInsightChunks(singleFrameParsed);
  return { content: lastContent, model: lastModel, parsed: merged };
}

export async function runVideoFramesVisionAnalysis(args: {
  config: AppConfig;
  profileModel: string;
  systemPrompt: string;
  userText: string;
  visionFrameUrls: string[];
  frameCount: number;
  finalizeImageUrl: (url: string) => string;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  maxTokens?: number;
}): Promise<VideoFramesVisionResult> {
  const {
    config,
    profileModel,
    systemPrompt,
    userText,
    visionFrameUrls,
    frameCount,
    finalizeImageUrl,
    audit,
    auditStep,
    maxTokens: maxTokensOverride,
  } = args;

  const call = resolveProcessingVisionCall(config, profileModel);
  const chunkSize = resolveVideoVisionChunkSize(config, profileModel);
  const maxTokens = maxTokensOverride ?? defaultVideoVisionMaxTokens(call.provider);
  const useChunking = call.provider === "nvidia" && chunkSize != null && visionFrameUrls.length > chunkSize;

  const fullSystem =
    call.provider === "nvidia" ? `${systemPrompt}${TOP_PERFORMER_VIDEO_NVIDIA_JSON_APPENDIX}` : systemPrompt;

  if (!useChunking) {
    const user_content: ChatContentPart[] = [
      { type: "text", text: userText },
      ...buildFrameImageParts(visionFrameUrls, finalizeImageUrl, call.provider),
    ];
    const out = await callVideoVisionMultimodal({
      config,
      profileModel,
      system_prompt: fullSystem,
      user_content,
      max_tokens: maxTokens,
      frameCount,
      audit: { ...audit, step: auditStep },
    });
    return { content: out.content, model: out.model, parsed: parseJsonObjectFromLlmText(out.content) };
  }

  const parsedChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  for (let start = 0; start < visionFrameUrls.length; start += chunkSize!) {
    const chunkUrls = visionFrameUrls.slice(start, start + chunkSize!);
    const globalStart = start + 1;
    const isFirst = start === 0;
    const step = isFirst ? auditStep : `${auditStep}_frames_${globalStart}_${globalStart + chunkUrls.length - 1}`;

    const out = await analyzeVideoVisionChunkWithFallback({
      config,
      profileModel,
      provider: call.provider,
      fullSystem,
      userText,
      chunkUrls,
      globalStart,
      frameCount,
      finalizeImageUrl,
      maxTokens,
      audit,
      auditStep: step,
      isFirstChunk: isFirst,
    });

    lastModel = out.model;
    lastContent = out.content;
    parsedChunks.push(out.parsed);
  }

  return {
    content: lastContent,
    model: lastModel,
    parsed: mergeVideoInsightChunks(parsedChunks),
  };
}
