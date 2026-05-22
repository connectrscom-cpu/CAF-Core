import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import {
  mergeCarouselInsightChunks,
  TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX,
  TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
} from "./carousel-insights-llm-normalize.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { processingVisionChatMultimodal, resolveProcessingVisionCall } from "./processing-vision-client.js";

export interface CarouselDeckVisionResult {
  content: string;
  model: string;
  parsed: Record<string, unknown> | null;
}

function chunkSizeForConfig(config: AppConfig, profileModel: string): number | null {
  const call = resolveProcessingVisionCall(config, profileModel);
  return call.maxImagesPerRequest;
}

function buildImageParts(
  visionSlideUrls: string[],
  finalizeUrl: (url: string) => string
): ChatContentPart[] {
  return visionSlideUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url: finalizeUrl(url), detail: "low" as const },
  }));
}

/**
 * Run carousel deck vision (single call or Nemotron chunks when slide count exceeds provider cap).
 */
export async function runCarouselDeckVisionAnalysis(args: {
  config: AppConfig;
  profileModel: string;
  systemPrompt: string;
  userText: string;
  visionSlideUrls: string[];
  deckSlideCount: number;
  finalizeImageUrl: (url: string) => string;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  maxTokens?: number;
}): Promise<CarouselDeckVisionResult> {
  const {
    config,
    profileModel,
    systemPrompt,
    userText,
    visionSlideUrls,
    deckSlideCount,
    finalizeImageUrl,
    audit,
    auditStep,
    maxTokens = 8192,
  } = args;

  const call = resolveProcessingVisionCall(config, profileModel);
  const chunkSize = chunkSizeForConfig(config, profileModel);
  const useChunking =
    call.provider === "nvidia" && chunkSize != null && visionSlideUrls.length > chunkSize;

  const fullSystem =
    call.provider === "nvidia" ? `${systemPrompt}${TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX}` : systemPrompt;

  if (!useChunking) {
    const user_content: ChatContentPart[] = [
      { type: "text", text: userText },
      ...buildImageParts(visionSlideUrls, finalizeImageUrl),
    ];
    const out = await processingVisionChatMultimodal(
      config,
      profileModel,
      {
        system_prompt: fullSystem,
        user_content,
        max_tokens: maxTokens,
        response_format: "json_object",
        deckSlideCount,
      },
      { ...audit, step: auditStep }
    );
    const parsed = parseJsonObjectFromLlmText(out.content);
    return { content: out.content, model: out.model, parsed };
  }

  const parsedChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  for (let start = 0; start < visionSlideUrls.length; start += chunkSize!) {
    const chunkUrls = visionSlideUrls.slice(start, start + chunkSize!);
    const globalStart = start + 1;
    const globalEnd = start + chunkUrls.length;
    const isFirst = start === 0;

    const chunkUserText =
      `${userText}\n\n` +
      `Attached images: slides ${globalStart}-${globalEnd} of ${deckSlideCount} total in this deck. ` +
      `Return slide_index values ${globalStart} through ${globalEnd} for these attachments.`;

    const system = isFirst ? fullSystem : TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT;
    const user_content: ChatContentPart[] = [
      { type: "text", text: chunkUserText },
      ...buildImageParts(chunkUrls, finalizeImageUrl),
    ];

    const step = isFirst ? auditStep : `${auditStep}_slides_${globalStart}_${globalEnd}`;
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

  const merged = mergeCarouselInsightChunks(parsedChunks);
  return {
    content: lastContent,
    model: lastModel,
    parsed: merged,
  };
}
