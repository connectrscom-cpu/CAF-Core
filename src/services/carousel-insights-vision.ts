import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import {
  findMissingCarouselSlideIndices,
  finalizeCarouselInsightJson,
  mergeCarouselInsightChunks,
  TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT,
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

function batchIndices(indices: number[], batchSize: number): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < indices.length; i += batchSize) {
    batches.push(indices.slice(i, i + batchSize));
  }
  return batches;
}

async function callCarouselVision(args: {
  config: AppConfig;
  profileModel: string;
  systemPrompt: string;
  userText: string;
  visionSlideUrls: string[];
  deckSlideCount: number;
  finalizeImageUrl: (url: string) => string;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  maxTokens: number;
}): Promise<{ content: string; model: string; parsed: Record<string, unknown> | null }> {
  const user_content: ChatContentPart[] = [
    { type: "text", text: args.userText },
    ...buildImageParts(args.visionSlideUrls, args.finalizeImageUrl),
  ];
  const out = await processingVisionChatMultimodal(
    args.config,
    args.profileModel,
    {
      system_prompt: args.systemPrompt,
      user_content,
      max_tokens: args.maxTokens,
      response_format: "json_object",
      deckSlideCount: args.deckSlideCount,
    },
    { ...args.audit, step: args.auditStep }
  );
  return { content: out.content, model: out.model, parsed: parseJsonObjectFromLlmText(out.content) };
}

async function retryMissingCarouselSlides(args: {
  config: AppConfig;
  profileModel: string;
  userText: string;
  visionSlideUrls: string[];
  deckSlideCount: number;
  finalizeImageUrl: (url: string) => string;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  maxTokens: number;
  chunkSize: number;
  merged: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const retryChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = args.profileModel;
  let lastContent = "";

  let missing = findMissingCarouselSlideIndices(args.merged.slides, args.deckSlideCount);
  if (missing.length === 0) return args.merged;

  for (const batch of batchIndices(missing, args.chunkSize)) {
    const chunkUrls = batch.map((idx) => args.visionSlideUrls[idx - 1]).filter(Boolean);
    if (chunkUrls.length === 0) continue;

    const globalStart = batch[0]!;
    const globalEnd = batch[batch.length - 1]!;
    const chunkUserText =
      `${args.userText}\n\n` +
      `RETRY — previous analysis missed slide OCR for indices: ${batch.join(", ")}.\n` +
      `Attached images: slides ${globalStart}-${globalEnd} of ${args.deckSlideCount} total in this deck. ` +
      `Return slide_index values ${batch.join(", ")} only. slides.length MUST equal ${chunkUrls.length}.`;

    const out = await callCarouselVision({
      config: args.config,
      profileModel: args.profileModel,
      systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
      userText: chunkUserText,
      visionSlideUrls: chunkUrls,
      deckSlideCount: chunkUrls.length,
      finalizeImageUrl: args.finalizeImageUrl,
      audit: args.audit,
      auditStep: `${args.auditStep}_retry_${globalStart}_${globalEnd}`,
      maxTokens: args.maxTokens,
    });

    lastModel = out.model;
    lastContent = out.content;
    retryChunks.push(out.parsed);
  }

  if (retryChunks.length === 0) return args.merged;

  const retried = mergeCarouselInsightChunks([args.merged, ...retryChunks], args.deckSlideCount);
  missing = findMissingCarouselSlideIndices(retried.slides, args.deckSlideCount);
  if (missing.length > 0 && retried.slides) {
    retried._slide_coverage = {
      expected: args.deckSlideCount,
      stored: Array.isArray(retried.slides) ? retried.slides.length : 0,
      missing_indices: missing,
    };
  }

  return retried;
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
  const chunkSize = chunkSizeForConfig(config, profileModel) ?? 4;
  const useChunking =
    call.provider === "nvidia" && chunkSize != null && visionSlideUrls.length > chunkSize;

  const fullSystem =
    call.provider === "nvidia" ? `${systemPrompt}${TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX}` : systemPrompt;

  if (!useChunking) {
    let out = await callCarouselVision({
      config,
      profileModel,
      systemPrompt: fullSystem,
      userText,
      visionSlideUrls,
      deckSlideCount,
      finalizeImageUrl,
      audit,
      auditStep,
      maxTokens,
    });

    if (!out.parsed) {
      const retry = await callCarouselVision({
        config,
        profileModel,
        systemPrompt: fullSystem,
        userText,
        visionSlideUrls,
        deckSlideCount,
        finalizeImageUrl,
        audit,
        auditStep: `${auditStep}_parse_retry`,
        maxTokens,
      });
      out = retry.parsed ? retry : out;
    }

    let parsed = finalizeCarouselInsightJson(out.parsed, deckSlideCount);
    if (parsed) {
      parsed = await retryMissingCarouselSlides({
        config,
        profileModel,
        userText,
        visionSlideUrls,
        deckSlideCount,
        finalizeImageUrl,
        audit,
        auditStep,
        maxTokens,
        chunkSize,
        merged: parsed,
      });
      parsed = finalizeCarouselInsightJson(parsed, deckSlideCount);
    }

    return { content: out.content, model: out.model, parsed };
  }

  const parsedChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  const deckSummarySystem =
    call.provider === "nvidia"
      ? `${TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT}${TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX}`
      : TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT;

  const deckOut = await callCarouselVision({
    config,
    profileModel,
    systemPrompt: deckSummarySystem,
    userText:
      `${userText}\n\n` +
      `Attached image: slide 1 (cover) of ${deckSlideCount} total. Return deck-wide fields only (no slides array).`,
    visionSlideUrls: visionSlideUrls.slice(0, 1),
    deckSlideCount: 1,
    finalizeImageUrl,
    audit,
    auditStep: `${auditStep}_deck`,
    maxTokens,
  });
  lastModel = deckOut.model;
  lastContent = deckOut.content;
  parsedChunks.push(deckOut.parsed);

  for (let start = 0; start < visionSlideUrls.length; start += chunkSize) {
    const chunkUrls = visionSlideUrls.slice(start, start + chunkSize);
    const globalStart = start + 1;
    const globalEnd = start + chunkUrls.length;

    const chunkUserText =
      `${userText}\n\n` +
      `Attached images: slides ${globalStart}-${globalEnd} of ${deckSlideCount} total in this deck. ` +
      `Return slide_index values ${globalStart} through ${globalEnd} for these attachments. ` +
      `slides.length MUST equal ${chunkUrls.length}.`;

    const out = await callCarouselVision({
      config,
      profileModel,
      systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
      userText: chunkUserText,
      visionSlideUrls: chunkUrls,
      deckSlideCount: chunkUrls.length,
      finalizeImageUrl,
      audit,
      auditStep: `${auditStep}_slides_${globalStart}_${globalEnd}`,
      maxTokens,
    });

    lastModel = out.model;
    lastContent = out.content;
    parsedChunks.push(out.parsed ?? null);

    if (!out.parsed) {
      const retry = await callCarouselVision({
        config,
        profileModel,
        systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
        userText: `${chunkUserText}\n\nReturn ONLY valid JSON with one slides[] entry per attachment.`,
        visionSlideUrls: chunkUrls,
        deckSlideCount: chunkUrls.length,
        finalizeImageUrl,
        audit,
        auditStep: `${auditStep}_slides_${globalStart}_${globalEnd}_parse_retry`,
        maxTokens,
      });
      if (retry.parsed) {
        parsedChunks[parsedChunks.length - 1] = retry.parsed;
        lastContent = retry.content;
      }
    }
  }

  let merged = mergeCarouselInsightChunks(parsedChunks, deckSlideCount);
  if (Object.keys(merged).length === 0) {
    return { content: lastContent, model: lastModel, parsed: null };
  }

  merged = await retryMissingCarouselSlides({
    config,
    profileModel,
    userText,
    visionSlideUrls,
    deckSlideCount,
    finalizeImageUrl,
    audit,
    auditStep,
    maxTokens,
    chunkSize,
    merged,
  });

  const parsed = finalizeCarouselInsightJson(merged, deckSlideCount);
  return {
    content: lastContent,
    model: lastModel,
    parsed,
  };
}
