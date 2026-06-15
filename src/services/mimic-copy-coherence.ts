/**
 * Post-generation LLM pass: after text_blocks[] exist, refine one coherent phrase per copy slot cluster.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { slideCopyBlocksNeedCoherence } from "../domain/mimic-ocr-garbage.js";
import { sanitizeMimicOverlayCopyText } from "../domain/mimic-overlay-copy.js";
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

export type MimicCopyCoherenceMeta = MimicCopyGroupingMeta;
export const buildCoherenceSlideInputs = buildCopyGroupingSlideInputs;
