/**
 * Nemotron VL analysis of CAF-generated approved output (top-performer insight parity).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import {
  buildCarouselAestheticAnalysisJson,
  finalizeCarouselInsightJson,
  GENERATED_OUTPUT_CAROUSEL_DECK_SUMMARY_PROMPT,
  GENERATED_OUTPUT_CAROUSEL_SLIDES_CHUNK_PROMPT,
} from "./carousel-insights-llm-normalize.js";
import { runCarouselDeckVisionAnalysis } from "./carousel-insights-vision.js";
import {
  finalizeVideoInsightParsed,
  normalizeVideoInsightsLlmJson,
  TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT,
} from "./video-insights-llm-normalize.js";
import { runVideoFramesVisionAnalysis } from "./video-insights-vision.js";
import {
  assertApprovalReviewVisionConfigured,
  resolveApprovalReviewVisionCall,
} from "./processing-vision-client.js";
import { buildApprovedContentTextBundle } from "./approved-content-text-bundle.js";
import { deriveLearningSignalsFromOutputInsights } from "./generated-output-learning-derive.js";
import type { DerivedLearningSignals } from "./generated-output-learning-derive.js";

export type GeneratedOutputFlowFamily = "carousel" | "video" | "image";

export interface GeneratedOutputAnalysisResult {
  ok: boolean;
  error?: string;
  flow_family: GeneratedOutputFlowFamily;
  model: string;
  raw_llm_json: Record<string, unknown> | null;
  output_insights_json: Record<string, unknown>;
  raw_content: string;
  derived: DerivedLearningSignals;
  images_used: number;
  images_available: number;
}

export interface ApprovedJobForAnalysis {
  task_id: string;
  run_id: string;
  flow_type: string | null;
  platform: string | null;
  generation_payload: Record<string, unknown>;
}

export function resolveApprovalReviewProfileModel(config: AppConfig): string {
  const call = resolveApprovalReviewVisionCall(config);
  return call.model;
}

export function assertApprovalReviewVisionReady(config: AppConfig): void {
  assertApprovalReviewVisionConfigured(config);
}

export async function analyzeGeneratedOutputForApprovedJob(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  job: ApprovedJobForAnalysis,
  opts: {
    imageUrls: string[];
    imagesAvailable: number;
    textBundle: string;
    maxTextChars: number;
    /**
     * Human editorial verdict for contrast framing. When the decision is
     * REJECTED / NEEDS_EDIT the reviewer analyzes failure (what to change
     * upstream), not success patterns.
     */
    reviewContext?: { decision: string | null; notes: string | null } | null;
  }
): Promise<GeneratedOutputAnalysisResult> {
  const flowType = job.flow_type ?? "";
  const flowFamily: GeneratedOutputFlowFamily = isCarouselFlow(flowType)
    ? "carousel"
    : isVideoFlow(flowType)
      ? "video"
      : "image";

  const profileModel = resolveApprovalReviewProfileModel(config);
  const visionProviderOpts = {
    provider: config.APPROVAL_REVIEW_VISION_PROVIDER,
    defaultNvidiaModel:
      config.APPROVAL_REVIEW_NVIDIA_MODEL?.trim() || config.PROCESSING_VISION_NVIDIA_MODEL,
  };

  const decision = opts.reviewContext?.decision?.trim().toUpperCase() ?? "APPROVED";
  const isFailureLane = decision === "REJECTED" || decision === "NEEDS_EDIT";
  const reviewNotes = opts.reviewContext?.notes?.trim() ?? "";

  const userText = [
    `task_id: ${job.task_id}`,
    `project: ${projectSlug}`,
    `flow_type: ${flowType || "unknown"}`,
    `platform: ${job.platform ?? "unknown"}`,
    `analysis_target: ${isFailureLane ? "caf_generated_output_rejected" : "caf_generated_output_approved"}`,
    `human_editorial_decision: ${decision}`,
    `images_available: ${opts.imagesAvailable}`,
    `images_attached: ${opts.imageUrls.length}`,
    ...(isFailureLane
      ? [
          "",
          "--- IMPORTANT: failure analysis lane ---",
          `A human reviewer marked this content ${decision}. Analyze what went wrong, not what to preserve: identify the specific copy/visual/structural defects that plausibly caused the rejection, and phrase improvement points as what should change upstream (prompts, templates, parameters) to prevent this class of failure.`,
          ...(reviewNotes ? [`Reviewer notes: ${reviewNotes.slice(0, 1500)}`] : []),
        ]
      : []),
    "",
    "--- Intended copy / generation spec (what CAF meant to produce) ---",
    opts.textBundle,
  ].join("\n");

  const audit = {
    db,
    projectId,
    runId: job.run_id,
    taskId: job.task_id,
    signalPackId: null as string | null,
  };

  try {
    if (flowFamily === "video") {
      const frameUrls = opts.imageUrls;
      const frameCount = Math.max(1, frameUrls.length);
      const vision = await runVideoFramesVisionAnalysis({
        config,
        profileModel,
        systemPrompt: `You analyze CAF-generated video content that humans approved. Describe frames and relate to intended script/plan below.\n\n${TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT}`,
        userText,
        visionFrameUrls: frameUrls,
        frameCount,
        finalizeImageUrl: (u) => u,
        audit,
        auditStep: "generated_output_video_nemotron",
        maxTokens: 4096,
      });
      const finalized = finalizeVideoInsightParsed(vision.parsed, {
        frameCount,
        captionTranscript: opts.textBundle.slice(0, 4000),
      });
      const parsed = finalized.parsed ?? normalizeVideoInsightsLlmJson(vision.parsed);
      const outputInsights = parsed ?? {};
      const derived = deriveLearningSignalsFromOutputInsights(outputInsights, parsed, {
        flow_family: flowFamily,
      });
      return {
        ok: Boolean(parsed),
        error: parsed ? undefined : "video_insight_normalize_failed",
        flow_family: flowFamily,
        model: vision.model,
        raw_llm_json: parsed,
        output_insights_json: outputInsights,
        raw_content: vision.content,
        derived,
        images_used: frameUrls.length,
        images_available: opts.imagesAvailable,
      };
    }

    const slideUrls = opts.imageUrls;
    const deckSlideCount = Math.max(1, slideUrls.length);
    const vision = await runCarouselDeckVisionAnalysis({
      config,
      profileModel,
      systemPrompt: GENERATED_OUTPUT_CAROUSEL_SLIDES_CHUNK_PROMPT,
      deckSummaryPrompt: GENERATED_OUTPUT_CAROUSEL_DECK_SUMMARY_PROMPT,
      userText,
      visionSlideUrls: slideUrls,
      deckSlideCount,
      finalizeImageUrl: (u) => u,
      audit,
      auditStep: "generated_output_carousel_nemotron",
      maxTokens: 4096,
      visionProviderOpts,
    });

    const finalized = finalizeCarouselInsightJson(vision.parsed, deckSlideCount);
    const outputInsights = buildCarouselAestheticAnalysisJson(finalized ?? vision.parsed);
    const derived = deriveLearningSignalsFromOutputInsights(outputInsights, finalized, {
      flow_family: flowFamily === "image" ? "image" : "carousel",
    });

    return {
      ok: Boolean(finalized || vision.parsed),
      error: finalized || vision.parsed ? undefined : "carousel_insight_normalize_failed",
      flow_family: flowFamily === "image" ? "image" : "carousel",
      model: vision.model,
      raw_llm_json: finalized ?? vision.parsed,
      output_insights_json: outputInsights,
      raw_content: vision.content,
      derived,
      images_used: slideUrls.length,
      images_available: opts.imagesAvailable,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg,
      flow_family: flowFamily,
      model: profileModel,
      raw_llm_json: null,
      output_insights_json: {},
      raw_content: "",
      derived: deriveLearningSignalsFromOutputInsights({}, null, { flow_family: flowFamily }),
      images_used: opts.imageUrls.length,
      images_available: opts.imagesAvailable,
    };
  }
}
