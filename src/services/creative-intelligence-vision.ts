import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { openaiChatMultimodal, type ChatContentPart } from "./openai-chat-multimodal.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import {
  parseCreativeVisualAnalysisLlm,
  type CreativeVisualAnalysisLlm,
} from "../domain/creative-visual-analysis-schema.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";

const SYSTEM = `You are a senior social creative director. Analyze the provided reference image(s) from top-performing marketing content.
Return ONLY one JSON object (no markdown) with this shape:
{
  "visual_summary": string,
  "style_tags": string[],
  "layout": { "type"?: string, "hierarchy"?: string, "text_density"?: "low"|"medium"|"high", "safe_area_notes"?: string },
  "color_palette": { "dominant"?: string[], "accent"?: string[], "background_style"?: string, "contrast"?: "low"|"medium"|"high" },
  "typography": { "style"?: string, "weight"?: string, "case"?: string, "notes"?: string },
  "composition": { "uses_faces"?: boolean, "uses_product"?: boolean, "uses_icons"?: boolean, "uses_cards"?: boolean, "uses_borders"?: boolean, "notes"?: string },
  "text_overlay": { "has_overlay_text"?: boolean, "approx_words_per_slide"?: number, "placement"?: string, "readability"?: "high"|"medium"|"low" },
  "motion": { "pacing"?: string, "cuts"?: string, "notes"?: string },
  "performance_hypothesis": string,
  "mimicry_notes": string,
  "generation_guidance": string
}
Be specific about layout and slide rhythm when multiple images represent a carousel. For a single thumbnail of a video, infer cautiously and say so in motion.notes.`;

export interface VisionAnalyzeParams {
  db: Pool;
  config: AppConfig;
  projectId: string;
  /** Public URLs or data URLs for OpenAI image_url parts */
  imageUrls: string[];
  userContext: string;
}

export async function runCreativeVisualAnalysis(
  params: VisionAnalyzeParams
): Promise<{ parsed: CreativeVisualAnalysisLlm; raw: Record<string, unknown>; model: string }> {
  const apiKey = params.config.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for creative visual analysis");
  const model = params.config.OPENAI_CREATIVE_INTEL_VISION_MODEL || "gpt-4o-mini";
  const maxImg = Math.min(16, Math.max(1, params.config.CREATIVE_INTEL_VISION_MAX_IMAGES));
  const urls = params.imageUrls.filter(Boolean).slice(0, maxImg);
  if (urls.length === 0) throw new Error("No image URLs for creative visual analysis");

  const userParts: ChatContentPart[] = [{ type: "text", text: params.userContext }];
  for (const url of urls) {
    userParts.push({ type: "image_url", image_url: { url, detail: "low" } });
  }

  const out = await openaiChatMultimodal(
    apiKey,
    {
      model,
      system_prompt: SYSTEM,
      user_content: userParts,
      max_tokens: 4096,
      response_format: "json_object",
    },
    {
      db: params.db,
      projectId: params.projectId,
      runId: null,
      taskId: null,
      signalPackId: null,
      step: "creative_intel_vision",
    }
  );

  const rawObj = parseJsonObjectFromLlmText(out.content) ?? {};
  const parsed = parseCreativeVisualAnalysisLlm(rawObj);
  if (!parsed) {
    await tryInsertApiCallAudit(params.db, {
      projectId: params.projectId,
      runId: null,
      taskId: null,
      signalPackId: null,
      step: "creative_intel_vision_parse_fail",
      provider: "openai",
      model: out.model,
      ok: false,
      errorMessage: "Zod parse failed for creative visual analysis",
      requestJson: { image_count: urls.length },
      responseJson: { sample: out.content.slice(0, 2000) },
    });
    throw new Error("Creative visual analysis JSON did not match schema");
  }
  return { parsed, raw: rawObj as Record<string, unknown>, model: out.model };
}
