/**
 * Analysis-driven Flux text-to-image prompts for mimic carousel slides.
 * Uses Nemotron visual_guideline fields (not reference pixels) to brief the image model.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type {
  MimicFluxImagePromptRow,
  MimicFluxImagePromptsBySlide,
  MimicPayloadV1,
} from "../domain/mimic-payload.js";
import type { MimicImageInputMode } from "../domain/mimic-render-settings.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import {
  isMimicFluxAnalysisSufficientForT2i,
  isWhyMimicFluxInputSufficientForT2i,
  mimicSlideHasUsableReference,
} from "../domain/mimic-slide-analysis-quality.js";
import {
  buildWhyMimicFluxSlideInput,
  MIMIC_EXECUTION_MODE_WHY,
  parseWhyMimicSlideIntelligenceFromMimic,
} from "../domain/why-mimic-execution.js";
import { bvsTemplateBgUsesInventedPlates } from "../domain/bvs-render-plan.js";
import { isNewVisualMimicPayload } from "../domain/new-visual-carousel-execution.js";
import {
  buildDeterministicNewVisualFluxPrompt,
  buildNewVisualFluxSlideInput,
} from "./new-visual-carousel-flux-prompts.js";
import { parseBrandExecutionBrief } from "../domain/brand-translation.js";
import { appendBrandBibleToFluxPrompt, parseBrandBible, resolveNewVisualBvsFluxImageReferenceUrls, type BrandBibleSnapshotV1 } from "../domain/brand-bible.js";
import {
  finalizeMimicImageModelPrompt,
  sanitizeLayoutTemplateForImagePrompt,
  sanitizeVisualDescriptionForImagePrompt,
} from "./mimic-prompt-builder.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { buildArtOnlySafeZoneHint } from "./mimic-slide-typography.js";

export type MimicFluxSlideAnalysisInput = {
  slide_index: number;
  source_slide_index: number | null;
  slide_purpose: string | null;
  layout_template: string | null;
  visual_description: string | null;
  visual_hierarchy: string | null;
  layout_structure: string | null;
  deck_why_it_worked: string | null;
  deck_aesthetic: string | null;
  deck_visual_consistency: string | null;
  safe_zone_hint: string;
  copy_theme: string | null;
};

export type MimicFluxPromptGenerationMeta = {
  slides_requested: number;
  slides_written: number;
  slides_reference_fallback: number;
  model: string;
  tokens: number;
  used_llm: boolean;
};

export type MimicSlideImagePromptResolution = {
  prompt: string;
  imageInputMode: MimicImageInputMode;
  usesReferenceImage: boolean;
  /** New visual + BVS moodboard pixels (backgrounds, motifs, mascots) for Flux multi-ref. */
  bvsReferenceUrls?: string[];
  /** analysis_t2i was requested but reference_edit was chosen due to thin Nemotron/SIL analysis. */
  analysisFallbackReason?: "insufficient_slide_analysis" | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function visualGuidelineSlide(
  vg: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): Record<string, unknown> | null {
  if (!vg) return null;
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const match =
    slides.map((s) => asRecord(s)).find((s) => s && Number(s.slide_index) === slideIndex1Based) ??
    asSlideRecord(slides[slideIndex1Based - 1]);
  return match;
}

function asSlideRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function compositionBlueprintFields(slide: Record<string, unknown> | null): {
  visual_hierarchy: string | null;
  layout_structure: string | null;
} {
  const bp = asRecord(slide?.composition_blueprint);
  if (!bp) return { visual_hierarchy: null, layout_structure: null };
  const visual_hierarchy = String(bp.visual_hierarchy ?? "").trim() || null;
  const layout_structure = String(bp.layout_structure ?? "").trim() || null;
  return { visual_hierarchy, layout_structure };
}

function deckMoodFromGuideline(vg: Record<string, unknown> | null | undefined): {
  why_it_worked: string | null;
  aesthetic: string | null;
  consistency: string | null;
} {
  if (!vg) return { why_it_worked: null, aesthetic: null, consistency: null };
  const why_it_worked = String(vg.why_it_worked ?? "").trim() || null;
  const dvs = asRecord(vg.deck_visual_system);
  const aesthetic = String(dvs?.overall_aesthetic ?? "").trim() || null;
  const consistency = String(vg.visual_consistency ?? "").trim() || null;
  return { why_it_worked, aesthetic, consistency };
}

function copyThemeFromParsedSlide(slide: Record<string, unknown> | null | undefined): string | null {
  if (!slide) return null;
  const headline = String(slide.headline ?? slide.title ?? "").trim();
  const body = String(slide.body ?? slide.text ?? "").trim();
  const joined = [headline, body].filter(Boolean).join(" — ");
  return joined ? joined.slice(0, 240) : null;
}

function copyThemeFromLayoutRow(row: MimicSlideCopyLayoutForLlm | undefined): string | null {
  if (!row) return null;
  const ref = String(row.reference_on_screen_text ?? "").trim();
  if (!ref) return null;
  return `Rephrase this slide's message (do not quote): ${ref.slice(0, 200)}`;
}

export function buildMimicFluxSlideAnalysisInput(
  mimic: MimicPayloadV1,
  slideIndex1Based: number,
  opts?: {
    parsedSlide?: Record<string, unknown> | null;
    layoutRow?: MimicSlideCopyLayoutForLlm;
    sourceSlideIndex?: number | null;
  }
): MimicFluxSlideAnalysisInput | null {
  const vg = mimic.visual_guideline;
  const sourceIdx =
    opts?.sourceSlideIndex ??
    mimic.slide_plans?.find((p) => p.slide_index === slideIndex1Based)?.source_slide_index ??
    slideIndex1Based;
  const guidelineSlide = visualGuidelineSlide(vg, sourceIdx ?? slideIndex1Based);
  if (!guidelineSlide && !opts?.layoutRow) return null;

  const { visual_hierarchy, layout_structure } = compositionBlueprintFields(guidelineSlide);
  const deck = deckMoodFromGuideline(vg);
  const safe_zone_hint = buildArtOnlySafeZoneHint(guidelineSlide);

  return {
    slide_index: slideIndex1Based,
    source_slide_index: sourceIdx ?? null,
    slide_purpose:
      typeof guidelineSlide?.slide_purpose === "string"
        ? guidelineSlide.slide_purpose.trim().toLowerCase()
        : null,
    layout_template: sanitizeLayoutTemplateForImagePrompt(
      typeof guidelineSlide?.layout_template === "string"
        ? guidelineSlide.layout_template.trim()
        : opts?.layoutRow?.layout_template ?? null
    ) || null,
    visual_description: sanitizeVisualDescriptionForImagePrompt(
      (typeof guidelineSlide?.visual_description === "string"
        ? guidelineSlide.visual_description
        : null) ??
        (typeof opts?.layoutRow?.visual_description === "string"
          ? opts.layoutRow.visual_description
          : null)
    ),
    visual_hierarchy,
    layout_structure,
    deck_why_it_worked: deck.why_it_worked,
    deck_aesthetic: deck.aesthetic,
    deck_visual_consistency: deck.consistency,
    safe_zone_hint,
    copy_theme:
      copyThemeFromParsedSlide(opts?.parsedSlide) ??
      copyThemeFromLayoutRow(opts?.layoutRow) ??
      null,
  };
}

export function buildDeterministicFluxImagePrompt(input: MimicFluxSlideAnalysisInput): string {
  const parts: string[] = [
    "Instagram carousel slide, portrait 4:5, polished social photography or editorial illustration.",
    "Art-only background plate with ZERO readable text, letters, numbers, logos, watermarks, or @handles.",
  ];

  if (input.slide_purpose === "hook") {
    parts.push("Hook/cover slide — bold attention-grabbing visual energy.");
  } else if (input.slide_purpose === "cta") {
    parts.push("Call-to-action slide — strong visual punch without on-image CTA text.");
  } else if (input.slide_purpose === "storytelling" || input.slide_purpose === "content") {
    parts.push("Content slide — narrative visual that supports swipe storytelling.");
  }

  if (input.deck_why_it_worked) {
    parts.push(`Why this deck works (match the persuasion, not the pixels): ${input.deck_why_it_worked.slice(0, 280)}.`);
  }
  if (input.deck_aesthetic) {
    parts.push(`Series aesthetic: ${input.deck_aesthetic.slice(0, 200)}.`);
  }
  if (input.deck_visual_consistency) {
    parts.push(`Deck consistency: ${input.deck_visual_consistency.slice(0, 200)}.`);
  }
  if (input.layout_template) {
    parts.push(`Layout pattern: ${input.layout_template.slice(0, 160)}.`);
  }
  if (input.layout_structure) {
    parts.push(`Spatial structure: ${input.layout_structure.slice(0, 200)}.`);
  }
  if (input.visual_hierarchy) {
    parts.push(`Visual hierarchy: ${input.visual_hierarchy.slice(0, 200)}.`);
  }
  if (input.visual_description) {
    parts.push(`Scene brief: ${input.visual_description.slice(0, 320)}.`);
  }
  if (input.copy_theme) {
    parts.push(`Message to evoke visually (do not render as text): ${input.copy_theme.slice(0, 220)}.`);
  }
  if (input.safe_zone_hint) {
    parts.push(input.safe_zone_hint);
  }

  parts.push(
    "Invent a fresh image inspired by the reference strategy — not a reshoot or near-duplicate of any specific photo."
  );

  return finalizeMimicImageModelPrompt(parts.join(" "));
}

function slideRowsFromParsed(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
}

const FLUX_PROMPT_LLM_SYSTEM = `You write text-to-image prompts for Instagram carousel background plates (art-only visual plates — template backgrounds and full-bleed slides).

Rules:
- Output ONLY valid JSON: { "slides": [ { "slide_index": number, "flux_image_prompt": string } ] }
- One flux_image_prompt per requested slide_index.
- CRITICAL: Every flux_image_prompt must state that the image contains ZERO readable text — no words, letters, numbers, logos, @handles, watermarks, captions, signs, UI labels, or gibberish. All copy is added later via HTML/CSS overlay only.
- NEVER include readable text, letters, numbers, logos, watermarks, UI labels, or @handles in the image.
- Do NOT quote reference on-screen copy verbatim — convey message and mood visually only.
- Preserve overlay safe zones described in safe_zone_hint (keep those regions smooth and low-detail).
- Match slide narrative role, why the deck worked, and visual hierarchy — but invent a NEW scene/subject.
- Each prompt must be a single dense paragraph (80–220 words), concrete and visual.`;

export async function generateMimicFluxImagePromptsForJob(
  appCfg: AppConfig,
  apiKey: string,
  db: Pool,
  job: { task_id: string; project_id: string; run_id: string | null },
  mimic: MimicPayloadV1,
  parsedOutput: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { useLlm?: boolean; imageInputMode?: MimicImageInputMode }
): Promise<{ bySlide: MimicFluxImagePromptsBySlide; meta: MimicFluxPromptGenerationMeta }> {
  const imageInputMode = opts?.imageInputMode ?? "analysis_t2i";
  const parsedSlides = slideRowsFromParsed(parsedOutput);
  const inputs: MimicFluxSlideAnalysisInput[] = [];

  const slideIndices =
    mimic.slide_plans?.map((p) => p.slide_index).filter((n) => n > 0) ??
    layout.map((r) => r.slide_index).filter((n) => n > 0);

  for (const slideIndex of slideIndices) {
    const layoutRow = layout.find((r) => r.slide_index === slideIndex) ?? layout[slideIndex - 1];
    const plan = mimic.slide_plans?.find((p) => p.slide_index === slideIndex);
    const input = buildMimicFluxSlideAnalysisInput(mimic, slideIndex, {
      parsedSlide: parsedSlides[slideIndex - 1] ?? null,
      layoutRow,
      sourceSlideIndex: plan?.source_slide_index ?? layoutRow?.slide_index ?? slideIndex,
    });
    if (input) inputs.push(input);
  }

  const useLlm = opts?.useLlm !== false && appCfg.MIMIC_FLUX_PROMPT_LLM && apiKey.trim().length > 0;
  let model = "deterministic";
  let tokens = 0;
  const llmPrompts = new Map<number, string>();

  if (useLlm && inputs.length > 0) {
    const userPayload = {
      slides: inputs.map((s) => ({
        slide_index: s.slide_index,
        slide_purpose: s.slide_purpose,
        layout_template: s.layout_template,
        visual_description: s.visual_description,
        visual_hierarchy: s.visual_hierarchy,
        layout_structure: s.layout_structure,
        deck_why_it_worked: s.deck_why_it_worked,
        deck_aesthetic: s.deck_aesthetic,
        deck_visual_consistency: s.deck_visual_consistency,
        safe_zone_hint: s.safe_zone_hint,
        copy_theme: s.copy_theme,
      })),
    };

    try {
      const llm = await openaiChat(
        apiKey,
        {
          model: appCfg.OPENAI_MODEL?.trim() || "gpt-4o",
          system_prompt: FLUX_PROMPT_LLM_SYSTEM,
          user_prompt: JSON.stringify(userPayload),
          max_tokens: openAiMaxTokens(2800, 4000),
          response_format: "json_object",
        },
        {
          db,
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "mimic_flux_image_prompts",
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
      logPipelineEvent("warn", "generate", "mimic_flux_image_prompts_llm_failed", {
        task_id: job.task_id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const bySlide: MimicFluxImagePromptsBySlide = {};
  const generatedAt = new Date().toISOString();
  let slidesReferenceFallback = 0;

  for (const input of inputs) {
    const hasReference = mimicSlideHasUsableReference(mimic, input.slide_index);
    if (
      imageInputMode === "analysis_t2i" &&
      hasReference &&
      !isMimicFluxAnalysisSufficientForT2i(input) &&
      !bvsTemplateBgUsesInventedPlates(mimic)
    ) {
      slidesReferenceFallback++;
      continue;
    }

    const flux_image_prompt =
      llmPrompts.get(input.slide_index) ?? buildDeterministicFluxImagePrompt(input);
    bySlide[String(input.slide_index)] = {
      slide_index: input.slide_index,
      source_slide_index: input.source_slide_index,
      flux_image_prompt,
      image_input_mode: imageInputMode,
      safe_zone_hint: input.safe_zone_hint || null,
      generated_at: generatedAt,
    };
  }

  return {
    bySlide,
    meta: {
      slides_requested: inputs.length,
      slides_written: Object.keys(bySlide).length,
      slides_reference_fallback: slidesReferenceFallback,
      model,
      tokens,
      used_llm: useLlm && llmPrompts.size > 0,
    },
  };
}

function shouldFallbackAnalysisT2iToReference(
  mimic: MimicPayloadV1,
  slideIndex1Based: number
): boolean {
  if (!mimicSlideHasUsableReference(mimic, slideIndex1Based)) return false;

  if (mimic.execution_mode === "new_visual") return false;

  if (isNewVisualMimicPayload(mimic)) return false;

  if (bvsTemplateBgUsesInventedPlates(mimic)) return false;

  if (mimic.execution_mode === MIMIC_EXECUTION_MODE_WHY) {
    const bundle = parseWhyMimicSlideIntelligenceFromMimic(mimic);
    if (!bundle) return true;
    const brandBrief = parseBrandExecutionBrief(mimic.brand_execution_brief);
    const plan = mimic.slide_plans?.find((p) => p.slide_index === slideIndex1Based);
    const sourceIdx = plan?.source_slide_index ?? slideIndex1Based;
    const whyInput = buildWhyMimicFluxSlideInput(bundle, slideIndex1Based, {
      brandBrief,
      sourceSlideIndex: sourceIdx,
    });
    return !isWhyMimicFluxInputSufficientForT2i(whyInput);
  }

  const analysisInput = buildMimicFluxSlideAnalysisInput(mimic, slideIndex1Based);
  return !analysisInput || !isMimicFluxAnalysisSufficientForT2i(analysisInput);
}

function bvsSnapshotFromMimic(mimic: MimicPayloadV1): BrandBibleSnapshotV1 | null {
  if (mimic.bvs_enabled !== true) return null;
  const raw = mimic.bvs_bible_snapshot;
  const parsed = parseBrandBible(raw);
  if (!parsed) return null;
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const resolved = Array.isArray(rec.resolved_assets) ? rec.resolved_assets : [];
  return {
    ...parsed,
    resolved_assets: resolved as BrandBibleSnapshotV1["resolved_assets"],
  };
}

export function appendBvsToMimicFluxPrompt(mimic: MimicPayloadV1, prompt: string): string {
  return appendBrandBibleToFluxPrompt(prompt, bvsSnapshotFromMimic(mimic), { forMimic: true });
}

function withBvsFluxPrompt(mimic: MimicPayloadV1, prompt: string): string {
  if (isNewVisualMimicPayload(mimic)) {
    return appendBrandBibleToFluxPrompt(prompt, bvsSnapshotFromMimic(mimic), { forNewVisual: true });
  }
  return appendBvsToMimicFluxPrompt(mimic, prompt);
}

function newVisualBvsReferenceUrls(mimic: MimicPayloadV1): string[] {
  if (!isNewVisualMimicPayload(mimic) || mimic.bvs_enabled !== true) return [];
  return resolveNewVisualBvsFluxImageReferenceUrls(bvsSnapshotFromMimic(mimic));
}

function productEvidenceReferenceUrls(mimic: MimicPayloadV1): string[] {
  const urls = Array.isArray(mimic.product_evidence_reference_urls)
    ? mimic.product_evidence_reference_urls
    : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 8) break;
  }
  return out;
}

function mergeFluxImageReferenceUrls(mimic: MimicPayloadV1): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [...productEvidenceReferenceUrls(mimic), ...newVisualBvsReferenceUrls(mimic)]) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 8) break;
  }
  return out;
}

const PRODUCT_EVIDENCE_FLUX_NOTE =
  "Attached product evidence images show real product UI — when the slide is about a product feature or screen, ground the scene in those real screenshots (do not invent fake app UI). Keep plates art-only with zero readable text.";

function enrichFluxPromptWithProductEvidence(mimic: MimicPayloadV1, prompt: string): string {
  if (productEvidenceReferenceUrls(mimic).length === 0) return prompt;
  if (/Attached product evidence images/i.test(prompt)) return prompt;
  return `${prompt.trim()}\n\n${PRODUCT_EVIDENCE_FLUX_NOTE}`;
}

function fluxPromptAlreadyHasBvs(prompt: string, forNewVisual: boolean): boolean {
  return forNewVisual
    ? /Brand Visual System \(BVS\) — subject-first/i.test(prompt)
    : /Brand Visual System \(BVS\)/i.test(prompt);
}

function enrichFluxPromptWithBvs(mimic: MimicPayloadV1, prompt: string): string {
  const trimmed = prompt.trim();
  const forNewVisual = isNewVisualMimicPayload(mimic);
  if (fluxPromptAlreadyHasBvs(trimmed, forNewVisual)) {
    return enrichFluxPromptWithProductEvidence(mimic, trimmed);
  }
  return enrichFluxPromptWithProductEvidence(mimic, withBvsFluxPrompt(mimic, trimmed));
}

function withNewVisualBvsImageRefs(
  mimic: MimicPayloadV1,
  resolution: MimicSlideImagePromptResolution
): MimicSlideImagePromptResolution {
  const bvsReferenceUrls = mergeFluxImageReferenceUrls(mimic);
  if (bvsReferenceUrls.length === 0) return resolution;
  return { ...resolution, bvsReferenceUrls };
}

export function resolveMimicSlideImagePrompt(
  mimic: MimicPayloadV1,
  slideIndex1Based: number,
  referenceEditPrompt: string,
  imageInputMode: MimicImageInputMode
): MimicSlideImagePromptResolution {
  if (imageInputMode !== "analysis_t2i") {
    return {
      prompt: referenceEditPrompt,
      imageInputMode: "reference_edit",
      usesReferenceImage: true,
    };
  }

  if (shouldFallbackAnalysisT2iToReference(mimic, slideIndex1Based)) {
    return {
      prompt: referenceEditPrompt,
      imageInputMode: "reference_edit",
      usesReferenceImage: true,
      analysisFallbackReason: "insufficient_slide_analysis",
    };
  }

  const row =
    mimic.flux_image_prompts?.[String(slideIndex1Based)] ??
    (() => {
      const plan = mimic.slide_plans?.find((p) => p.slide_index === slideIndex1Based);
      const src = plan?.source_slide_index;
      return src != null && src > 0 ? mimic.flux_image_prompts?.[String(src)] : undefined;
    })();

  if (row?.flux_image_prompt?.trim()) {
    return withNewVisualBvsImageRefs(mimic, {
      prompt: enrichFluxPromptWithBvs(mimic, row.flux_image_prompt.trim()),
      imageInputMode: "analysis_t2i",
      usesReferenceImage: false,
    });
  }

  const fallbackInput = buildMimicFluxSlideAnalysisInput(mimic, slideIndex1Based);
  if (fallbackInput && isMimicFluxAnalysisSufficientForT2i(fallbackInput)) {
    return withNewVisualBvsImageRefs(mimic, {
      prompt: enrichFluxPromptWithBvs(mimic, buildDeterministicFluxImagePrompt(fallbackInput)),
      imageInputMode: "analysis_t2i",
      usesReferenceImage: false,
    });
  }

  if (mimicSlideHasUsableReference(mimic, slideIndex1Based) && !bvsTemplateBgUsesInventedPlates(mimic)) {
    return {
      prompt: referenceEditPrompt,
      imageInputMode: "reference_edit",
      usesReferenceImage: true,
      analysisFallbackReason: "insufficient_slide_analysis",
    };
  }

  if (fallbackInput) {
    return withNewVisualBvsImageRefs(mimic, {
      prompt: enrichFluxPromptWithBvs(mimic, buildDeterministicFluxImagePrompt(fallbackInput)),
      imageInputMode: "analysis_t2i",
      usesReferenceImage: false,
    });
  }

  if (bvsTemplateBgUsesInventedPlates(mimic)) {
    return withNewVisualBvsImageRefs(mimic, {
      prompt: enrichFluxPromptWithBvs(mimic, referenceEditPrompt),
      imageInputMode: "analysis_t2i",
      usesReferenceImage: false,
    });
  }

  if (isNewVisualMimicPayload(mimic)) {
    const totalSlides = Math.max(
      ...(mimic.slide_plans ?? []).map((p) => p.slide_index).filter((n) => n > 0),
      slideIndex1Based,
      1
    );
    const input = buildNewVisualFluxSlideInput(mimic, slideIndex1Based, totalSlides);
    return withNewVisualBvsImageRefs(mimic, {
      prompt: enrichFluxPromptWithBvs(mimic, buildDeterministicNewVisualFluxPrompt(input)),
      imageInputMode: "analysis_t2i",
      usesReferenceImage: false,
    });
  }

  return {
    prompt: referenceEditPrompt,
    imageInputMode: "reference_edit",
    usesReferenceImage: true,
  };
}
