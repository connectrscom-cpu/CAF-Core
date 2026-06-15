/**
 * Post-generation LLM pass (after text_blocks[] exist): suggest coherent copy groupings
 * and rewrite per-box lines so each group reads as one message split across OCR boxes.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MimicSlideCopyLayoutForLlm } from "../domain/mimic-carousel-package.js";
import { sanitizeMimicOverlayCopyText } from "../domain/mimic-overlay-copy.js";
import { formatInstagramHandleForCta } from "../domain/instagram-handle.js";
import type { MimicCopySlotLlmField, MimicCopySlotSplit } from "./mimic-copy-slots.js";
import { MIMIC_COPY_SLOTS_SCHEMA } from "./mimic-copy-slots.js";
import {
  enforceMimicCopyBudgetOnParsedOutput,
  mimicCopyBlockBudgets,
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

export type MimicCopyGroupingGroup = {
  llm_field: MimicCopySlotLlmField;
  split: MimicCopySlotSplit;
  box_indices: number[];
  lines: string[];
};

export type MimicCopyGroupingSlide = {
  slide_index: number;
  groups: MimicCopyGroupingGroup[];
};

type GroupingBox = {
  box_index: number;
  role: string;
  max_chars: number;
  draft_text: string;
};

type GroupingSlideInput = {
  slide_index: number;
  slide_purpose: string | null;
  visual_description: string | null;
  boxes: GroupingBox[];
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
    const text = sanitizeMimicOverlayCopyText(rec.text);
    out.push({
      role: String(rec.role ?? "body").trim() || "body",
      text,
    });
  }
  return out;
}

function syncHeadlineBodyFromTextBlocks(slide: Record<string, unknown>): Record<string, unknown> {
  const blocks = textBlocksFromSlide(slide);
  if (blocks.length === 0) return slide;
  const headline = blocks
    .filter((b) => /headline|title|hook|cover|kicker/i.test(b.role))
    .map((b) => b.text)
    .filter(Boolean)
    .join(" ")
    .trim();
  const body = blocks
    .filter((b) => !/headline|title|hook|cover|kicker|handle/i.test(b.role))
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  const next: Record<string, unknown> = { ...slide, text_blocks: blocks };
  if (headline) next.headline = headline;
  if (body) next.body = body;
  return next;
}

function parseLlmField(raw: unknown): MimicCopySlotLlmField {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "headline" || v === "body" || v === "cta" || v === "handle") return v;
  if (/headline|title|hook|cover|kicker/.test(v)) return "headline";
  if (/handle|@/.test(v)) return "handle";
  if (/cta/.test(v)) return "cta";
  return "body";
}

function parseSplit(raw: unknown, boxCount: number): MimicCopySlotSplit {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "line_per_block" || v === "single_block") return v;
  return boxCount > 1 ? "line_per_block" : "single_block";
}

/** Slides with 2+ overlay boxes — grouping review applies (single-box slides skip). */
export function buildCopyGroupingSlideInputs(
  parsed: Record<string, unknown>,
  layout: MimicSlideCopyLayoutForLlm[],
  opts?: { scale?: number; charSlack?: number }
): GroupingSlideInput[] {
  const scale = parseMimicCopyReferenceScale(opts?.scale);
  const slack = parseMimicCopyCharSlack(opts?.charSlack);
  const blockBudgets = mimicCopyBlockBudgets(layout, { scale, charSlack: slack });
  const slides = slideRows(parsed);
  const out: GroupingSlideInput[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const layoutRow = layout[i] ?? layout.find((r) => r.slide_index === i + 1);
    const slideIndex = layoutRow?.slide_index ?? i + 1;
    const blocks = textBlocksFromSlide(slide);
    if (blocks.length < 2) continue;

    const budgets = blockBudgets.filter((b) => b.slide_index === slideIndex);
    const boxes: GroupingBox[] = blocks.map((b, boxIndex) => {
      const budget = budgets[boxIndex] ?? budgets[budgets.length - 1];
      return {
        box_index: boxIndex,
        role: b.role,
        max_chars: budget?.max_chars ?? 80 + slack,
        draft_text: b.text,
      };
    });

    out.push({
      slide_index: slideIndex,
      slide_purpose: layoutRow?.slide_purpose ?? null,
      visual_description: layoutRow?.visual_description ?? null,
      boxes,
    });
  }

  return out;
}

export function parseCopyGroupingLlmResult(raw: Record<string, unknown>): MimicCopyGroupingSlide[] {
  const slides = raw.slides;
  if (!Array.isArray(slides)) return [];
  const out: MimicCopyGroupingSlide[] = [];

  for (const item of slides) {
    const rec = asRecord(item);
    if (!rec) continue;
    const slideIndex = Number(rec.slide_index);
    if (!Number.isFinite(slideIndex) || slideIndex <= 0) continue;
    const groupsRaw = Array.isArray(rec.groups) ? rec.groups : [];
    const groups: MimicCopyGroupingGroup[] = [];

    for (const gItem of groupsRaw) {
      const gRec = asRecord(gItem);
      if (!gRec) continue;
      const box_indices = Array.isArray(gRec.box_indices)
        ? gRec.box_indices.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0)
        : [];
      const linesRaw = Array.isArray(gRec.lines) ? gRec.lines : [];
      const lines = linesRaw.map((line) => sanitizeMimicOverlayCopyText(line)).filter(Boolean);
      if (box_indices.length === 0 || lines.length !== box_indices.length) continue;
      groups.push({
        llm_field: parseLlmField(gRec.llm_field),
        split: parseSplit(gRec.split, box_indices.length),
        box_indices,
        lines,
      });
    }

    if (groups.length > 0) out.push({ slide_index: slideIndex, groups });
  }

  return out;
}

/** Validate groups partition box indices and apply lines to text_blocks. */
export function applyCopyGroupingToSlide(
  slide: Record<string, unknown>,
  grouping: MimicCopyGroupingSlide
): Record<string, unknown> | null {
  const blocks = textBlocksFromSlide(slide);
  const n = blocks.length;
  if (n < 2) return null;

  const seen = new Set<number>();
  const nextTexts = [...blocks.map((b) => b.text)];
  const nextRoles = [...blocks.map((b) => b.role)];
  const appliedGroups: MimicCopyGroupingGroup[] = [];

  for (const group of grouping.groups) {
    if (group.box_indices.length !== group.lines.length) continue;
    for (const idx of group.box_indices) {
      if (idx < 0 || idx >= n || seen.has(idx)) return null;
      seen.add(idx);
    }
    for (let i = 0; i < group.box_indices.length; i++) {
      const idx = group.box_indices[i]!;
      nextTexts[idx] = group.lines[i]!;
      nextRoles[idx] = group.llm_field;
    }
    appliedGroups.push(group);
  }

  if (seen.size !== n) return null;

  const text_blocks = nextTexts.map((text, i) => ({
    role: nextRoles[i]!,
    text,
  }));

  const copy_groupings_v1 = appliedGroups.map((g, groupIndex) => ({
    schema_version: "copy_groupings_v1" as const,
    group_index: groupIndex,
    llm_field: g.llm_field,
    split: g.split,
    box_indices: g.box_indices,
    lines: g.lines,
  }));

  const copy_slots_v1 = appliedGroups.map((g, slotIndex) => ({
    schema_version: MIMIC_COPY_SLOTS_SCHEMA,
    slot_index: slotIndex,
    llm_field: g.llm_field,
    split: g.split,
    block_indices: g.box_indices,
    block_texts: g.lines,
    reference_text: g.lines.join(" ").trim(),
  }));

  return syncHeadlineBodyFromTextBlocks({
    ...slide,
    text_blocks,
    copy_groupings_v1,
    copy_slots_v1,
  });
}

export function applyCopyGroupingLlmResultToParsed(
  parsed: Record<string, unknown>,
  groupings: MimicCopyGroupingSlide[]
): { parsed: Record<string, unknown>; slides_applied: number } {
  const slides = slideRows(parsed);
  if (slides.length === 0 || groupings.length === 0) return { parsed, slides_applied: 0 };

  const byIndex = new Map(groupings.map((g) => [g.slide_index, g]));
  let slides_applied = 0;
  const nextSlides = slides.map((slide, i) => {
    const slideIndex = Number(slide.slide_index) || i + 1;
    const grouping = byIndex.get(slideIndex);
    if (!grouping) return slide;
    const next = applyCopyGroupingToSlide(slide, grouping);
    if (!next) return slide;
    slides_applied++;
    return next;
  });

  if (slides_applied === 0) return { parsed, slides_applied: 0 };
  return { parsed: { ...parsed, slides: nextSlides }, slides_applied };
}

const GROUPING_SYSTEM = [
  "You are a carousel on-image copy editor reviewing OCR-aligned text boxes after draft copy was generated.",
  "Each slide has a fixed number of overlay boxes (box_index 0..N-1). You must:",
  "1) Propose coherent semantic GROUPS — which boxes belong to the same headline, body phrase, CTA, or handle.",
  "2) Rewrite copy so each group reads as one message, split naturally across its boxes (one line per box).",
  "Remove OCR garbage (math, LaTeX, random symbols). Respect max_chars per box.",
  "Every box_index must appear in exactly one group. groups[].lines.length must equal groups[].box_indices.length.",
  "When role is handle, use only the project @handle from input.",
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
    "Review draft text_blocks and return coherent groupings + rewritten lines per box.",
    "Partition every box_index into exactly one group per slide.",
    "Output JSON:",
    `{ "slides": [ { "slide_index": number, "groups": [ { "llm_field": "headline|body|cta|handle", "split": "line_per_block|single_block", "box_indices": number[], "lines": string[] } ] } ] }`,
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
      step: "mimic_copy_grouping_review",
    }
  );

  const llmParsed = parseJsonObjectFromLlmText(llm.content);
  if (!llmParsed) {
    logPipelineEvent("warn", "generate", "Mimic copy grouping LLM returned non-JSON; keeping draft copy", {
      task_id: job.task_id,
    });
    return { parsed, meta: null };
  }

  const groupings = parseCopyGroupingLlmResult(llmParsed);
  const applied = applyCopyGroupingLlmResultToParsed(parsed, groupings);
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

  logPipelineEvent("info", "generate", "Applied mimic copy grouping review", {
    task_id: job.task_id,
    data: {
      slides_reviewed: meta.slides_reviewed,
      slides_applied: meta.slides_applied,
      tokens: meta.tokens,
    },
  });

  return { parsed: next, meta };
}

/** @deprecated use MimicCopyGroupingMeta */
export type MimicCopyCoherenceMeta = MimicCopyGroupingMeta;

/** @deprecated use buildCopyGroupingSlideInputs */
export const buildCoherenceSlideInputs = buildCopyGroupingSlideInputs;

/** @deprecated use applyCopyGroupingLlmResultToParsed */
export const applyCoherenceLlmResultToParsed = (
  parsed: Record<string, unknown>,
  _layout: MimicSlideCopyLayoutForLlm[],
  llmParsed: Record<string, unknown>
) => applyCopyGroupingLlmResultToParsed(parsed, parseCopyGroupingLlmResult(llmParsed));
