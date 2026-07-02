/**
 * Post-generation LLM pass: after text_blocks[] exist, refine one coherent phrase per copy slot cluster.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { slideCopyBlocksNeedCoherence } from "../domain/mimic-ocr-garbage.js";
import { sanitizeMimicOverlayCopyText } from "../domain/mimic-overlay-copy.js";
import {
  hasUsableSemanticContract,
  type SemanticContractV1,
} from "../domain/semantic-contract.js";
import { formatInstagramHandleForCta } from "../domain/instagram-handle.js";
import {
  collapseTextBlocksToCopySlots,
  type MimicReferenceCopySlot,
} from "./mimic-copy-slots.js";

export { collapseTextBlocksToCopySlots };
import {
  enforceMimicCopyBudgetOnParsedOutput,
  mimicCopySlotBudgets,
  parseMimicCopyCharSlack,
  parseMimicCopyReferenceScale,
} from "./mimic-reference-copy-budget.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export type MimicCopyGroupingMeta = {
  slides_reviewed: number;
  slides_applied: number;
  model: string;
  tokens: number;
};

export type MimicSemanticCoherenceMeta = {
  coherence_score: number;
  slides_rewritten: number;
  model: string;
  tokens: number;
  drift_summary: string | null;
};

type SlotInput = {
  slot_index: number;
  llm_field: string;
  max_chars: number;
  ocr_box_count: number;
  draft_text: string;
};

type SlideSlotInput = {
  slide_index: number;
  slide_purpose: string | null;
  slots: SlotInput[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function slideRows(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const slides = parsed.slides;
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
}

function textBlocksFromSlide(slide: Record<string, unknown>): Array<{ role: string; text: string }> {
  const raw = slide.text_blocks;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: string; text: string }> = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    out.push({
      role: String(rec.role ?? "body").trim() || "body",
      text: sanitizeMimicOverlayCopyText(rec.text),
    });
  }
  return out;
}

function syncHeadlineBodyFromSlotBlocks(
  slide: Record<string, unknown>,
  slots: MimicReferenceCopySlot[],
  texts: string[]
): Record<string, unknown> {
  const text_blocks = slots.map((slot, i) => ({
    role: slot.llm_field,
    text: texts[i] ?? "",
  }));
  const headline = text_blocks
    .filter((b) => /headline|title|hook|cover|kicker/i.test(b.role))
    .map((b) => b.text)
    .filter(Boolean)
    .join(" ")
    .trim();
  const body = text_blocks
    .filter((b) => !/headline|title|hook|cover|kicker|handle/i.test(b.role))
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  const next: Record<string, unknown> = { ...slide, text_blocks };
  if (headline) next.headline = headline;
  if (body) next.body = body;
  return next;
}

export function buildCopyGroupingSlideInputs(
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number }
): SlideSlotInput[] {
  const scale = parseMimicCopyReferenceScale(opts?.scale);
  const slack = parseMimicCopyCharSlack(opts?.charSlack);
  const slotBudgets = mimicCopySlotBudgets(layout, { scale, charSlack: slack });
  const slides = slideRows(parsed);
  const out: SlideSlotInput[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const layoutRow = layout[i] ?? layout.find((r) => r.slide_index === i + 1);
    const slots = layoutRow?.copy_slots_v1 ?? [];
    if (slots.length === 0) continue;

    const slideIndex = layoutRow?.slide_index ?? i + 1;
    const blocks = textBlocksFromSlide(slide);
    const collapsed = collapseTextBlocksToCopySlots(blocks, slots);
    const fragmented =
      blocks.length !== slots.length || slideCopyBlocksNeedCoherence(collapsed.filter(Boolean));
    if (slots.length < 2 && !fragmented) continue;

    const slotInputs: SlotInput[] = slots.map((slot, slotIdx) => {
      const budget = slotBudgets.find(
        (b) => b.slide_index === slideIndex && b.slot_index === slot.slot_index
      );
      return {
        slot_index: slot.slot_index,
        llm_field: slot.llm_field,
        max_chars: budget?.max_chars ?? 80 + slack,
        ocr_box_count: Math.max(1, slot.block_indices.length),
        draft_text: collapsed[slotIdx] ?? "",
      };
    });

    out.push({
      slide_index: slideIndex,
      slide_purpose: layoutRow?.slide_purpose ?? null,
      slots: slotInputs,
    });
  }

  return out;
}

export function applySlotGroupingToSlide(
  slide: Record<string, unknown>,
  slots: MimicReferenceCopySlot[],
  slotTexts: Map<number, string>
): Record<string, unknown> | null {
  if (slots.length === 0) return null;
  const texts = slots.map((slot) => sanitizeMimicOverlayCopyText(slotTexts.get(slot.slot_index) ?? ""));
  if (texts.every((t) => !t)) return null;
  return syncHeadlineBodyFromSlotBlocks(slide, slots, texts);
}

export function applyCopyGroupingLlmResultToParsed(
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  llmParsed: Record<string, unknown>
): { parsed: Record<string, unknown>; slides_applied: number } {
  const slides = slideRows(parsed);
  if (slides.length === 0) return { parsed, slides_applied: 0 };

  const refinedSlides = llmParsed.slides;
  if (!Array.isArray(refinedSlides)) return { parsed, slides_applied: 0 };

  let slides_applied = 0;
  const nextSlides = slides.map((slide, i) => {
    const layoutRow = layout[i] ?? layout.find((r) => r.slide_index === i + 1);
    const slots = layoutRow?.copy_slots_v1 ?? [];
    if (slots.length === 0) return slide;

    const slideIndex = layoutRow?.slide_index ?? i + 1;
    const rec = refinedSlides
      .map((item) => asRecord(item))
      .find((r) => r && Number(r.slide_index) === slideIndex);
    if (!rec) return slide;

    const slotTexts = new Map<number, string>();
    const slotsRaw = Array.isArray(rec.slots) ? rec.slots : [];
    for (const item of slotsRaw) {
      const sRec = asRecord(item);
      if (!sRec) continue;
      const slotIndex = Number(sRec.slot_index);
      const text = sanitizeMimicOverlayCopyText(sRec.text);
      if (!Number.isFinite(slotIndex) || slotIndex < 0 || !text) continue;
      slotTexts.set(slotIndex, text);
    }

    if (slotTexts.size === 0) return slide;
    const next = applySlotGroupingToSlide(slide, slots, slotTexts);
    if (!next) return slide;
    slides_applied++;
    return next;
  });

  if (slides_applied === 0) return { parsed, slides_applied: 0 };
  return { parsed: { ...parsed, slides: nextSlides }, slides_applied };
}

const GROUPING_SYSTEM = [
  "You are a carousel on-image copy editor.",
  "Each slide has copy SLOT CLUSTERS — semantic groups that may span multiple OCR boxes on the reference.",
  "Your job: rewrite draft copy so each slot is ONE coherent phrase (not fragmented OCR micro-lines).",
  "Remove OCR garbage (math, LaTeX, random symbols). Respect max_chars per slot.",
  "Return one `text` string per slot_index. Do not split one cluster into multiple slots.",
  "When llm_field is handle, use only the project @handle from input.",
  "Return JSON only.",
].join(" ");

export async function refineMimicCarouselCopyCoherence(
  appConfig: AppConfig,
  apiKey: string,
  db: Pool,
  job: { task_id: string; project_id: string; run_id: string },
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: {
    scale?: number;
    charSlack?: number;
    projectHandle?: string | null;
    caption?: string | null;
  }
): Promise<{ parsed: Record<string, unknown>; meta: MimicCopyGroupingMeta | null }> {
  const inputs = buildCopyGroupingSlideInputs(parsed, layout, opts);
  if (inputs.length === 0) {
    return { parsed, meta: null };
  }

  const userPayload = {
    project_handle: opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null,
    caption_context: opts?.caption?.trim() || null,
    slides: inputs,
  };

  const user = [
    "Review draft copy per COPY SLOT (cluster). Return one coherent phrase per slot — not per OCR box.",
    "Output JSON:",
    `{ "slides": [ { "slide_index": number, "slots": [ { "slot_index": number, "text": string } ] } ] }`,
    "",
    JSON.stringify(userPayload, null, 2),
  ].join("\n");

  const llm = await openaiChat(
    apiKey,
    {
      model: appConfig.OPENAI_MODEL,
      system_prompt: GROUPING_SYSTEM,
      user_prompt: user,
      max_tokens: openAiMaxTokens(4096),
      response_format: "json_object",
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "mimic_copy_slot_grouping_review",
    }
  );

  const llmParsed = parseJsonObjectFromLlmText(llm.content);
  if (!llmParsed) {
    logPipelineEvent("warn", "generate", "Mimic copy slot grouping LLM returned non-JSON; keeping draft copy", {
      task_id: job.task_id,
    });
    return { parsed, meta: null };
  }

  const applied = applyCopyGroupingLlmResultToParsed(parsed, layout, llmParsed);
  let next = applied.parsed;
  next = enforceMimicCopyBudgetOnParsedOutput(next, layout, {
    scale: opts?.scale,
    charSlack: opts?.charSlack,
    projectHandle: opts?.projectHandle ?? null,
  });

  const meta: MimicCopyGroupingMeta = {
    slides_reviewed: inputs.length,
    slides_applied: applied.slides_applied,
    model: llm.model,
    tokens: llm.total_tokens,
  };

  logPipelineEvent("info", "generate", "Applied mimic copy slot grouping review", {
    task_id: job.task_id,
    data: {
      slides_reviewed: meta.slides_reviewed,
      slides_applied: meta.slides_applied,
      tokens: meta.tokens,
    },
  });

  return { parsed: next, meta };
}

function slideCopyDigest(slide: Record<string, unknown>): {
  slide_index: number;
  headline: string | null;
  body: string | null;
  text_blocks: Array<{ role: string; text: string }>;
} {
  const slideIndex = Number(slide.slide_index);
  const blocks = textBlocksFromSlide(slide);
  return {
    slide_index: Number.isFinite(slideIndex) && slideIndex > 0 ? slideIndex : 0,
    headline: sanitizeMimicOverlayCopyText(slide.headline ?? slide.title) || null,
    body: sanitizeMimicOverlayCopyText(slide.body ?? slide.text) || null,
    text_blocks: blocks,
  };
}

function applySemanticRewriteToSlide(
  slide: Record<string, unknown>,
  rewrite: Record<string, unknown>
): Record<string, unknown> | null {
  const headline = sanitizeMimicOverlayCopyText(rewrite.headline);
  const body = sanitizeMimicOverlayCopyText(rewrite.body);
  const rawBlocks = Array.isArray(rewrite.text_blocks) ? rewrite.text_blocks : [];
  const text_blocks = rawBlocks
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const text = sanitizeMimicOverlayCopyText(rec.text);
      if (!text) return null;
      return {
        role: String(rec.role ?? "body").trim() || "body",
        text,
      };
    })
    .filter((b): b is { role: string; text: string } => b != null);

  if (!headline && !body && text_blocks.length === 0) return null;

  const next: Record<string, unknown> = { ...slide };
  if (headline) next.headline = headline;
  if (body) next.body = body;
  if (text_blocks.length > 0) next.text_blocks = text_blocks;
  return next;
}

export function applySemanticCoherenceLlmResultToParsed(
  parsed: Record<string, unknown>,
  llmParsed: Record<string, unknown>
): { parsed: Record<string, unknown>; slides_rewritten: number } {
  const slides = slideRows(parsed);
  if (slides.length === 0) return { parsed, slides_rewritten: 0 };

  const rewrites = Array.isArray(llmParsed.slides) ? llmParsed.slides : [];
  if (rewrites.length === 0) return { parsed, slides_rewritten: 0 };

  let slides_rewritten = 0;
  const nextSlides = slides.map((slide, i) => {
    const slideIndex = Number(slide.slide_index) || i + 1;
    const rec = rewrites.map((item) => asRecord(item)).find((r) => r && Number(r.slide_index) === slideIndex);
    if (!rec) return slide;
    const next = applySemanticRewriteToSlide(slide, rec);
    if (!next) return slide;
    slides_rewritten++;
    return next;
  });

  if (slides_rewritten === 0) return { parsed, slides_rewritten: 0 };
  return { parsed: { ...parsed, slides: nextSlides }, slides_rewritten };
}

const SEMANTIC_COHERENCE_SYSTEM = [
  "You are a carousel semantic editor for idea-faithful mimic decks.",
  "Review draft on-slide copy against semantic_contract_v1 (core_question + content_beats).",
  "Detect concept drift: generic filler, unrelated topics, or slides that no longer advance the planned idea.",
  "When coherence_score < 75, rewrite only slides that drift — preserve slide count, copy slot count, and approximate length.",
  "Return JSON only.",
].join(" ");

/**
 * Deck-level pass: validate and optionally rewrite copy against semantic_contract_v1.
 */
export async function refineMimicCarouselSemanticCoherence(
  appConfig: AppConfig,
  apiKey: string,
  db: Pool,
  job: { task_id: string; project_id: string; run_id: string },
  parsed: Record<string, unknown>,
  contract: SemanticContractV1,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: {
    scale?: number;
    charSlack?: number;
    projectHandle?: string | null;
    minScoreToRewrite?: number;
  }
): Promise<{ parsed: Record<string, unknown>; meta: MimicSemanticCoherenceMeta | null }> {
  if (!hasUsableSemanticContract(contract)) {
    return { parsed, meta: null };
  }

  const slides = slideRows(parsed);
  if (slides.length === 0) return { parsed, meta: null };

  const digest = slides.map((slide, i) => {
    const d = slideCopyDigest(slide);
    if (!d.slide_index) d.slide_index = layout[i]?.slide_index ?? i + 1;
    return d;
  });

  const userPayload = {
    semantic_contract_v1: contract,
    target_slide_count: layout.length > 0 ? layout.length : slides.length,
    project_handle: opts?.projectHandle ?? null,
    slides: digest,
  };

  const user = [
    "Score how well the draft deck executes semantic_contract_v1 (0–100).",
    "If coherence_score < 75, set rewrite=true and return corrected slides.",
    "Output JSON:",
    `{ "coherence_score": number, "rewrite": boolean, "drift_summary": string | null, "slides": [ { "slide_index": number, "headline"?: string, "body"?: string, "text_blocks"?: [ { "role": string, "text": string } ] } ] }`,
    "Only include slides you changed when rewrite=true.",
    "",
    JSON.stringify(userPayload, null, 2),
  ].join("\n");

  const llm = await openaiChat(
    apiKey,
    {
      model: appConfig.OPENAI_MODEL,
      system_prompt: SEMANTIC_COHERENCE_SYSTEM,
      user_prompt: user,
      max_tokens: openAiMaxTokens(4096),
      response_format: "json_object",
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "mimic_semantic_coherence_review",
    }
  );

  const llmParsed = parseJsonObjectFromLlmText(llm.content);
  if (!llmParsed) {
    logPipelineEvent("warn", "generate", "Mimic semantic coherence LLM returned non-JSON; keeping draft copy", {
      task_id: job.task_id,
    });
    return { parsed, meta: null };
  }

  const scoreRaw = Number(llmParsed.coherence_score);
  const coherence_score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw)) : 0;
  const minScore = opts?.minScoreToRewrite ?? 75;
  const shouldRewrite = llmParsed.rewrite === true && coherence_score < minScore;

  let next = parsed;
  let slides_rewritten = 0;
  if (shouldRewrite) {
    const applied = applySemanticCoherenceLlmResultToParsed(parsed, llmParsed);
    next = applied.parsed;
    slides_rewritten = applied.slides_rewritten;
    next = enforceMimicCopyBudgetOnParsedOutput(next, layout, {
      scale: opts?.scale,
      charSlack: opts?.charSlack,
      projectHandle: opts?.projectHandle ?? null,
    });
  }

  const drift_summary =
    typeof llmParsed.drift_summary === "string" && llmParsed.drift_summary.trim()
      ? llmParsed.drift_summary.trim()
      : null;

  const meta: MimicSemanticCoherenceMeta = {
    coherence_score,
    slides_rewritten,
    model: llm.model,
    tokens: llm.total_tokens,
    drift_summary,
  };

  logPipelineEvent("info", "generate", "Mimic semantic coherence review", {
    task_id: job.task_id,
    data: {
      coherence_score: meta.coherence_score,
      slides_rewritten: meta.slides_rewritten,
      rewrite: shouldRewrite,
      drift_summary: meta.drift_summary,
      tokens: meta.tokens,
    },
  });

  return { parsed: next, meta };
}

export type MimicCopyCoherenceMeta = MimicCopyGroupingMeta;
export const buildCoherenceSlideInputs = buildCopyGroupingSlideInputs;
