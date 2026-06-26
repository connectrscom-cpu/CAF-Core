/**
 * Why Mimic carousel flow — SIL + generated copy → per-slide Flux image prompts.
 * Replaces aesthetic-paraphrase inputs used by classic mimic when `execution_mode === why_mimic`.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type {
  MimicFluxImagePromptRow,
  MimicFluxImagePromptsBySlide,
  MimicPayloadV1,
} from "../domain/mimic-payload.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { parseBrandExecutionBrief } from "../domain/brand-translation.js";
import {
  buildWhyMimicFluxSlideInput,
  parseWhyMimicSlideIntelligenceFromMimic,
} from "../domain/why-mimic-execution.js";
import {
  finalizeMimicImageModelPrompt,
  sanitizeVisualDescriptionForImagePrompt,
} from "./mimic-prompt-builder.js";
import type { MimicFluxPromptGenerationMeta } from "./mimic-flux-image-prompts.js";
import { mimicSlideHasUsableReference, isWhyMimicFluxInputSufficientForT2i } from "../domain/mimic-slide-analysis-quality.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { buildArtOnlySafeZoneHint } from "./mimic-slide-typography.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function visualGuidelineSlide(
  vg: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): Record<string, unknown> | null {
  if (!vg) return null;
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const match = slides
    .map((s) => asRecord(s))
    .find((s) => s && Number(s.slide_index) === slideIndex1Based);
  return match ?? asRecord(slides[slideIndex1Based - 1]);
}

function slideRowsFromParsed(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
}

const WHY_MIMIC_FLUX_PROMPT_LLM_SYSTEM = `You write text-to-image prompts for Instagram carousel background plates in the **Why Mimic** lane.

Each slide has a strategic job (role, mechanism, why-it-works, visual_description) and fresh on-slide copy already written. Your image prompt must serve that SAME strategic objective — invent a new scene/subject that supports the copy and mechanism, not a reshoot of any reference photo.

Rules:
- Output ONLY valid JSON: { "slides": [ { "slide_index": number, "flux_image_prompt": string } ] }
- One flux_image_prompt per requested slide_index.
- CRITICAL: ZERO readable text in the image — no words, letters, numbers, logos, @handles, watermarks, captions, signs, or UI. All copy is composited later via HTML/CSS overlay.
- Honor safe_zone_hint — keep overlay regions smooth and low-detail.
- Match slide_role, narrative_function, psychological_trigger, and generated_headline/body **mood** — do not quote copy verbatim in the image.
- Each prompt: one dense paragraph (80–220 words), concrete and visual.`;

function deterministicWhyMimicFluxPrompt(input: ReturnType<typeof buildWhyMimicFluxSlideInput>): string {
  if (!input) return "";
  const parts: string[] = [];
  parts.push("Instagram carousel background plate, art-only, zero readable text or logos.");
  if (input.slide_role) parts.push(`Slide role: ${input.slide_role}.`);
  if (input.narrative_function) parts.push(`Narrative function: ${input.narrative_function}.`);
  if (input.psychological_trigger) parts.push(`Psychological trigger: ${input.psychological_trigger}.`);
  if (input.visual_role) parts.push(`Visual role: ${input.visual_role}.`);
  if (input.visual_description) parts.push(`Reference imagery: ${input.visual_description.slice(0, 320)}.`);
  if (input.why_it_works) parts.push(`Why this slide works: ${input.why_it_works.slice(0, 320)}.`);
  if (input.deck_strategic_thesis)
    parts.push(`Deck strategic thesis: ${input.deck_strategic_thesis.slice(0, 180)}.`);
  if (input.generated_headline)
    parts.push(`On-slide headline (compose around, do not render as text): ${input.generated_headline.slice(0, 120)}.`);
  if (input.generated_body)
    parts.push(`On-slide body theme: ${input.generated_body.slice(0, 160)}.`);
  if (input.symbolic_elements.length > 0) {
    const sym = input.symbolic_elements
      .slice(0, 3)
      .map((s) => `${s.element} (${s.connotations.slice(0, 2).join(", ")})`)
      .join("; ");
    parts.push(`Symbolic direction: ${sym}.`);
  }
  if (input.safe_zone_hint) parts.push(input.safe_zone_hint);
  parts.push("Fresh invented imagery supporting the strategic function — not a duplicate of any reference frame.");
  return finalizeMimicImageModelPrompt(parts.join(" "));
}

export async function generateWhyMimicFluxImagePromptsForJob(
  appCfg: AppConfig,
  apiKey: string,
  db: Pool,
  job: { task_id: string; project_id: string; run_id: string | null },
  mimic: MimicPayloadV1,
  parsedOutput: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { useLlm?: boolean }
): Promise<{ bySlide: MimicFluxImagePromptsBySlide; meta: MimicFluxPromptGenerationMeta }> {
  const bundle = parseWhyMimicSlideIntelligenceFromMimic(mimic);
  const brandBrief = parseBrandExecutionBrief(mimic.brand_execution_brief);
  const parsedSlides = slideRowsFromParsed(parsedOutput);

  const slideIndices =
    mimic.slide_plans?.map((p) => p.slide_index).filter((n) => n > 0) ??
    layout.map((r) => r.slide_index).filter((n) => n > 0);

  const inputs = slideIndices
    .map((slideIndex) => {
      const layoutRow = layout.find((r) => r.slide_index === slideIndex);
      const sourceIdx =
        mimic.slide_plans?.find((p) => p.slide_index === slideIndex)?.source_slide_index ?? slideIndex;
      const guidelineSlide = visualGuidelineSlide(mimic.visual_guideline ?? null, sourceIdx);
      const safeZone = buildArtOnlySafeZoneHint(guidelineSlide);
      const input = buildWhyMimicFluxSlideInput(bundle!, slideIndex, {
        parsedSlide: parsedSlides[slideIndex - 1] ?? null,
        brandBrief,
        safeZoneHint: safeZone,
      });
      if (!input) return null;
      const visualDesc = sanitizeVisualDescriptionForImagePrompt(
        String(input.visual_description ?? layoutRow?.visual_description ?? "")
      );
      if (visualDesc) {
        input.safe_zone_hint = [input.safe_zone_hint, `Layout note: ${visualDesc.slice(0, 120)}`]
          .filter(Boolean)
          .join(" ");
      }
      return input;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (!bundle || inputs.length === 0) {
    logPipelineEvent("warn", "generate", "why_mimic_flux_prompts_no_sil", {
      task_id: job.task_id,
      data: { slide_indices: slideIndices.length },
    });
    return {
      bySlide: {},
      meta: {
        slides_requested: slideIndices.length,
        slides_written: 0,
        slides_reference_fallback: 0,
        model: "none",
        tokens: 0,
        used_llm: false,
      },
    };
  }

  const useLlm = opts?.useLlm !== false && appCfg.MIMIC_FLUX_PROMPT_LLM && apiKey.trim().length > 0;
  let model = "deterministic";
  let tokens = 0;
  const llmPrompts = new Map<number, string>();

  if (useLlm) {
    try {
      const llm = await openaiChat(
        apiKey,
        {
          model: appCfg.OPENAI_MODEL?.trim() || "gpt-4o",
          system_prompt: WHY_MIMIC_FLUX_PROMPT_LLM_SYSTEM,
          user_prompt: JSON.stringify({ slides: inputs }),
          max_tokens: openAiMaxTokens(2800, 4000),
          response_format: "json_object",
        },
        {
          db,
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "why_mimic_flux_image_prompts",
        }
      );
      model = llm.model;
      tokens = llm.total_tokens;
      const parsed = parseJsonObjectFromLlmText(llm.content);
      const rows = Array.isArray(parsed?.slides) ? parsed.slides : [];
      for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const slideIndex = Number(rec.slide_index);
        const prompt = String(rec.flux_image_prompt ?? "").trim();
        if (!Number.isFinite(slideIndex) || slideIndex < 1 || !prompt) continue;
        llmPrompts.set(slideIndex, finalizeMimicImageModelPrompt(prompt));
      }
    } catch (err) {
      logPipelineEvent("warn", "generate", "why_mimic_flux_image_prompts_llm_failed", {
        task_id: job.task_id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const bySlide: MimicFluxImagePromptsBySlide = {};
  const generatedAt = new Date().toISOString();
  let written = 0;
  let slidesReferenceFallback = 0;

  for (const input of inputs) {
    const hasReference = mimicSlideHasUsableReference(mimic, input.slide_index);
    if (hasReference && !isWhyMimicFluxInputSufficientForT2i(input)) {
      slidesReferenceFallback++;
      continue;
    }

    const flux_image_prompt =
      llmPrompts.get(input.slide_index) ?? deterministicWhyMimicFluxPrompt(input);
    if (!flux_image_prompt.trim()) {
      if (hasReference) slidesReferenceFallback++;
      continue;
    }
    const row: MimicFluxImagePromptRow = {
      slide_index: input.slide_index,
      source_slide_index: input.slide_index,
      flux_image_prompt,
      image_input_mode: "analysis_t2i",
      safe_zone_hint: input.safe_zone_hint || null,
      generated_at: generatedAt,
    };
    bySlide[String(input.slide_index)] = row;
    written++;
  }

  return {
    bySlide,
    meta: {
      slides_requested: inputs.length,
      slides_written: written,
      slides_reference_fallback: slidesReferenceFallback,
      model,
      tokens,
      used_llm: useLlm && llmPrompts.size > 0,
    },
  };
}
