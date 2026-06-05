/**
 * Post-generation Nemotron / processing-vision pass — visual mimic QA only (no OCR).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { ChatContentPart } from "./openai-chat-multimodal.js";
import { processingVisionChatMultimodal } from "./processing-vision-client.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import type { CarouselOutputIntended, CarouselOutputNemotronVisual } from "../domain/carousel-slide-analysis.js";

const SYSTEM = `You are a carousel render QA reviewer. Document AI already extracted on-screen text — do NOT transcribe text.

Compare the GENERATED slide image to the REFERENCE (when provided) and the INTENDED spec summary.

Return ONLY JSON:
{
  "matches_intended_layout": boolean,
  "matches_reference_composition": "low" | "medium" | "high" | null,
  "layout_similarity": "low" | "medium" | "high",
  "background_quality": "clean" | "busy" | "broken" | "off-brand",
  "visual_artifacts": ["..."],
  "unwanted_text_in_image": boolean,
  "mimic_faithfulness": "low" | "medium" | "high" | null,
  "main_deviation": "one sentence",
  "readability_issues": ["..."],
  "brand_safety_issues": ["..."],
  "recommended_action": "approve" | "revise_text" | "regenerate_background" | "manual_review",
  "confidence": number
}

Judge: composition, negative space, focal point, AI artifacts in the photo/illustration layer, stray letters baked into the image (not HBS overlay), mimic faithfulness to reference structure.`;

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function pickAction(raw: unknown): CarouselOutputNemotronVisual["recommended_action"] {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "approve" || s === "revise_text" || s === "regenerate_background" || s === "manual_review") {
    return s;
  }
  return "manual_review";
}

function pickSim(raw: unknown): "low" | "medium" | "high" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

export async function runCarouselOutputNemotronVisualReview(args: {
  config: AppConfig;
  profileModel: string;
  renderedImageUrl: string;
  referenceImageUrl?: string | null;
  intended: CarouselOutputIntended;
  taskId: string;
  projectId: string;
  runId: string | null;
  db: Pool;
}): Promise<{ result: CarouselOutputNemotronVisual; model: string }> {
  const intendedSummary = {
    art_only_image: args.intended.art_only_image,
    expected_lines: args.intended.text_layers.map((l) => l.text).slice(0, 12),
    forbidden: args.intended.forbidden_text.slice(0, 8),
  };

  const userParts: ChatContentPart[] = [
    {
      type: "text",
      text:
        `INTENDED_SPEC:\n${JSON.stringify(intendedSummary)}\n\n` +
        `First image: GENERATED output. ${args.referenceImageUrl ? "Second image: REFERENCE top performer." : "No reference image."}`,
    },
    { type: "image_url", image_url: { url: args.renderedImageUrl, detail: "high" } },
  ];
  if (args.referenceImageUrl) {
    userParts.push({ type: "image_url", image_url: { url: args.referenceImageUrl, detail: "low" } });
  }

  const out = await processingVisionChatMultimodal(
    args.config,
    args.profileModel,
    {
      system_prompt: SYSTEM,
      user_content: userParts,
      max_tokens: 1200,
      response_format: "json_object",
    },
    {
      db: args.db,
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId,
      signalPackId: null,
      step: "carousel_output_nemotron_visual",
    }
  );

  const parsed = parseJsonObjectFromLlmText(out.content) ?? {};
  const conf = Number(parsed.confidence);
  const result: CarouselOutputNemotronVisual = {
    matches_intended_layout: parsed.matches_intended_layout === true,
    matches_reference_composition:
      parsed.matches_reference_composition != null
        ? String(parsed.matches_reference_composition)
        : pickSim(parsed.mimic_faithfulness),
    layout_similarity: pickSim(parsed.layout_similarity),
    background_quality: parsed.background_quality != null ? String(parsed.background_quality) : null,
    visual_artifacts: asStrArray(parsed.visual_artifacts),
    unwanted_text_in_image: parsed.unwanted_text_in_image === true,
    mimic_faithfulness: pickSim(parsed.mimic_faithfulness),
    main_deviation: typeof parsed.main_deviation === "string" ? parsed.main_deviation : null,
    readability_issues: asStrArray(parsed.readability_issues),
    brand_safety_issues: asStrArray(parsed.brand_safety_issues),
    recommended_action: pickAction(parsed.recommended_action),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
  return { result, model: out.model };
}
