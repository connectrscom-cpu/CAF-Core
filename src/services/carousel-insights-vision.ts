import type { AppConfig } from "../config.js";
import type { OpenAiAuditContext } from "./openai-chat.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import {
  findCarouselSlidesNeedingRetry,
  findMissingCarouselSlideIndices,
  finalizeCarouselInsightJson,
  mergeCarouselInsightChunks,
  remapChunkSlideIndices,
  TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT,
  TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX,
  TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
} from "./carousel-insights-llm-normalize.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import {
  processingVisionChatMultimodal,
  resolveProcessingVisionCall,
  type ProcessingVisionProvider,
} from "./processing-vision-client.js";

export interface CarouselDeckVisionResult {
  content: string;
  model: string;
  parsed: Record<string, unknown> | null;
}

export interface CarouselVisionProviderOpts {
  provider?: ProcessingVisionProvider;
  defaultNvidiaModel?: string;
}

/** Nemotron VL is sensitive to multi-image payloads — keep carousel chunks small. */
const NVIDIA_CAROUSEL_MAX_IMAGES_PER_CHUNK = 2;

export function resolveCarouselVisionChunkSize(
  config: AppConfig,
  profileModel: string,
  visionOpts?: CarouselVisionProviderOpts
): number | null {
  const call = resolveProcessingVisionCall(config, profileModel, visionOpts);
  if (call.provider !== "nvidia") return null;
  const providerCap = call.maxImagesPerRequest ?? 4;
  return Math.min(Math.max(1, providerCap), NVIDIA_CAROUSEL_MAX_IMAGES_PER_CHUNK);
}

export function carouselVisionImageDetail(
  provider: ProcessingVisionProvider,
  frameIndex: number,
  deckSlideCount: number
): "low" | "high" {
  if (provider === "nvidia") return "low";
  return deckSlideCount > 1 && frameIndex < 2 ? "high" : "low";
}

export function defaultCarouselVisionMaxTokens(provider: ProcessingVisionProvider): number {
  return provider === "nvidia" ? 4096 : 8192;
}

function buildImageParts(
  visionSlideUrls: string[],
  finalizeUrl: (url: string) => string,
  provider: ProcessingVisionProvider,
  deckSlideCount: number
): ChatContentPart[] {
  return visionSlideUrls.map((url, fi) => ({
    type: "image_url" as const,
    image_url: {
      url: finalizeUrl(url),
      detail: carouselVisionImageDetail(provider, fi, deckSlideCount),
    },
  }));
}

function isNvidiaRetryableFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /NVIDIA NIM API error 5\d\d/i.test(msg) ||
    /EngineCore encountered/i.test(msg) ||
    /timed out|timeout|aborted/i.test(msg)
  );
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
  provider: ProcessingVisionProvider;
  imageDetail?: "low" | "high";
}): Promise<{ content: string; model: string; parsed: Record<string, unknown> | null }> {
  const detail = args.imageDetail ?? "low";
  const user_content: ChatContentPart[] = [
    { type: "text", text: args.userText },
    ...buildImageParts(args.visionSlideUrls, args.finalizeImageUrl, args.provider, args.deckSlideCount).map(
      (part) =>
        part.type === "image_url"
          ? { ...part, image_url: { ...part.image_url, detail } }
          : part
    ),
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

async function analyzeCarouselVisionChunkWithFallback(args: {
  config: AppConfig;
  profileModel: string;
  provider: ProcessingVisionProvider;
  systemPrompt: string;
  userText: string;
  chunkUrls: string[];
  globalStart: number;
  deckSlideCount: number;
  finalizeImageUrl: (url: string) => string;
  audit: Omit<OpenAiAuditContext, "step">;
  auditStep: string;
  maxTokens: number;
  imageDetail?: "low" | "high";
}): Promise<{ content: string; model: string; parsed: Record<string, unknown> | null }> {
  const {
    config,
    profileModel,
    provider,
    systemPrompt,
    userText,
    chunkUrls,
    globalStart,
    deckSlideCount,
    finalizeImageUrl,
    audit,
    auditStep,
    maxTokens,
    imageDetail,
  } = args;

  const globalEnd = globalStart + chunkUrls.length - 1;
  const chunkUserText =
    `${userText}\n\n` +
    `Attached images: slides ${globalStart}-${globalEnd} of ${deckSlideCount} total in this deck. ` +
    `Return slide_index values ${globalStart} through ${globalEnd} for these attachments. ` +
    `slides.length MUST equal ${chunkUrls.length}.`;

  try {
    const out = await callCarouselVision({
      config,
      profileModel,
      systemPrompt,
      userText: chunkUserText,
      visionSlideUrls: chunkUrls,
      deckSlideCount: chunkUrls.length,
      finalizeImageUrl,
      audit,
      auditStep,
      maxTokens,
      provider,
      imageDetail,
    });
    return {
      ...out,
      parsed: out.parsed ? remapChunkSlideIndices(out.parsed, globalStart, chunkUrls.length) : null,
    };
  } catch (err) {
    if (provider !== "nvidia" || chunkUrls.length <= 1 || !isNvidiaRetryableFailure(err)) {
      throw err;
    }
  }

  const singleParsed: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  for (let i = 0; i < chunkUrls.length; i++) {
    const slideIndex = globalStart + i;
    const singleUserText =
      `${userText}\n\n` +
      `Attached image: slide ${slideIndex} of ${deckSlideCount} total in this deck. ` +
      `Return slide_index ${slideIndex} only. slides.length MUST equal 1.`;

    const out = await callCarouselVision({
      config,
      profileModel,
      systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
      userText: singleUserText,
      visionSlideUrls: [chunkUrls[i]!],
      deckSlideCount: 1,
      finalizeImageUrl,
      audit,
      auditStep: `${auditStep}_slide_${slideIndex}_fallback`,
      maxTokens,
      provider,
      imageDetail: "low",
    });

    lastModel = out.model;
    lastContent = out.content;
    singleParsed.push(
      out.parsed ? remapChunkSlideIndices(out.parsed, slideIndex, 1) : null
    );
  }

  return {
    content: lastContent,
    model: lastModel,
    parsed: mergeCarouselInsightChunks(singleParsed, deckSlideCount),
  };
}

async function retryIncompleteCarouselSlides(args: {
  config: AppConfig;
  profileModel: string;
  provider: ProcessingVisionProvider;
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

  let needsRetry = findCarouselSlidesNeedingRetry(args.merged.slides, args.deckSlideCount);
  if (needsRetry.length === 0) return args.merged;

  const retryDetail: "low" | "high" = args.provider === "nvidia" ? "low" : "high";

  for (const batch of batchIndices(needsRetry, args.chunkSize)) {
    const chunkUrls = batch.map((idx) => args.visionSlideUrls[idx - 1]).filter(Boolean);
    if (chunkUrls.length === 0) continue;

    const globalStart = batch[0]!;
    const globalEnd = batch[batch.length - 1]!;
    const chunkUserText =
      `${args.userText}\n\n` +
      `RETRY — previous analysis missed or hallucinated OCR for slide indices: ${batch.join(", ")}.\n` +
      `Describe ONLY what is visible in each attached image. Do not invent brands, ads, or caption hashtags.\n` +
      `Attached images: slides ${globalStart}-${globalEnd} of ${args.deckSlideCount} total in this deck. ` +
      `Return slide_index values ${batch.join(", ")} only. slides.length MUST equal ${chunkUrls.length}.`;

    const out = await analyzeCarouselVisionChunkWithFallback({
      config: args.config,
      profileModel: args.profileModel,
      provider: args.provider,
      systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
      userText: chunkUserText,
      chunkUrls,
      globalStart,
      deckSlideCount: args.deckSlideCount,
      finalizeImageUrl: args.finalizeImageUrl,
      audit: args.audit,
      auditStep: `${args.auditStep}_retry_${globalStart}_${globalEnd}`,
      maxTokens: args.maxTokens,
      imageDetail: retryDetail,
    });

    retryChunks.push(out.parsed);
  }

  if (retryChunks.length === 0) return args.merged;

  const retried = mergeCarouselInsightChunks([args.merged, ...retryChunks], args.deckSlideCount);
  attachSlideCoverageMetadata(retried, args.deckSlideCount);
  return retried;
}

function batchIndices(indices: number[], batchSize: number): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < indices.length; i += batchSize) {
    batches.push(indices.slice(i, i + batchSize));
  }
  return batches;
}

function attachSlideCoverageMetadata(merged: Record<string, unknown>, deckSlideCount: number): void {
  const missing = findMissingCarouselSlideIndices(merged.slides, deckSlideCount);
  const needsRetry = findCarouselSlidesNeedingRetry(merged.slides, deckSlideCount);
  const weak = needsRetry.filter((idx) => !missing.includes(idx));
  if (missing.length === 0 && weak.length === 0) {
    delete merged._slide_coverage;
    return;
  }
  merged._slide_coverage = {
    expected: deckSlideCount,
    stored: Array.isArray(merged.slides) ? merged.slides.length : 0,
    missing_indices: missing,
    weak_indices: weak,
  };
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
  visionProviderOpts?: CarouselVisionProviderOpts;
  /** Deck-wide summary prompt when chunking (defaults to top-performer deck prompt). */
  deckSummaryPrompt?: string;
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
    maxTokens: maxTokensOverride,
    visionProviderOpts,
  } = args;

  const deckSummaryBase = args.deckSummaryPrompt ?? TOP_PERFORMER_CAROUSEL_DECK_SUMMARY_PROMPT;

  const call = resolveProcessingVisionCall(config, profileModel, visionProviderOpts);
  const chunkSize = resolveCarouselVisionChunkSize(config, profileModel, visionProviderOpts) ?? 4;
  const maxTokens = maxTokensOverride ?? defaultCarouselVisionMaxTokens(call.provider);
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
      provider: call.provider,
      imageDetail: deckSlideCount > 1 && call.provider !== "nvidia" ? "high" : "low",
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
        provider: call.provider,
        imageDetail: deckSlideCount > 1 && call.provider !== "nvidia" ? "high" : "low",
      });
      out = retry.parsed ? retry : out;
    }

    let parsed = finalizeCarouselInsightJson(out.parsed, deckSlideCount);
    if (parsed) {
      parsed = await retryIncompleteCarouselSlides({
        config,
        profileModel,
        provider: call.provider,
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
      if (parsed) attachSlideCoverageMetadata(parsed, deckSlideCount);
    }

    return { content: out.content, model: out.model, parsed };
  }

  const parsedChunks: Array<Record<string, unknown> | null> = [];
  let lastModel = profileModel;
  let lastContent = "";

  const deckSummarySystem =
    call.provider === "nvidia"
      ? `${deckSummaryBase}${TOP_PERFORMER_CAROUSEL_NVIDIA_JSON_APPENDIX}`
      : deckSummaryBase;

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
    provider: call.provider,
    imageDetail: "low",
  });
  lastModel = deckOut.model;
  lastContent = deckOut.content;
  const deckChunk = deckOut.parsed ? { ...deckOut.parsed } : null;
  if (deckChunk && Array.isArray(deckChunk.slides)) {
    delete deckChunk.slides;
  }
  parsedChunks.push(deckChunk);

  for (let start = 0; start < visionSlideUrls.length; start += chunkSize) {
    const chunkUrls = visionSlideUrls.slice(start, start + chunkSize);
    const globalStart = start + 1;
    const globalEnd = start + chunkUrls.length;
    const step = `${auditStep}_slides_${globalStart}_${globalEnd}`;

    let chunkParsed: Record<string, unknown> | null = null;
    const out = await analyzeCarouselVisionChunkWithFallback({
      config,
      profileModel,
      provider: call.provider,
      systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
      userText,
      chunkUrls,
      globalStart,
      deckSlideCount,
      finalizeImageUrl,
      audit,
      auditStep: step,
      maxTokens,
      imageDetail: "low",
    });

    lastModel = out.model;
    lastContent = out.content;
    chunkParsed = out.parsed;

    if (!chunkParsed) {
      const retry = await analyzeCarouselVisionChunkWithFallback({
        config,
        profileModel,
        provider: call.provider,
        systemPrompt: TOP_PERFORMER_CAROUSEL_SLIDES_CHUNK_PROMPT,
        userText: `${userText}\n\nReturn ONLY valid JSON with one slides[] entry per attachment.`,
        chunkUrls,
        globalStart,
        deckSlideCount,
        finalizeImageUrl,
        audit,
        auditStep: `${step}_parse_retry`,
        maxTokens,
        imageDetail: "low",
      });
      if (retry.parsed) {
        chunkParsed = retry.parsed;
        lastContent = retry.content;
      }
    }
    parsedChunks.push(chunkParsed);
  }

  let merged = mergeCarouselInsightChunks(parsedChunks, deckSlideCount);
  if (Object.keys(merged).length === 0) {
    return { content: lastContent, model: lastModel, parsed: null };
  }

  merged = await retryIncompleteCarouselSlides({
    config,
    profileModel,
    provider: call.provider,
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
  if (parsed) attachSlideCoverageMetadata(parsed, deckSlideCount);
  return {
    content: lastContent,
    model: lastModel,
    parsed,
  };
}
