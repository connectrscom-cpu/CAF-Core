import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { processingVisionChatMultimodal, resolveProcessingVisionCall } from "./processing-vision-client.js";
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

function chunkSizeForConfig(config: AppConfig, profileModel: string): number | null {
  return resolveProcessingVisionCall(config, profileModel).maxImagesPerRequest;
}

function buildFrameImageParts(
  visionFrameUrls: string[],
  finalizeImageUrl: (url: string) => string
): ChatContentPart[] {
  return visionFrameUrls.map((url, fi) => {
    const visionUrl = url.startsWith("data:image/") ? url : finalizeImageUrl(url);
    return {
      type: "image_url" as const,
      image_url: { url: visionUrl, detail: (fi < 2 ? "high" : "low") as "high" | "low" },
    };
  });
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
    maxTokens = 12_000,
  } = args;

  const call = resolveProcessingVisionCall(config, profileModel);
  const chunkSize = chunkSizeForConfig(config, profileModel);
  const useChunking =
    call.provider === "nvidia" && chunkSize != null && visionFrameUrls.length > chunkSize;

  const fullSystem =
    call.provider === "nvidia" ? `${systemPrompt}${TOP_PERFORMER_VIDEO_NVIDIA_JSON_APPENDIX}` : systemPrompt;

  if (!useChunking) {
    const user_content: ChatContentPart[] = [
      { type: "text", text: userText },
      ...buildFrameImageParts(visionFrameUrls, finalizeImageUrl),
    ];
    const out = await processingVisionChatMultimodal(
      config,
      profileModel,
      {
        system_prompt: fullSystem,
        user_content,
        max_tokens: maxTokens,
        response_format: "json_object",
        deckSlideCount: frameCount,
      },
      { ...audit, step: auditStep }
    );
    return { content: out.content, model: out.model, parsed: parseJsonObjectFromLlmText(out.content) };
  }

  const parsedChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  for (let start = 0; start < visionFrameUrls.length; start += chunkSize!) {
    const chunkUrls = visionFrameUrls.slice(start, start + chunkSize!);
    const globalStart = start + 1;
    const globalEnd = start + chunkUrls.length;
    const isFirst = start === 0;

    const chunkUserText =
      `${userText}\n\n` +
      `Attached frame images: ${globalStart}-${globalEnd} of ${frameCount} total in this video sample. ` +
      `Return frame_index values ${globalStart} through ${globalEnd} for these attachments.`;

    const system = isFirst ? fullSystem : TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT;
    const user_content: ChatContentPart[] = [
      { type: "text", text: chunkUserText },
      ...buildFrameImageParts(chunkUrls, finalizeImageUrl),
    ];

    const step = isFirst ? auditStep : `${auditStep}_frames_${globalStart}_${globalEnd}`;
    const out = await processingVisionChatMultimodal(
      config,
      profileModel,
      {
        system_prompt: system,
        user_content,
        max_tokens: maxTokens,
        response_format: "json_object",
        deckSlideCount: chunkUrls.length,
      },
      { ...audit, step }
    );

    lastModel = out.model;
    lastContent = out.content;
    parsedChunks.push(parseJsonObjectFromLlmText(out.content));
  }

  return {
    content: lastContent,
    model: lastModel,
    parsed: mergeVideoInsightChunks(parsedChunks),
  };
}
