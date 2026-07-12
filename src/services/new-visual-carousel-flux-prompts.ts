/**
 * Flux text-to-image prompts for New Visual Carousel — idea + BVS + per-slide copy (no TP analysis).
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type {
  MimicFluxImagePromptsBySlide,
  MimicPayloadV1,
} from "../domain/mimic-payload.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { newVisualSlidePurpose } from "../domain/new-visual-carousel-execution.js";
import {
  buildNewVisualFluxSubjectBlock,
  NEW_VISUAL_BANNED_VISUAL_PATTERNS,
  NEW_VISUAL_SAFE_ZONE_HINT,
  NEW_VISUAL_SERIES_COHESION_HINT,
  NEW_VISUAL_SUBJECT_FIRST_RULES,
  inferLiteralSubjectCueFromCopyTheme,
} from "../domain/new-visual-flux-subject-policy.js";
import { extractVisualFirstSlideVisualFields } from "../domain/visual-first-carousel-visual-direction.js";
import { appendBrandBibleToFluxPrompt, parseBrandBible, type BrandBibleSnapshotV1 } from "../domain/brand-bible.js";
import { finalizeMimicImageModelPrompt, sanitizeVisualDescriptionForImagePrompt } from "./mimic-prompt-builder.js";
import type { MimicFluxPromptGenerationMeta } from "./mimic-flux-image-prompts.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export type NewVisualFluxSlideInput = {
  slide_index: number;
  total_slides: number;
  slide_purpose: string;
  deck_concept: string | null;
  thesis: string | null;
  copy_theme: string | null;
  visual_direction: string | null;
  visual_metaphor: string | null;
  must_avoid: string | null;
  brand_palette: string | null;
  brand_motifs: string | null;
  brand_visual_mode: string | null;
  safe_zone_hint: string;
  literal_subject_cue: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function slideRowsFromParsed(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
}

function copyThemeFromSlide(slide: Record<string, unknown> | null | undefined): string | null {
  if (!slide) return null;
  const parts = [
    String(slide.headline ?? slide.title ?? "").trim(),
    String(slide.body ?? slide.subtitle ?? "").trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ").slice(0, 220) : null;
}

function copyThemeFromLayoutRow(row: MimicSlideCopyLayoutForLlm | null | undefined): string | null {
  if (!row) return null;
  const ref = String(row.reference_on_screen_text ?? "").trim();
  return ref ? ref.slice(0, 220) : null;
}

function visualFieldsFromSlide(slide: Record<string, unknown> | null | undefined) {
  const fields = extractVisualFirstSlideVisualFields(slide);
  return {
    visual_direction: sanitizeVisualDescriptionForImagePrompt(fields.visual_direction) || null,
    visual_metaphor: fields.visual_metaphor,
    must_avoid: fields.must_avoid,
  };
}

function bvsHintsFromMimic(mimic: MimicPayloadV1): {
  palette: string | null;
  motifs: string | null;
  visual_mode: string | null;
} {
  const bible = parseBrandBible(mimic.bvs_bible_snapshot);
  if (!bible) {
    return { palette: null, motifs: null, visual_mode: null };
  }
  const palette = Array.isArray(bible.palette) ? bible.palette.filter(Boolean).slice(0, 8).join(", ") : null;
  const motifs = Array.isArray(bible.allowed_motifs)
    ? bible.allowed_motifs.map((m) => String(m)).filter(Boolean).slice(0, 10).join(", ")
    : null;
  const visual_mode = String(bible.visual_mode ?? "").trim() || null;
  return { palette, motifs, visual_mode };
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

export function appendBvsToNewVisualFluxPrompt(mimic: MimicPayloadV1, prompt: string): string {
  return appendBrandBibleToFluxPrompt(prompt, bvsSnapshotFromMimic(mimic), { forNewVisual: true });
}

export function buildNewVisualFluxSlideInput(
  mimic: MimicPayloadV1,
  slideIndex: number,
  totalSlides: number,
  opts?: { parsedSlide?: Record<string, unknown> | null; layoutRow?: MimicSlideCopyLayoutForLlm | null }
): NewVisualFluxSlideInput {
  const vg = asRecord(mimic.visual_guideline) ?? {};
  const bvs = bvsHintsFromMimic(mimic);
  const purpose = newVisualSlidePurpose(slideIndex, totalSlides);
  const deck_concept = String(vg.deck_concept ?? "").trim() || null;
  const thesis = String(vg.thesis ?? "").trim() || null;
  const copy_theme = copyThemeFromSlide(opts?.parsedSlide) ?? copyThemeFromLayoutRow(opts?.layoutRow ?? null);
  const visual = visualFieldsFromSlide(opts?.parsedSlide);
  const literal_subject_cue = inferLiteralSubjectCueFromCopyTheme({
    copyTheme: copy_theme,
    deckConcept: deck_concept,
    thesis,
    slidePurpose: purpose,
    slideIndex,
    visualDirection: visual.visual_direction,
  });

  return {
    slide_index: slideIndex,
    total_slides: totalSlides,
    slide_purpose: purpose,
    deck_concept,
    thesis,
    copy_theme,
    visual_direction: visual.visual_direction,
    visual_metaphor: visual.visual_metaphor,
    must_avoid: visual.must_avoid,
    brand_palette: bvs.palette,
    brand_motifs: bvs.motifs,
    brand_visual_mode: bvs.visual_mode,
    safe_zone_hint: NEW_VISUAL_SAFE_ZONE_HINT,
    literal_subject_cue,
  };
}

export function buildDeterministicNewVisualFluxPrompt(input: NewVisualFluxSlideInput): string {
  const parts: string[] = [
    "Instagram carousel slide, portrait 4:5, scroll-stopping editorial photography or premium illustrated scene.",
    "Art-only background plate with ZERO readable text, letters, numbers, logos, watermarks, or @handles.",
    "Do not render paragraph blocks, hashtags, listicle headers, or UI chrome — copy is added later via HTML overlay.",
    NEW_VISUAL_SUBJECT_FIRST_RULES,
    NEW_VISUAL_BANNED_VISUAL_PATTERNS,
    NEW_VISUAL_SERIES_COHESION_HINT,
  ];

  if (input.slide_purpose === "hook") {
    parts.push("Hook/cover slide — one bold hero subject or vista that stops the scroll immediately.");
  } else if (input.slide_purpose === "cta") {
    parts.push("Closing slide — memorable cinematic subject or intimate lifestyle moment with strong color and depth.");
  } else {
    parts.push("Content slide — narrative scene with a clear focal subject supporting the slide message.");
  }

  if (input.visual_direction) {
    parts.push(`Scene brief (primary — follow closely): ${input.visual_direction.slice(0, 320)}.`);
  } else if (input.literal_subject_cue) {
    parts.push(input.literal_subject_cue);
  }

  if (input.visual_metaphor) {
    parts.push(`Visual metaphor: ${input.visual_metaphor.slice(0, 80)}.`);
  }
  if (input.must_avoid) {
    parts.push(`Must avoid on this slide: ${input.must_avoid.slice(0, 140)}.`);
  }

  if (input.deck_concept) {
    parts.push(`Deck concept (mood only, do not render as text): ${input.deck_concept.slice(0, 160)}.`);
  }
  if (input.thesis) parts.push(`Creative thesis: ${input.thesis.slice(0, 200)}.`);
  if (input.brand_visual_mode) parts.push(`Brand visual mode: ${input.brand_visual_mode}.`);
  if (input.brand_palette) {
    parts.push(`Color grade inspired by palette: ${input.brand_palette} — applied to a real scene, not a flat swatch background.`);
  }
  if (input.brand_motifs) {
    parts.push(`Brand motifs as subtle scene accents only (never wallpaper): ${input.brand_motifs}.`);
  }
  if (input.copy_theme) {
    parts.push(`Slide message to support visually (never render as text): ${input.copy_theme}.`);
  }
  if (input.safe_zone_hint) parts.push(input.safe_zone_hint);

  parts.push(
    "Invent a fresh original photograph-quality scene — entertaining, specific, and highly visual; not a template, not a reshoot of any reference post."
  );

  return finalizeMimicImageModelPrompt(parts.join(" "));
}

const NEW_VISUAL_FLUX_PROMPT_LLM_SYSTEM = `You write text-to-image prompts for **brand-original** Instagram carousel background plates.

Your #1 job: scroll-stopping scenes that **support each slide's argument** — concrete subjects, cinematic lighting, depth. Premium social editorial, not generic stock templates.

Rules:
- Output ONLY valid JSON: { "slides": [ { "slide_index": number, "flux_image_prompt": string } ] }
- One flux_image_prompt per requested slide_index.
- CRITICAL: ZERO readable text — no words, letters, numbers, logos, @handles, watermarks, or gibberish.
- When visual_direction is provided, treat it as the **primary scene brief** — expand it into a dense Flux prompt; do not ignore it or substitute unrelated subjects.
- Illustrate the slide **argument** (problem vs tip vs outcome) — not keyword literals (e.g. "basket" ≠ random dog in a basket unless visual_direction says so).
- **Series cohesion:** all slides in the batch share one color grade, lighting family, and editorial tone; vary subject and framing, not random unrelated genres.
- **No random pets/animals** unless copy_theme or visual_direction explicitly calls for animals.
- Problem/pain slides: show tension or friction — not the aspirational opposite.
- How-to slides: process, hands, tools, ingredients — not decorative unrelated subjects.
- FORBIDDEN primary visuals: flat gradients, starfields, zodiac wheels, cosmic line-art wallpaper, empty abstract patterns, generic stock clichés.
- Brand palette/motifs are color and accent cues inside a real scene — never the whole image.
- Honor safe_zone_hint — softer center band for overlay, rich detail around it.
- Respect must_avoid when provided.
- Each prompt: one dense paragraph (90–220 words), concrete, specific, and on-message.`;

export async function generateNewVisualFluxImagePromptsForJob(
  appCfg: AppConfig,
  apiKey: string,
  db: Pool,
  job: { task_id: string; project_id: string; run_id: string | null },
  mimic: MimicPayloadV1,
  parsedOutput: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { useLlm?: boolean }
): Promise<{ bySlide: MimicFluxImagePromptsBySlide; meta: MimicFluxPromptGenerationMeta }> {
  const parsedSlides = slideRowsFromParsed(parsedOutput);
  const planIndices = (mimic.slide_plans ?? []).map((p) => p.slide_index).filter((n) => n > 0);
  const layoutIndices = layout.map((r) => r.slide_index).filter((n) => n > 0);
  const slideIndices =
    planIndices.length > 0
      ? planIndices
      : layoutIndices.length > 0
        ? layoutIndices
        : parsedSlides.map((_, i) => i + 1).filter((n) => n > 0);
  const totalSlides = Math.max(...slideIndices, parsedSlides.length, layout.length, 1);

  const inputs: NewVisualFluxSlideInput[] = slideIndices.map((slideIndex) => {
    const layoutRow = layout.find((r) => r.slide_index === slideIndex) ?? layout[slideIndex - 1];
    return buildNewVisualFluxSlideInput(mimic, slideIndex, totalSlides, {
      parsedSlide: parsedSlides[slideIndex - 1] ?? null,
      layoutRow,
    });
  });

  const useLlm = opts?.useLlm !== false && appCfg.MIMIC_FLUX_PROMPT_LLM && apiKey.trim().length > 0;
  let model = "deterministic_new_visual";
  let tokens = 0;
  const llmPrompts = new Map<number, string>();

  if (useLlm && inputs.length > 0) {
    try {
      const llm = await openaiChat(
        apiKey,
        {
          model: appCfg.OPENAI_MODEL?.trim() || "gpt-4o",
          system_prompt: NEW_VISUAL_FLUX_PROMPT_LLM_SYSTEM,
          user_prompt: JSON.stringify({
            deck_series_cohesion: NEW_VISUAL_SERIES_COHESION_HINT,
            subject_policy: buildNewVisualFluxSubjectBlock({
              deckConcept: inputs[0]?.deck_concept,
              thesis: inputs[0]?.thesis,
            }),
            slides: inputs.map((s) => ({
              slide_index: s.slide_index,
              slide_purpose: s.slide_purpose,
              deck_concept: s.deck_concept,
              thesis: s.thesis,
              copy_theme: s.copy_theme,
              visual_direction: s.visual_direction,
              visual_metaphor: s.visual_metaphor,
              must_avoid: s.must_avoid,
              literal_subject_cue: s.literal_subject_cue,
              brand_palette: s.brand_palette,
              brand_motifs: s.brand_motifs,
              brand_visual_mode: s.brand_visual_mode,
              safe_zone_hint: s.safe_zone_hint,
            })),
          }),
          max_tokens: openAiMaxTokens(2800, 4000),
          response_format: "json_object",
        },
        {
          db,
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "new_visual_flux_image_prompts",
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
      logPipelineEvent("warn", "generate", "new_visual_flux_image_prompts_llm_failed", {
        task_id: job.task_id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const bySlide: MimicFluxImagePromptsBySlide = {};
  const generatedAt = new Date().toISOString();
  for (const input of inputs) {
    const flux_image_prompt = appendBvsToNewVisualFluxPrompt(
      mimic,
      llmPrompts.get(input.slide_index) ?? buildDeterministicNewVisualFluxPrompt(input)
    );
    bySlide[String(input.slide_index)] = {
      slide_index: input.slide_index,
      source_slide_index: input.slide_index,
      flux_image_prompt,
      image_input_mode: "analysis_t2i",
      safe_zone_hint: input.safe_zone_hint || null,
      generated_at: generatedAt,
    };
  }

  return {
    bySlide,
    meta: {
      slides_requested: inputs.length,
      slides_written: Object.keys(bySlide).length,
      slides_reference_fallback: 0,
      model,
      tokens,
      used_llm: useLlm && llmPrompts.size > 0,
    },
  };
}
