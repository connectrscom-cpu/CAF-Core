/**
 * Persisted copy-slot groups from Document AI + Nemotron reference analysis.
 * One slot = one LLM field (headline/body/cta) that may span multiple OCR lines/bboxes.
 */
import {
  bodySlotIndexForHeadlineRemainder,
  blocksVerticallyNestedOrAdjacent,
  filterOverlayLayoutBlocks,
  isChatMockFriendSubtitle,
  isOverlayChromeReferenceText,
  isOverlayWatermarkReferenceText,
  isPreserveReferenceDecorText,
  referenceTextMatchesLlmHeadline,
  splitHeadlineWithPreservedDecorTitle,
  type OverlayLayoutBlock,
} from "./mimic-docai-overlay-layout.js";
import {
  formatInstagramHandleForCta,
  looksLikeInstagramHandleText,
} from "../domain/instagram-handle.js";
import { isLikelyOcrGarbageText } from "../domain/mimic-ocr-garbage.js";
import { sanitizeMimicOverlayCopyText, coerceMimicTextBlockRow } from "../domain/mimic-overlay-copy.js";
import { semanticBodyCopyForStacks } from "./mimic-semantic-copy-units.js";

export const MIMIC_COPY_SLOTS_SCHEMA = "copy_slots_v1" as const;

export type MimicCopySlotLlmField = "headline" | "body" | "cta" | "handle";
export type MimicCopySlotSplit = "line_per_block" | "single_block";

export type MimicReferenceCopyBlock = {
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MimicReferenceCopySlot = {
  schema_version: typeof MIMIC_COPY_SLOTS_SCHEMA;
  slot_index: number;
  llm_field: MimicCopySlotLlmField;
  split: MimicCopySlotSplit;
  /** 0-based indices into slide.text_blocks */
  block_indices: number[];
  block_texts: string[];
  reference_text: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function pickBBoxNorm(rec: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const direct = asRecord(rec.bbox_norm);
  if (direct) {
    const x = pickNum(direct.x);
    const y = pickNum(direct.y);
    const w = pickNum(direct.w);
    const h = pickNum(direct.h);
    if (x != null && y != null && w != null && h != null && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const pct = rec.bbox_pct;
  if (Array.isArray(pct) && pct.length >= 4) {
    const [x1, y1, x2, y2] = pct.map((v) => pickNum(v) ?? 0);
    const x = x1 / 100;
    const y = y1 / 100;
    const w = (x2 - x1) / 100;
    const h = (y2 - y1) / 100;
    if (w > 0 && h > 0) return { x, y, w, h };
  }
  const x = pickNum(rec.x);
  const y = pickNum(rec.y);
  const w = pickNum(rec.w);
  const h = pickNum(rec.h);
  if (x != null && y != null && w != null && h != null && w > 0 && h > 0) {
    return { x, y, w, h };
  }
  return null;
}

/** Parse slide.text_blocks into normalized copy-slot inputs (geometry required). */
export function copyBlocksFromSlideRecord(slide: Record<string, unknown>): MimicReferenceCopyBlock[] {
  const raw = slide.text_blocks;
  if (!Array.isArray(raw)) return [];
  const out: MimicReferenceCopyBlock[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = sanitizeMimicOverlayCopyText(rec.text ?? rec.content).trim();
    if (!text) continue;
    const box = pickBBoxNorm(rec);
    if (!box) continue;
    out.push({
      text,
      role: String(rec.role ?? rec.semantic_role ?? "").trim().toLowerCase() || null,
      ...box,
    });
  }
  return out;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function horizontalOverlapRatio(
  a: Pick<MimicReferenceCopyBlock, "x" | "w">,
  b: Pick<MimicReferenceCopyBlock, "x" | "w">
): number {
  const a1 = a.x;
  const a2 = a.x + a.w;
  const b1 = b.x;
  const b2 = b.x + b.w;
  const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const union = Math.max(a2, b2) - Math.min(a1, b1);
  return union > 0 ? overlap / union : 0;
}

function blocksShareColumn(
  a: Pick<MimicReferenceCopyBlock, "x" | "w">,
  b: Pick<MimicReferenceCopyBlock, "x" | "w">
): boolean {
  if (horizontalOverlapRatio(a, b) >= 0.35) return true;
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  return Math.abs(ax - bx) < 0.1;
}

export function blocksAdjacentInStack(
  a: Pick<MimicReferenceCopyBlock, "x" | "y" | "w" | "h">,
  b: Pick<MimicReferenceCopyBlock, "x" | "y" | "w" | "h">
): boolean {
  return blocksVerticallyNestedOrAdjacent(a, b);
}

function blocksAdjacentInStackStrict(
  a: Pick<MimicReferenceCopyBlock, "x" | "y" | "w" | "h">,
  b: Pick<MimicReferenceCopyBlock, "x" | "y" | "w" | "h">
): boolean {
  if (!blocksShareColumn(a, b)) return false;
  const gap = b.y - (a.y + a.h);
  return gap >= -0.015 && gap < 0.06;
}

export function isTemplateInstructionText(text: string): boolean {
  return /^how you should text\b/i.test(String(text ?? "").trim());
}

export function isChatMockTitlePairBlocks(
  upper: MimicReferenceCopyBlock,
  lower: MimicReferenceCopyBlock
): boolean {
  return (
    isTemplateInstructionText(upper.text) &&
    isChatMockFriendSubtitle(lower.text) &&
    blocksAdjacentInStackStrict(upper, lower)
  );
}

function isSubheadlineRole(role: string | null): boolean {
  return /\bsubheadline\b/i.test(role ?? "");
}

function isHeadlineRole(role: string | null): boolean {
  return /\b(headline|title|hook|cover|kicker)\b/i.test(role ?? "");
}

function isSkipCopyBlock(block: MimicReferenceCopyBlock): boolean {
  if (isLikelyOcrGarbageText(block.text)) return true;
  if (/watermark|logo|timestamp|placeholder|ui_chrome/i.test(block.role ?? "")) return true;
  if (isPreserveReferenceDecorText(block.text, block)) return true;
  if (isOverlayChromeReferenceText(block.text, block.role)) return true;
  // Keep corner brand marks — they become handle slots (project @handle at render).
  if (isMimicBrandCornerWatermark(block)) return false;
  if (isOverlayWatermarkReferenceText(block.text, block)) return true;
  return false;
}

/** OCR typos / small corner marks for reference creator brand (not primary slide copy). */
export function isMimicBrandCornerWatermark(block: Pick<MimicReferenceCopyBlock, "text" | "x" | "y" | "w" | "h">): boolean {
  const t = String(block.text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (/^(ast|str|tr)?rhology$/.test(t) || t === "astrology" || t === "asthology") return true;
  if (isOverlayWatermarkReferenceText(block.text, block)) return true;
  const area = block.w * block.h;
  if (area > 0 && area < 0.0025 && block.y < 0.1 && block.x > 0.48) return true;
  return false;
}

function copyBlockProminence(block: MimicReferenceCopyBlock): number {
  const area = Math.max(0, block.w * block.h);
  const centerY = block.y + block.h / 2;
  const centerBias = centerY >= 0.32 && centerY <= 0.78 ? 1.6 : centerY < 0.14 ? 0.35 : 1;
  const textLen = Math.max(1, block.text.trim().length);
  return area * centerBias * (textLen / 12);
}

function isTinyCornerLabel(block: MimicReferenceCopyBlock): boolean {
  return block.h < 0.022 && block.w < 0.16 && block.y < 0.09;
}

function isHeadlineGroupPair(
  upper: MimicReferenceCopyBlock,
  lower: MimicReferenceCopyBlock,
  transcript: string
): boolean {
  if (!blocksAdjacentInStack(upper, lower)) return false;
  if (isChatMockTitlePairBlocks(upper, lower)) return true;
  if (isHeadlineRole(upper.role) && isSubheadlineRole(lower.role)) return true;
  const combined = `${upper.text} ${lower.text}`.trim();
  const tr = normalizeText(transcript);
  if (tr && normalizeText(combined).length >= 8 && tr.startsWith(normalizeText(combined))) return true;
  return false;
}

function inferLlmFieldForBlock(block: MimicReferenceCopyBlock): MimicCopySlotLlmField {
  const role = block.role;
  const text = block.text;
  const r = (role ?? "").toLowerCase();
  if (isMimicBrandCornerWatermark(block)) return "handle";
  if (/handle/.test(r) || /^@[\w.]{2,}$/.test(text.trim())) return "handle";

  const prominence = copyBlockProminence(block);
  const tinyCorner = isTinyCornerLabel(block);

  if (/cta/.test(r)) {
    if (/@[\w.]{2,}/.test(text.trim())) return "cta";
    const centerY = block.y + block.h / 2;
    const area = block.w * block.h;
    // Nemotron often labels the main on-slide zodiac line as cta — promote only prominent center copy.
    if (prominence >= 0.025 || (area >= 0.02 && centerY >= 0.28 && centerY <= 0.78)) return "headline";
    return "cta";
  }
  if (/headline|title|hook|cover|kicker|subheadline/.test(r)) {
    if (tinyCorner && prominence < 0.012) return "handle";
    return "headline";
  }
  if (/body|subtitle|caption|paragraph/.test(r)) {
    if (looksLikeInstagramHandleText(text)) return "handle";
    return "body";
  }
  if (looksLikeInstagramHandleText(text)) return "handle";
  return prominence >= 0.025 ? "headline" : "body";
}

function makeSlot(
  slotIndex: number,
  llmField: MimicCopySlotLlmField,
  split: MimicCopySlotSplit,
  indices: number[],
  texts: string[]
): MimicReferenceCopySlot {
  return {
    schema_version: MIMIC_COPY_SLOTS_SCHEMA,
    slot_index: slotIndex,
    llm_field: llmField,
    split,
    block_indices: indices,
    block_texts: texts,
    reference_text: texts.join(" ").trim(),
  };
}

const PLATFORM_SUFFIX_TAIL_RE =
  /^(on\s+)?(tiktok|instagram|ig|youtube|twitter|facebook|snapchat|threads|linkedin|reels?|x)$/i;

/** Short platform tails (e.g. "on TikTok") that belong on the previous list line, not a separate slot. */
export function isOrphanPlatformSuffixTail(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (PLATFORM_SUFFIX_TAIL_RE.test(t)) return true;
  return /^on\s+[a-z][a-z0-9]*$/i.test(t) && t.length <= 20;
}

/** True when OCR lines are independent list bullets, not one sentence wrapped across short fragments. */
export function isLikelyListBulletTexts(texts: string[]): boolean {
  if (texts.length < 2) return false;
  if (isLikelyWrappedSentenceStack(texts)) return false;
  const wordCounts = texts.map((t) => t.trim().split(/\s+/).filter(Boolean).length);
  if (wordCounts.every((w) => w <= 3)) return false;
  return true;
}

function lineReadsAsIncompleteFragment(text: string): boolean {
  const t = text.trim();
  if (!t || /[.!?]$/.test(t)) return false;
  if (/\b(a|an|the|to|of|in|on|at|for|with|and|or|but|about)$/i.test(t)) return true;
  if (/\b(is|are|was|were|be|being|like)$/i.test(t)) return true;
  return false;
}

function isLikelyWrappedSentenceStack(texts: string[]): boolean {
  if (texts.length < 2) return false;
  for (let i = 0; i < texts.length - 1; i++) {
    if (lineReadsAsIncompleteFragment(texts[i]!)) return true;
  }
  const wordCounts = texts.map((t) => t.trim().split(/\s+/).filter(Boolean).length);
  return wordCounts.every((w) => w <= 3);
}

function isLikelyListBulletStack(
  stack: Array<MimicReferenceCopyBlock & { index: number }>
): boolean {
  return isLikelyListBulletTexts(stack.map((b) => b.text));
}

function stackAnchorCenter(stack: Array<MimicReferenceCopyBlock & { index: number }>): {
  x: number;
  y: number;
} {
  const b = stack[0]!;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** True when trait stacks sit in left vs right columns (quadrant memes). */
function bodyStacksAreMultiColumn(
  stacks: Array<Array<MimicReferenceCopyBlock & { index: number }>>
): boolean {
  if (stacks.length < 2) return false;
  const xs = stacks.map((s) => stackAnchorCenter(s).x);
  return Math.max(...xs) - Math.min(...xs) > 0.22;
}

function quadrantIndexForCenter(cx: number, cy: number): number {
  const top = cy < 0.42;
  const left = cx < 0.5;
  if (top && left) return 0;
  if (top && !left) return 1;
  if (!top && left) return 2;
  return 3;
}

/** Collapse over-fragmented OCR stacks into corner quadrants (one trait cluster per corner). */
function mergeBodyStacksToQuadrants(
  stacks: Array<Array<MimicReferenceCopyBlock & { index: number }>>
): Array<Array<MimicReferenceCopyBlock & { index: number }>> {
  const buckets: Array<Array<MimicReferenceCopyBlock & { index: number }>> = [[], [], [], []];
  for (const stack of stacks) {
    const { x, y } = stackAnchorCenter(stack);
    buckets[quadrantIndexForCenter(x, y)]!.push(...stack);
  }
  return buckets
    .filter((b) => b.length > 0)
    .map((b) => b.sort((a, b) => a.y - b.y || a.x - b.x));
}

function expandListBodySlots(slots: MimicReferenceCopySlot[]): MimicReferenceCopySlot[] {
  const bodyCount = slots.filter((s) => s.llm_field === "body").length;
  if (bodyCount >= 3) return slots;
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const out: MimicReferenceCopySlot[] = [];
  for (const slot of sorted) {
    if (
      slot.llm_field === "body" &&
      slot.block_texts.length >= 2 &&
      slot.split === "single_block" &&
      isLikelyListBulletTexts(slot.block_texts)
    ) {
      for (let li = 0; li < slot.block_texts.length; li++) {
        out.push(
          makeSlot(
            out.length,
            "body",
            "single_block",
            [slot.block_indices[li] ?? slot.block_indices[0]!],
            [slot.block_texts[li]!]
          )
        );
      }
      continue;
    }
    out.push(slot);
  }
  return out.map((s, i) => ({ ...s, slot_index: i }));
}

function slotLooksLikeHandleOnly(slot: MimicReferenceCopySlot): boolean {
  const texts = slot.block_texts.map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0) return looksLikeInstagramHandleText(slot.reference_text);
  return texts.every((t) => looksLikeInstagramHandleText(t));
}

/** Body/CTA slots mis-tagged when OCR captured @handle as copy — isolate for safe corner render. */
function reassignMisclassifiedHandleSlots(slots: MimicReferenceCopySlot[]): MimicReferenceCopySlot[] {
  const hasHandle = slots.some((s) => s.llm_field === "handle");
  const out: MimicReferenceCopySlot[] = [];
  for (const slot of slots) {
    if (slot.llm_field !== "body" && slot.llm_field !== "cta") {
      out.push(slot);
      continue;
    }
    if (!slotLooksLikeHandleOnly(slot)) {
      out.push(slot);
      continue;
    }
    if (hasHandle && slot.llm_field === "body") {
      continue;
    }
    out.push({ ...slot, llm_field: "handle" });
  }
  return out.map((s, i) => ({ ...s, slot_index: i }));
}

/** Collapse runaway body slot counts (fragment-per-line) while preserving short list bullets. */
function mergeExcessBodySlots(slots: MimicReferenceCopySlot[]): MimicReferenceCopySlot[] {
  const bodySlots = slots.filter((s) => s.llm_field === "body");
  if (bodySlots.length <= 4) return slots;

  const bulletTexts = bodySlots.map((s) => s.reference_text);
  if (
    bodySlots.length <= 6 &&
    bodySlots.every((s) => s.block_texts.length === 1) &&
    isLikelyListBulletTexts(bulletTexts)
  ) {
    return slots;
  }

  const nonBody = slots.filter((s) => s.llm_field !== "body");
  const sortedBody = [...bodySlots].sort((a, b) => a.slot_index - b.slot_index);
  const targetCount = 4;
  const perGroup = Math.ceil(sortedBody.length / targetCount);
  const mergedBody: MimicReferenceCopySlot[] = [];

  for (let i = 0; i < sortedBody.length; i += perGroup) {
    const group = sortedBody.slice(i, i + perGroup);
    if (group.length === 1) {
      mergedBody.push(group[0]!);
      continue;
    }
    mergedBody.push(
      makeSlot(
        mergedBody.length,
        "body",
        "single_block",
        group.flatMap((s) => s.block_indices),
        group.flatMap((s) => s.block_texts)
      )
    );
  }

  return [...nonBody, ...mergedBody]
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((s, idx) => ({ ...s, slot_index: idx }));
}

function mergeOrphanSuffixTailIntoPrecedingBodySlot(
  slots: MimicReferenceCopySlot[]
): MimicReferenceCopySlot[] {
  if (slots.length < 2) return slots;
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const out: MimicReferenceCopySlot[] = [];
  let i = 0;
  while (i < sorted.length) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (
      next &&
      cur.llm_field === "body" &&
      (next.llm_field === "cta" || next.llm_field === "body") &&
      next.block_texts.length <= 1 &&
      isOrphanPlatformSuffixTail(next.block_texts[0] ?? next.reference_text)
    ) {
      const mergedTexts = [...cur.block_texts];
      const suffix = (next.block_texts[0] ?? next.reference_text).trim();
      if (mergedTexts.length > 0) {
        mergedTexts[mergedTexts.length - 1] = `${mergedTexts[mergedTexts.length - 1]!} ${suffix}`.trim();
      } else {
        mergedTexts.push(suffix);
      }
      out.push({
        ...cur,
        block_indices: [...cur.block_indices, ...next.block_indices],
        block_texts: mergedTexts,
        reference_text: mergedTexts.join(" ").trim(),
      });
      i += 2;
      continue;
    }
    out.push(cur);
    i++;
  }
  return out.map((s, idx) => ({ ...s, slot_index: idx }));
}

/** Post-process inferred or persisted slots (list bullets + platform tail orphans). */
export function normalizeInferredCopySlots(slots: MimicReferenceCopySlot[]): MimicReferenceCopySlot[] {
  if (slots.length === 0) return slots;
  const reassigned = reassignMisclassifiedHandleSlots(slots);
  const expanded = expandListBodySlots(reassigned);
  const mergedTail = mergeOrphanSuffixTailIntoPrecedingBodySlot(expanded);
  return mergeExcessBodySlots(mergedTail);
}

function groupBlocksIntoVerticalStacks(
  blocks: Array<MimicReferenceCopyBlock & { index: number }>
): Array<Array<MimicReferenceCopyBlock & { index: number }>> {
  const columns: Array<Array<MimicReferenceCopyBlock & { index: number }>> = [];
  for (const block of blocks) {
    let placed = false;
    for (const column of columns) {
      if (blocksShareColumn(block, column[0]!)) {
        column.push(block);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([block]);
  }

  const stacks: Array<Array<MimicReferenceCopyBlock & { index: number }>> = [];
  for (const column of columns) {
    column.sort((a, b) => a.y - b.y || a.x - b.x);
    let current: Array<MimicReferenceCopyBlock & { index: number }> = [];
    for (const block of column) {
      if (current.length === 0) {
        current.push(block);
        continue;
      }
      const prev = current[current.length - 1]!;
      if (blocksAdjacentInStack(prev, block)) {
        current.push(block);
      } else {
        stacks.push(current);
        current = [block];
      }
    }
    if (current.length > 0) stacks.push(current);
  }
  return stacks;
}

function sortStacksForReadingOrder(
  stacks: Array<Array<MimicReferenceCopyBlock & { index: number }>>
): Array<Array<MimicReferenceCopyBlock & { index: number }>> {
  return [...stacks].sort((a, b) => {
    const ay = Math.min(...a.map((x) => x.y));
    const by = Math.min(...b.map((x) => x.y));
    if (Math.abs(ay - by) > 0.035) return ay - by;
    const ax = Math.min(...a.map((x) => x.x));
    const bx = Math.min(...b.map((x) => x.x));
    return ax - bx;
  });
}

/** Slim copy-slot rows for LLM prompts (no geometry — placement is fixed at render). */
export function serializeCopySlotsForLlmPrompt(
  slots: MimicReferenceCopySlot[] | null | undefined
): Array<{
  slot_index: number;
  llm_field: MimicCopySlotLlmField;
  split: MimicCopySlotSplit;
  reference_text: string;
  reference_chars: number;
  reference_chars_per_line: number[];
  line_count: number;
}> | null {
  if (!slots?.length) return null;
  return slots.map((s) => {
    const blockTexts = s.block_texts.map((t) => t.trim()).filter(Boolean);
    const reference_chars_per_line = blockTexts.map((t) => t.length);
    return {
      slot_index: s.slot_index,
      llm_field: s.llm_field,
      split: s.split,
      reference_text: s.reference_text,
      reference_chars: reference_chars_per_line.reduce((sum, n) => sum + n, 0) || s.reference_text.length,
      reference_chars_per_line,
      line_count: Math.max(1, blockTexts.length),
    };
  });
}

/** Target LLM slide shape: one `text_blocks[]` entry per copy slot (not per OCR line). */
export function llmSlideFromCopySlots(slots: MimicReferenceCopySlot[]): Record<string, unknown> {
  if (slots.length === 0) return { headline: "Sample headline", body: "Sample body copy for overlay lab." };
  const headlineSlots = slots.filter((s) => s.llm_field === "headline");
  const headline = headlineSlots.map((s) => s.reference_text).join(" ").trim() || null;
  const text_blocks = slots.map((s) => ({
    role: s.llm_field,
    text: s.reference_text,
  }));
  const bodyJoined = slots
    .filter((s) => s.llm_field === "body" || s.llm_field === "cta")
    .map((s) => s.reference_text)
    .filter(Boolean)
    .join("\n");
  if (headline) {
    return { headline, ...(bodyJoined ? { body: bodyJoined } : {}), text_blocks };
  }
  return { ...(bodyJoined ? { body: bodyJoined } : {}), text_blocks };
}

function slotRoleCompatible(blockRole: string, slotField: MimicCopySlotLlmField): boolean {
  const r = blockRole.toLowerCase();
  if (slotField === "handle") return /handle/.test(r);
  if (slotField === "headline") return /headline|title|hook|cover|kicker|subheadline/.test(r);
  if (slotField === "cta") return /cta/.test(r);
  if (slotField === "body") return /body|subtitle|caption|paragraph|cta|other/.test(r) || !r;
  return true;
}

export type ExtractLlmCopyPerSlotOpts = {
  referenceHandles?: string[];
  projectHandle?: string | null;
};

export function ocrBlockCountForCopySlots(slots: MimicReferenceCopySlot[]): number {
  return slots.reduce((n, slot) => n + Math.max(1, slot.block_texts.map((t) => t.trim()).filter(Boolean).length), 0);
}

/**
 * Pull one text value per copy slot from heterogeneous LLM slide JSON.
 * Prefers slot-aligned `text_blocks[]`; falls back to headline/body fields.
 */
export function extractLlmTextPerCopySlot(
  slide: Record<string, unknown>,
  slots: MimicReferenceCopySlot[],
  opts?: ExtractLlmCopyPerSlotOpts
): Map<number, string> {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  const out = new Map<number, string>();
  if (sorted.length === 0) return out;

  const refHandles = opts?.referenceHandles ?? [];
  const scrub = (raw: unknown): string => sanitizeMimicOverlayCopyText(raw).replace(/\n/g, " ").trim();

  const tb = Array.isArray(slide.text_blocks) ? slide.text_blocks : [];
  const tbRows = tb
    .map((item) => coerceMimicTextBlockRow(item))
    .filter((r): r is NonNullable<ReturnType<typeof coerceMimicTextBlockRow>> => Boolean(r))
    .map((row) => ({
      role: row.role,
      text: scrub(row.text),
    }))
    .filter((r) => r.text);

  if (tbRows.length === sorted.length) {
    let positionAligned = true;
    for (let i = 0; i < sorted.length; i++) {
      const slot = sorted[i]!;
      const row = tbRows[i]!;
      if (slot.llm_field === "handle") {
        if (!looksLikeInstagramHandleText(row.text)) positionAligned = false;
      } else if (looksLikeInstagramHandleText(row.text)) {
        positionAligned = false;
      }
    }
    if (positionAligned) {
      for (let i = 0; i < sorted.length; i++) {
        out.set(sorted[i]!.slot_index, tbRows[i]!.text);
      }
      return out;
    }
  }

  if (tbRows.length === sorted.length && tbRows.every((r, i) => slotRoleCompatible(r.role, sorted[i]!.llm_field))) {
    for (let i = 0; i < sorted.length; i++) {
      out.set(sorted[i]!.slot_index, tbRows[i]!.text);
    }
    return out;
  }

  const expectedOcrBlocks = ocrBlockCountForCopySlots(sorted);
  if (tbRows.length === expectedOcrBlocks && expectedOcrBlocks > sorted.length) {
    let rowIdx = 0;
    for (const slot of sorted) {
      const blockCount = Math.max(1, slot.block_texts.map((t) => t.trim()).filter(Boolean).length);
      const rows = tbRows.slice(rowIdx, rowIdx + blockCount);
      if (!rows.every((r) => slotRoleCompatible(r.role, slot.llm_field))) break;
      rowIdx += blockCount;
      const joined = rows.map((r) => r.text).join(" ").trim();
      out.set(slot.slot_index, joined);
    }
    if (rowIdx === expectedOcrBlocks && out.size === sorted.length) return out;
    out.clear();
  }

  let headline = scrub(slide.headline ?? slide.title);
  const headlineQueue = tbRows.filter((r) => /headline|title|hook|cover|kicker|subheadline/.test(r.role)).map((r) => r.text);
  const bodyQueue = tbRows
    .filter((r) => !/headline|title|hook|cover|kicker|subheadline|handle/.test(r.role))
    .filter((r) => !looksLikeInstagramHandleText(r.text))
    .map((r) => r.text);
  const bodyField = scrub(slide.body ?? slide.subtitle);
  if (bodyField) {
    const parts = bodyField.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (parts.length > 1) bodyQueue.push(...parts);
    else bodyQueue.push(bodyField);
  }

  for (const slot of sorted) {
    if (slot.llm_field === "handle") {
      out.set(slot.slot_index, "");
      continue;
    }
    if (slot.llm_field === "headline") {
      const h = headline || headlineQueue.shift() || "";
      out.set(slot.slot_index, h);
      if (h === headline) headline = "";
      continue;
    }
    const pick = bodyQueue.shift() ?? "";
    out.set(slot.slot_index, pick);
  }

  return out;
}

export type NormalizeLlmSlideToCopySlotsOpts = ExtractLlmCopyPerSlotOpts & {
  applyMaxChars?: (slotIndex: number, llmField: MimicCopySlotLlmField, text: string) => string;
  /** Cap each expanded OCR line (never shortens below model output unless over max). */
  clampOcrLine?: (text: string, referenceChars: number) => string;
};

/**
 * Normalize LLM slide output to one `text_blocks[]` row per copy slot (semantic cluster).
 * Multi-OCR slots keep one combined phrase; render splits across boxes via copy_slots_v1.
 */
export function normalizeLlmSlideToCopySlots(
  slide: Record<string, unknown>,
  slots: MimicReferenceCopySlot[],
  opts?: NormalizeLlmSlideToCopySlotsOpts
): Record<string, unknown> {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  if (sorted.length === 0) return slide;

  const perSlot = extractLlmTextPerCopySlot(slide, sorted, opts);
  const text_blocks: Array<{ role: string; text: string }> = [];
  let headline = "";

  for (const slot of sorted) {
    let text = perSlot.get(slot.slot_index) ?? "";
    if (slot.llm_field === "handle") {
      text = opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : "";
    } else if (opts?.applyMaxChars) {
      text = opts.applyMaxChars(slot.slot_index, slot.llm_field, text);
    }
    text = sanitizeMimicOverlayCopyText(text);
    if (slot.llm_field === "headline" && text) {
      headline = headline ? `${headline} ${text}`.trim() : text;
    }
    text_blocks.push({ role: slot.llm_field, text });
  }

  const bodyJoined = text_blocks
    .filter((b) => b.role === "body" || b.role === "cta")
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n");

  const next: Record<string, unknown> = { ...slide, text_blocks };
  if (headline) next.headline = headline;
  if (bodyJoined) next.body = bodyJoined;
  return next;
}

/**
 * Infer copy slots with one LLM slot per OCR box (preferred for multi-box mimic slides).
 * Preserves chat-mock headline pairs as line_per_block slots.
 */
export function inferMimicReferenceCopySlotsOnePerBlock(
  blocks: MimicReferenceCopyBlock[],
  transcript?: string | null
): MimicReferenceCopySlot[] {
  if (blocks.length === 0) return [];

  type Indexed = MimicReferenceCopyBlock & { index: number };
  const indexed: Indexed[] = blocks
    .map((b, index) => ({ ...b, index }))
    .filter((b) => !isSkipCopyBlock(b));

  const tr = String(transcript ?? "").trim();
  const slots: MimicReferenceCopySlot[] = [];
  let slotIndex = 0;
  const consumed = new Set<number>();

  const sorted = [...indexed].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (consumed.has(cur.index)) continue;
    const next = sorted[i + 1];
    if (next && !consumed.has(next.index) && isHeadlineGroupPair(cur, next, tr)) {
      slots.push(
        makeSlot(slotIndex++, "headline", "line_per_block", [cur.index, next.index], [cur.text, next.text])
      );
      consumed.add(cur.index);
      consumed.add(next.index);
      i++;
    }
  }

  const rest = indexed
    .filter((b) => !consumed.has(b.index))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of rest) {
    slots.push(makeSlot(slotIndex++, inferLlmFieldForBlock(b), "single_block", [b.index], [b.text]));
  }

  return slots;
}

/**
 * Infer copy slots from merged Document AI text_blocks + Nemotron roles/transcript.
 * Each vertical stack (corner / column cluster) = one LLM copy unit; multi-line stacks split at render.
 */
export function inferMimicReferenceCopySlots(
  blocks: MimicReferenceCopyBlock[],
  transcript?: string | null
): MimicReferenceCopySlot[] {
  if (blocks.length === 0) return [];

  type Indexed = MimicReferenceCopyBlock & { index: number };
  const indexed: Indexed[] = blocks
    .map((b, index) => ({ ...b, index }))
    .filter((b) => !isSkipCopyBlock(b));

  const tr = String(transcript ?? "").trim();
  const slots: MimicReferenceCopySlot[] = [];
  let slotIndex = 0;
  const consumed = new Set<number>();

  const sorted = [...indexed].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (consumed.has(cur.index)) continue;
    const next = sorted[i + 1];
    if (next && !consumed.has(next.index) && isHeadlineGroupPair(cur, next, tr)) {
      slots.push(
        makeSlot(slotIndex++, "headline", "line_per_block", [cur.index, next.index], [cur.text, next.text])
      );
      consumed.add(cur.index);
      consumed.add(next.index);
      i++;
    }
  }

  const headlines: Indexed[] = [];
  const body: Indexed[] = [];
  const tails: Indexed[] = [];

  for (const b of indexed) {
    if (consumed.has(b.index)) continue;
    const field = inferLlmFieldForBlock(b);
    if (field === "handle" || field === "cta") {
      tails.push(b);
    } else if (field === "headline" || isHeadlineRole(b.role)) {
      headlines.push(b);
    } else {
      body.push(b);
    }
  }

  headlines.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const h of headlines) {
    slots.push(makeSlot(slotIndex++, "headline", "single_block", [h.index], [h.text]));
  }

  const bodyStacks = sortStacksForReadingOrder(groupBlocksIntoVerticalStacks(body));
  const multiColumnLayout = bodyStacksAreMultiColumn(bodyStacks);
  let stacksForSlots = bodyStacks;
  if (multiColumnLayout && (bodyStacks.length > 6 || body.length > 6)) {
    stacksForSlots = mergeBodyStacksToQuadrants(bodyStacks);
  }
  const multiColumn = bodyStacksAreMultiColumn(stacksForSlots);
  for (const stack of stacksForSlots) {
    if (stack.length >= 2 && isLikelyListBulletStack(stack) && !multiColumn) {
      for (const block of stack) {
        slots.push(makeSlot(slotIndex++, "body", "single_block", [block.index], [block.text]));
      }
    } else if (stack.length >= 2) {
      slots.push(
        makeSlot(
          slotIndex++,
          "body",
          "single_block",
          stack.map((b) => b.index),
          stack.map((b) => b.text)
        )
      );
    } else if (stack.length === 1) {
      slots.push(makeSlot(slotIndex++, "body", "single_block", [stack[0]!.index], [stack[0]!.text]));
    }
  }

  tails.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of tails) {
    slots.push(
      makeSlot(slotIndex++, inferLlmFieldForBlock(t), "single_block", [t.index], [t.text])
    );
  }

  return normalizeInferredCopySlots(slots);
}

/** True when reference slots include body or CTA — not headline+handle-only decks (e.g. zodiac crush). */
export function copySlotsIncludeBodyField(slots: MimicReferenceCopySlot[]): boolean {
  return slots.some((s) => s.llm_field === "body" || s.llm_field === "cta");
}

/** Prefer copy-slot / stack mapping over 1:1 text_blocks→OCR direct index when clusters diverge. */
export function copySlotsShouldDriveMapping(
  slots: MimicReferenceCopySlot[],
  directLineCount: number
): boolean {
  if (slots.length === 0) return false;
  if (!copySlotsIncludeBodyField(slots)) return true;
  const bodySlots = slots.filter((s) => s.llm_field === "body").length;
  if (bodySlots >= 2) return true;
  if (bodySlots >= 1 && directLineCount >= 2) return true;
  if (directLineCount > 0 && slots.length >= directLineCount) return true;
  return false;
}

function splitMergedBodyAcrossBodySlots(out: string[], sorted: MimicReferenceCopySlot[]): void {
  const bodySlotIdxs = sorted
    .map((s, idx) => (s.llm_field === "body" ? idx : -1))
    .filter((idx) => idx >= 0);
  if (bodySlotIdxs.length < 2) return;
  const mergedBody = bodySlotIdxs
    .map((i) => out[i]?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!mergedBody) return;
  const splits = semanticBodyCopyForStacks([mergedBody], bodySlotIdxs.length);
  bodySlotIdxs.forEach((slotIdx, i) => {
    out[slotIdx] = splits[i]?.trim() ?? "";
  });
}

export function parseCopySlotsFromSlide(slide: Record<string, unknown> | null | undefined): MimicReferenceCopySlot[] {
  if (!slide) return [];
  const raw = slide.copy_slots_v1;
  if (!Array.isArray(raw)) return [];
  const out: MimicReferenceCopySlot[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const block_indices = Array.isArray(rec.block_indices)
      ? rec.block_indices.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0)
      : [];
    const block_texts = Array.isArray(rec.block_texts)
      ? rec.block_texts.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [];
    const llmField = String(rec.llm_field ?? "").trim().toLowerCase();
    if (!["headline", "body", "cta", "handle"].includes(llmField)) continue;
    if (block_indices.length === 0 && block_texts.length === 0) continue;
    out.push({
      schema_version: MIMIC_COPY_SLOTS_SCHEMA,
      slot_index: Number(rec.slot_index) || out.length,
      llm_field: llmField as MimicCopySlotLlmField,
      split: rec.split === "line_per_block" ? "line_per_block" : "single_block",
      block_indices,
      block_texts,
      reference_text: String(rec.reference_text ?? block_texts.join(" ")).trim(),
    });
  }
  return out.sort((a, b) => a.slot_index - b.slot_index);
}

/** Attach or refresh copy_slots_v1 on a merged insight slide record. */
export function attachCopySlotsToSlideRecord(slide: Record<string, unknown>): Record<string, unknown> {
  const blocks = copyBlocksFromSlideRecord(slide);
  if (blocks.length === 0) return slide;
  const transcript = String(slide.on_screen_text_transcript ?? "").trim();
  const slots = inferMimicReferenceCopySlots(blocks, transcript);
  if (slots.length === 0) return slide;
  return { ...slide, copy_slots_v1: slots };
}

export function copySlotsForSlideRecord(slide: Record<string, unknown> | null | undefined): MimicReferenceCopySlot[] {
  if (!slide) return [];
  const blocks = copyBlocksFromSlideRecord(slide);
  const transcript = String(slide.on_screen_text_transcript ?? "").trim();
  const inferred =
    blocks.length > 0 ? inferMimicReferenceCopySlots(blocks, transcript) : [];
  const persisted = parseCopySlotsFromSlide(slide);
  if (persisted.length === 0) return inferred;

  const editablePersisted = persisted.filter((s) => s.llm_field !== "handle").length;
  const editableInferred = inferred.filter((s) => s.llm_field !== "handle").length;
  if (editableInferred >= 2 && editablePersisted > Math.max(6, editableInferred + 2)) {
    return inferred;
  }
  return normalizeInferredCopySlots(persisted);
}

/** Collapse per-OCR text_blocks rows into one string per copy slot cluster. */
export function collapseTextBlocksToCopySlots(
  blocks: Array<{ role: string; text: string }>,
  slots: MimicReferenceCopySlot[]
): string[] {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  if (sorted.length === 0) return [];

  if (blocks.length === sorted.length) {
    return blocks.map((b) => b.text.trim());
  }

  const out: string[] = [];
  let bi = 0;
  for (const slot of sorted) {
    const n = Math.max(1, slot.block_texts.map((t) => t.trim()).filter(Boolean).length);
    const slice = blocks.slice(bi, bi + n);
    bi += n;
    if (slice.length === 0) {
      out.push("");
      continue;
    }
    const joiner = slot.split === "line_per_block" ? " " : " ";
    out.push(slice.map((b) => b.text.trim()).filter(Boolean).join(joiner).trim());
  }

  if (bi < blocks.length && out.length > 0) {
    const bodySlotIdxs = sorted
      .map((s, idx) => (s.llm_field === "body" ? idx : -1))
      .filter((idx) => idx >= 0);
    const tail = blocks
      .slice(bi)
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join(" ");
    if (bodySlotIdxs.length >= 2) {
      const firstBodyIdx = bodySlotIdxs[0]!;
      out[firstBodyIdx] = `${out[firstBodyIdx] ?? ""} ${tail}`.trim();
    } else {
      out[out.length - 1] = `${out[out.length - 1]!} ${tail}`.trim();
    }
  }

  splitMergedBodyAcrossBodySlots(out, sorted);

  while (out.length < sorted.length) out.push("");
  return out.slice(0, sorted.length);
}

function llmLineLongerThanRefBlocks(line: string, refTexts: string[]): boolean {
  const refLen = refTexts.join(" ").replace(/\s+/g, " ").trim().length;
  return line.trim().length > Math.max(refLen, 6) * 1.15;
}

/** Split one LLM phrase across multiple OCR reference lines (char-rhythm aware). */
export function splitLineForRefBlocks(line: string, refTexts: string[]): string[] {
  if (llmLineLongerThanRefBlocks(line, refTexts)) {
    return splitLineEvenlyAcrossBlocks(line, refTexts.length);
  }
  return splitLineAcrossRefBlocks(line, refTexts);
}

/** Split hook/body copy evenly by words when OCR reference line lengths would shred meaning. */
export function splitLineEvenlyAcrossBlocks(line: string, blockCount: number): string[] {
  const words = String(line ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (blockCount <= 1) return [words.join(" ")];
  if (words.length === 0) return Array.from({ length: blockCount }, () => "");
  const out: string[] = [];
  const per = Math.ceil(words.length / blockCount);
  for (let i = 0; i < blockCount; i++) {
    out.push(words.slice(i * per, (i + 1) * per).join(" "));
  }
  while (out.length < blockCount) out.push("");
  return out.slice(0, blockCount);
}

/** Split one LLM body/headline line across multiple OCR line boxes (mirrors reference char rhythm). */
export function splitLineAcrossRefBlocks(line: string, refTexts: string[]): string[] {
  const words = String(line ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return refTexts.map(() => "");
  if (refTexts.length <= 1) return [words.join(" ")];

  const maxLens = refTexts.map((t) => Math.max(1, t.trim().length));
  const out: string[] = [];
  let wi = 0;

  for (let bi = 0; bi < refTexts.length; bi++) {
    if (wi >= words.length) {
      out.push("");
      continue;
    }
    if (bi === refTexts.length - 1) {
      out.push(words.slice(wi).join(" "));
      break;
    }
    const target = Math.ceil(maxLens[bi]! * 1.12);
    let len = 0;
    const start = wi;
    while (wi < words.length) {
      const add = (len > 0 ? 1 : 0) + words[wi]!.length;
      if (len > 0 && len + add > target && wi > start) break;
      len += add;
      wi++;
    }
    if (wi === start) wi++;
    out.push(words.slice(start, wi).join(" "));
  }

  while (out.length < refTexts.length) out.push("");
  return out.slice(0, refTexts.length);
}

function slotContainsRefText(slot: MimicReferenceCopySlot, refText: string): boolean {
  const t = refText.trim().toLowerCase();
  if (!t) return false;
  if (slot.block_texts.some((b) => b.trim().toLowerCase() === t)) return true;
  if (normalizeText(slot.reference_text).includes(t)) return true;
  return false;
}

/** Split one LLM headline across a two-line chat-mock title (mirrors reference sentence rhythm). */
export function splitHeadlineForChatMockTitlePair(
  headline: string,
  upperRef: { ref_text: string },
  lowerRef: { ref_text: string }
): { upper: string; lower: string } {
  const h = String(headline ?? "").trim();
  if (!h) return { upper: "", lower: "" };

  const upperMax = Math.max(1, upperRef.ref_text.trim().length);
  const lowerMax = Math.max(1, lowerRef.ref_text.trim().length);
  const lowerRefText = lowerRef.ref_text.trim();
  const wantsFriendSuffix = /\bfriend$/i.test(lowerRefText);

  const textingMatch = h.match(/^(Texting\s+(?:a|an|your)\s+)(.+)$/i);
  if (textingMatch) {
    const upper = textingMatch[1]!.trim();
    let signPart = textingMatch[2]!.trim();
    if (wantsFriendSuffix && !/\bfriend$/i.test(signPart)) {
      signPart = `${signPart} friend`.trim();
    }
    if (upper.length <= Math.ceil(upperMax * 1.2) && signPart.length <= Math.ceil(lowerMax * 1.25)) {
      return { upper, lower: signPart };
    }
  }

  const words = h.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    let upperLen = 0;
    let splitAt = words.length;
    for (let i = 0; i < words.length; i++) {
      const nextLen = upperLen + (upperLen > 0 ? 1 : 0) + words[i]!.length;
      if (nextLen <= Math.ceil(upperMax * 1.15) || i === 0) {
        upperLen = nextLen;
      } else {
        splitAt = i;
        break;
      }
    }
    if (splitAt >= words.length) splitAt = Math.max(1, words.length - 1);
    let lower = words.slice(splitAt).join(" ");
    if (wantsFriendSuffix && lower && !/\bfriend$/i.test(lower)) {
      lower = `${lower} friend`.trim();
    }
    return { upper: words.slice(0, splitAt).join(" "), lower };
  }

  return { upper: h, lower: "" };
}

function findCopySlotForRefText(refText: string, slots: MimicReferenceCopySlot[]): MimicReferenceCopySlot | null {
  for (const slot of slots) {
    if (slotContainsRefText(slot, refText)) return slot;
  }
  return null;
}

function remainingBodySlotCount(slots: MimicReferenceCopySlot[], fromIndex: number): number {
  return slots.filter((s, i) => i >= fromIndex && s.llm_field === "body").length;
}

function totalBlocksInRemainingBodySlots(slots: MimicReferenceCopySlot[], fromIndex: number): number {
  let n = 0;
  for (let i = fromIndex; i < slots.length; i++) {
    if (slots[i]!.llm_field === "body") n += slots[i]!.block_texts.length;
  }
  return n;
}

export type LlmCopyLines = {
  headline: string | null;
  bodyLines: string[];
};

export type AssignLlmCopyUsingCopySlotsOpts = {
  transcript?: string | null;
};

/**
 * Map LLM copy onto layout blocks using persisted copy_slots_v1 (preferred) or caller fallback.
 */
export function assignLlmCopyUsingCopySlots(
  orderedRef: Array<Pick<OverlayLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">>,
  copySlots: MimicReferenceCopySlot[],
  llmLines: LlmCopyLines,
  directLines: string[],
  opts?: AssignLlmCopyUsingCopySlotsOpts
): string[] {
  let headline = (llmLines.headline ?? directLines[0] ?? "").trim();
  let bodyLines = [...llmLines.bodyLines];
  const transcript = String(opts?.transcript ?? "").trim();

  const decorTitleSplit = splitHeadlineWithPreservedDecorTitle(headline, orderedRef);
  let headlineRemainder: string | null = null;
  let remainderBodySlotIndex: number | null = null;
  let remainderConsumed = false;
  if (decorTitleSplit) {
    headline = decorTitleSplit.decorTitle;
    headlineRemainder = decorTitleSplit.remainder || null;
    if (headlineRemainder) {
      remainderBodySlotIndex = bodySlotIndexForHeadlineRemainder(
        copySlots,
        transcript,
        headlineRemainder,
        orderedRef
      );
    }
  }

  let bodyIdx = 0;
  const out = new Array<string>(orderedRef.length).fill("");
  const slotPartsAssigned = new Map<number, number>();
  let headlineMatched = false;

  for (let i = 0; i < orderedRef.length; i++) {
    const ref = orderedRef[i]!;
    if (isPreserveReferenceDecorText(ref.ref_text, ref)) {
      out[i] = ref.ref_text.trim();
      continue;
    }
    if (headline && referenceTextMatchesLlmHeadline(ref.ref_text, headline, ref) && !headlineMatched) {
      out[i] = headline;
      headlineMatched = true;
      continue;
    }
    const slot = findCopySlotForRefText(ref.ref_text, copySlots);
    if (!slot) {
      out[i] = bodyLines[bodyIdx++] ?? "";
      continue;
    }

    const partsDone = slotPartsAssigned.get(slot.slot_index) ?? 0;
    if (partsDone > 0 && slot.split === "single_block") continue;
    if (partsDone > 0 && slot.split === "line_per_block" && slot.llm_field !== "headline") continue;

    if (slot.llm_field === "headline") {
      if (slot.split === "line_per_block" && partsDone === 0) {
        const nextRef = orderedRef[i + 1];
        const lowerRef =
          nextRef && slotContainsRefText(slot, nextRef.ref_text) ? nextRef : null;
        if (lowerRef) {
          const split = splitHeadlineForChatMockTitlePair(
            headline,
            { ref_text: ref.ref_text },
            { ref_text: lowerRef.ref_text }
          );
          out[i] = split.upper;
          out[i + 1] = split.lower;
          slotPartsAssigned.set(slot.slot_index, 2);
          i++;
          continue;
        }
      }
      if (partsDone === 0) {
        out[i] = headline;
        slotPartsAssigned.set(slot.slot_index, 1);
      }
      continue;
    }

    if (slot.llm_field === "body") {
      if (partsDone === 0) {
        const slotIdx = copySlots.indexOf(slot);
        const blockCount = slot.block_texts.length;
        const linesRemaining = bodyLines.length - bodyIdx;
        const blocksRemaining = totalBlocksInRemainingBodySlots(copySlots, slotIdx);
        const bodySlotsLeft = remainingBodySlotCount(copySlots, slotIdx);
        const bodySlotCount = copySlots.filter((s) => s.llm_field === "body").length;
        const oneLinePerBox =
          linesRemaining >= blocksRemaining ||
          (bodySlotCount >= 2 && bodyLines.length >= bodySlotCount);

        if (
          headlineRemainder &&
          !remainderConsumed &&
          remainderBodySlotIndex != null &&
          slot.slot_index === remainderBodySlotIndex
        ) {
          if (slot.split === "line_per_block" && blockCount >= 2) {
            const splits = splitLineEvenlyAcrossBlocks(headlineRemainder, blockCount);
            let si = 0;
            for (let j = i; j < orderedRef.length && si < splits.length; j++) {
              if (slotContainsRefText(slot, orderedRef[j]!.ref_text)) {
                out[j] = splits[si++] ?? "";
              }
            }
          } else {
            out[i] = headlineRemainder;
          }
          remainderConsumed = true;
          slotPartsAssigned.set(slot.slot_index, blockCount);
          while (
            i + 1 < orderedRef.length &&
            slotContainsRefText(slot, orderedRef[i + 1]!.ref_text)
          ) {
            i++;
          }
          continue;
        }

        if (slot.split === "line_per_block" && blockCount >= 2) {
          if (oneLinePerBox) {
            let bi = 0;
            for (let j = i; j < orderedRef.length && bi < blockCount; j++) {
              if (slotContainsRefText(slot, orderedRef[j]!.ref_text)) {
                out[j] = bodyLines[bodyIdx++] ?? "";
                bi++;
              }
            }
          } else {
            const bodyLine =
              bodySlotsLeft <= 1 && bodyIdx < bodyLines.length
                ? bodyLines.slice(bodyIdx).join(" ")
                : (bodyLines[bodyIdx++] ?? "");
            if (!bodyLine.trim()) {
              slotPartsAssigned.set(slot.slot_index, blockCount);
              while (
                i + 1 < orderedRef.length &&
                slotContainsRefText(slot, orderedRef[i + 1]!.ref_text)
              ) {
                i++;
              }
              continue;
            }
            if (bodySlotsLeft <= 1) bodyIdx = bodyLines.length;
            const splits = splitLineForRefBlocks(bodyLine, slot.block_texts);
            let si = 0;
            for (let j = i; j < orderedRef.length && si < splits.length; j++) {
              if (slotContainsRefText(slot, orderedRef[j]!.ref_text)) {
                out[j] = splits[si++] ?? "";
              }
            }
          }
          slotPartsAssigned.set(slot.slot_index, blockCount);
          while (
            i + 1 < orderedRef.length &&
            slotContainsRefText(slot, orderedRef[i + 1]!.ref_text)
          ) {
            i++;
          }
          continue;
        }
        if (bodySlotsLeft <= 1 && bodyIdx < bodyLines.length) {
          out[i] = bodyLines.slice(bodyIdx).join(" ");
          bodyIdx = bodyLines.length;
        } else {
          out[i] = bodyLines[bodyIdx++] ?? "";
        }
        slotPartsAssigned.set(slot.slot_index, 1);
      }
      continue;
    }

    if (slot.llm_field === "handle") {
      if (partsDone === 0) {
        while (bodyIdx < bodyLines.length && looksLikeInstagramHandleText(bodyLines[bodyIdx]!)) {
          bodyIdx++;
        }
        out[i] = "";
        slotPartsAssigned.set(slot.slot_index, 1);
      }
      continue;
    }

    if (slot.llm_field === "cta") {
      if (partsDone === 0) {
        const slotIdx = copySlots.indexOf(slot);
        const bodySlotsLeft = remainingBodySlotCount(copySlots, slotIdx + 1);
        const pick =
          bodyIdx < bodyLines.length - 1 && bodySlotsLeft === 0
            ? (bodyLines[bodyLines.length - 1] ?? "")
            : (bodyLines[bodyIdx++] ?? "");
        out[i] = pick;
        if (pick === bodyLines[bodyLines.length - 1]) bodyIdx = bodyLines.length;
        slotPartsAssigned.set(slot.slot_index, 1);
      }
      continue;
    }

    if (partsDone === 0) {
      out[i] = bodyLines[bodyIdx++] ?? "";
      slotPartsAssigned.set(slot.slot_index, 1);
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (String(out[i] ?? "").trim() || bodyIdx >= bodyLines.length) continue;
    out[i] = bodyLines[bodyIdx++] ?? "";
  }

  return out;
}

/** Filter overlay blocks using the same rules as render, keyed for slot alignment. */
export function overlayCopyTargetsFromBlocks(
  blocks: MimicReferenceCopyBlock[]
): MimicReferenceCopyBlock[] {
  const asOverlay: OverlayLayoutBlock[] = blocks.map((b) => ({
    text: b.text,
    ref_text: b.text,
    role: b.role,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    align: null,
    font_size_px: null,
    font_weight: null,
    color_hex: null,
    font_family: null,
    source: "document_ai",
  }));
  return filterOverlayLayoutBlocks(asOverlay).map((b, i) => {
    const src = blocks.find((x) => x.text === b.ref_text) ?? blocks[i];
    return src ?? { text: b.ref_text, role: b.role, x: b.x, y: b.y, w: b.w, h: b.h };
  });
}
