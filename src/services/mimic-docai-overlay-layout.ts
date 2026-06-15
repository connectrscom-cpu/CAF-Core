/**
 * General-purpose Document AI overlay layout rules (not per-carousel hacks).
 * Filters non-copy OCR, collapses paragraph columns, and decides single- vs multi-line render.
 */

import { isHandleTextBlock } from "../domain/instagram-handle.js";

function roleBucket(role: string | null): "headline" | "body" | "cta" | "other" {
  const r = (role ?? "").toLowerCase();
  if (/title|headline|hook|cover|kicker/.test(r)) return "headline";
  if (/cta|handle/.test(r)) return "cta";
  if (/body|subtitle|caption|paragraph|sub/.test(r)) return "body";
  return "other";
}

export type OverlayLayoutBlock = {
  text: string;
  ref_text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  align: string | null;
  font_size_px: number | null;
  font_weight: string | null;
  color_hex: string | null;
  font_family: string | null;
  source: string | null;
};

const CHROME_TEXT_PATTERNS: RegExp[] = [
  /^\+?\s*(send\s+)?message\b/i,
  /^text to your friend/i,
  /^message your\b/i,
  /^type a message/i,
  /^write a message/i,
  /^\d{1,2}:\d{2}\s*(am|pm)?$/i,
  /^tap to\b/i,
  /^slide\s+\d+\s+of\s+\d+/i,
];

/** UI chrome / input placeholders — not valid copy targets. */
export function isOverlayChromeReferenceText(text: string, role: string | null): boolean {
  const t = String(text ?? "").trim();
  if (!t) return true;
  const r = (role ?? "").toLowerCase();
  if (/placeholder|input|timestamp|ui_|chrome|watermark_only/.test(r)) return true;
  if (t.length <= 2 && !/^@/.test(t)) return true;
  for (const re of CHROME_TEXT_PATTERNS) {
    if (re.test(t)) return true;
  }
  if (/^\+$/.test(t)) return true;
  return false;
}

const ZODIAC_SIGN_NAMES = new Set([
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
]);

/** Meme/listicle openers — LLM headline copy, not fixed sign-style labels. */
const MEME_HEADLINE_OPENERS = new Set([
  "most",
  "always",
  "never",
  "when",
  "how",
  "why",
  "what",
  "if",
  "the",
  "your",
  "being",
  "much",
  "desires",
  "enjoys",
  "excuses",
  "actually",
  "has",
  "loves",
  "gets",
  "starts",
  "tries",
  "plays",
]);

function normalizeOverlayText(s: string): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isZodiacSignName(text: string): boolean {
  const token = normalizeOverlayText(text).replace(/[^a-z]/g, "");
  return token.length > 0 && ZODIAC_SIGN_NAMES.has(token);
}

/** Zodiac sign tokens present in a multi-word reference phrase. */
export function zodiacSignTokensInText(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/\s+/)) {
    const token = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (token && ZODIAC_SIGN_NAMES.has(token)) out.push(token);
  }
  return out;
}

const ABSTRACT_HEADLINE_FILLER = new Set([
  "the",
  "a",
  "an",
  "your",
  "their",
  "my",
  "our",
  "and",
  "or",
  "mother",
  "father",
  "friend",
  "energy",
  "vibes",
  "queen",
  "king",
  "type",
  "traits",
  "sign",
  "sis",
  "bro",
  "bae",
]);

/** Meme-quadrant hooks the LLM rewrites — not fixed sign labels. */
function isMemeStyleLlmHeadlinePhrase(text: string): boolean {
  const words = normalizeOverlayText(text).split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const first = words[0]!;
  if (!MEME_HEADLINE_OPENERS.has(first)) return false;
  if (zodiacSignTokensInText(text).length > 0) return false;
  return true;
}

/**
 * Fixed on-slide decor titles (name, segment label, short header) — keep reference OCR at render.
 * Brand handles are excluded; those are substituted with the project @handle elsewhere.
 */
export function isPreserveReferenceDecorText(
  text: string,
  block: Pick<OverlayLayoutBlock, "role" | "x" | "y" | "w" | "h">
): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  if (/^@[\w.]{2,}$/.test(trimmed)) return false;
  if (isOverlayChromeReferenceText(trimmed, block.role)) return false;
  if (/^how you should text\b/i.test(trimmed)) return false;
  if (/^your .+ friend$/i.test(trimmed)) return false;
  if (isMemeStyleLlmHeadlinePhrase(trimmed)) return false;

  const role = (block.role ?? "").toLowerCase();
  const headlineLike = /\b(headline|title|hook|cover|kicker)\b/i.test(role);
  const upperBand = block.y < 0.25;

  if (isZodiacSignName(trimmed) && (upperBand || headlineLike || block.h >= 0.04)) {
    return true;
  }

  if ((headlineLike || upperBand) && zodiacSignTokensInText(trimmed).length > 0) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    const nonFiller = words.filter((w) => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, "");
      if (!lower) return false;
      if (ZODIAC_SIGN_NAMES.has(lower)) return false;
      if (ABSTRACT_HEADLINE_FILLER.has(lower)) return false;
      return true;
    });
    if (nonFiller.length === 0 && words.length <= 6) return true;
  }

  if (headlineLike && block.y < 0.22) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      const w = words[0]!;
      if (isZodiacSignName(w)) return true;
      if (w.length <= 16 && /^[A-Z][a-zA-Z'-]*$/.test(w)) {
        const opener = w.toLowerCase();
        if (!MEME_HEADLINE_OPENERS.has(opener)) return true;
      }
    }
  }

  return false;
}

/** Body/headline box whose reference phrase is the meme title (e.g. ref "most likely" + LLM "Most likely"). */
export function referenceTextMatchesLlmHeadline(
  refText: string,
  headline: string | null | undefined,
  block?: Pick<OverlayLayoutBlock, "role" | "x" | "y" | "w" | "h">
): boolean {
  if (block && isPreserveReferenceDecorText(refText, block)) return false;
  const h = normalizeOverlayText(headline ?? "");
  const r = normalizeOverlayText(refText);
  if (!h || r.length < 3) return false;
  return h === r || h.startsWith(`${r} `) || r.startsWith(`${h} `);
}

/** Brand watermarks / decorative labels — not LLM copy targets. */
export function isOverlayWatermarkReferenceText(
  text: string,
  block: Pick<OverlayLayoutBlock, "h" | "w">
): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  const compact = t.replace(/\s+/g, "").toLowerCase();
  if (/^that'?s you$/i.test(t)) return true;
  if (/marketinglab|mymarketinglab/.test(compact)) return true;
  if (t.length <= 22 && /^[a-z0-9._-]+$/i.test(t) && block.h < 0.04 && block.w < 0.22) return true;
  return false;
}

/** Document AI sometimes merges two distant lines into one full-width micro-band. */
export function isOcrMegaMergeBox(block: Pick<OverlayLayoutBlock, "ref_text" | "role" | "w" | "h">): boolean {
  if (block.w < 0.5) return false;
  const role = (block.role ?? "").toLowerCase();
  if (/headline|title|hook|cover|kicker|subheadline/.test(role)) return false;
  if (isHandleTextBlock(block.role, block.ref_text)) return false;
  const text = block.ref_text.trim();
  if (isChatMockFriendSubtitle(text)) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (block.w >= 0.5 && block.h < 0.09 && words >= 5) return true;
  if (block.w >= 0.65 && words >= 6) return true;
  return false;
}

export function filterOverlayLayoutBlocks<T extends OverlayLayoutBlock>(blocks: T[]): T[] {
  return blocks.filter(
    (b) =>
      !isOverlayChromeReferenceText(b.ref_text, b.role) &&
      !isOverlayWatermarkReferenceText(b.ref_text, b) &&
      !isOcrMegaMergeBox(b)
  );
}

/** Max normalized vertical gap between lines in the same sentence cluster. */
export const MIMIC_STACK_MAX_GAP_NORM = 0.085;

function blockCenterY(b: Pick<OverlayLayoutBlock, "y" | "h">): number {
  return b.y + b.h / 2;
}

/**
 * True when two blocks belong in one vertical stack: small gap OR nested OCR
 * (Document AI sometimes emits a tall parent box around tighter line boxes).
 */
export function blocksVerticallyNestedOrAdjacent(
  upper: Pick<OverlayLayoutBlock, "x" | "y" | "w" | "h">,
  lower: Pick<OverlayLayoutBlock, "x" | "y" | "w" | "h">
): boolean {
  if (!shareVerticalStack(upper, lower)) return false;
  const gap = lower.y - (upper.y + upper.h);
  if (gap >= -0.02 && gap < MIMIC_STACK_MAX_GAP_NORM) return true;
  if (gap < -0.02) {
    const cy = blockCenterY(lower);
    if (cy >= upper.y && cy <= upper.y + upper.h) return true;
    const overlapH = Math.min(upper.y + upper.h, lower.y + lower.h) - Math.max(upper.y, lower.y);
    const minH = Math.min(upper.h, lower.h);
    if (overlapH > 0 && overlapH >= minH * 0.25) return true;
  }
  return false;
}

/**
 * Drop oversized OCR boxes that wrap multiple smaller line-level siblings.
 * Keeps tight per-line targets for stack grouping and copy assignment.
 */
export function dropOcrContainerBoxes<T extends OverlayLayoutBlock>(blocks: T[]): T[] {
  return blocks.filter((outer) => {
    const outerArea = outer.w * outer.h;
    let smallerInside = 0;
    for (const inner of blocks) {
      if (outer === inner) continue;
      const innerArea = inner.w * inner.h;
      if (innerArea >= outerArea * 0.9) continue;
      const cx = inner.x + inner.w / 2;
      const cy = inner.y + inner.h / 2;
      if (cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h) {
        smallerInside++;
      }
    }
    return smallerInside < 2;
  });
}

function stripPossessiveSuffix(word: string): string {
  return word.replace(/['']s$/i, "").trim();
}

function headlineStartsWithDecorTitle(headline: string, decorTitle: string): boolean {
  const h = normalizeOverlayText(headline);
  const d = normalizeOverlayText(decorTitle);
  if (!h || !d) return false;
  if (h === d) return true;
  if (h.startsWith(`${d} `)) return true;
  if (h.startsWith(`${d}s `)) return true;
  const firstWord = headline.trim().split(/\s+/)[0] ?? "";
  const firstCore = normalizeOverlayText(stripPossessiveSuffix(firstWord));
  if (decorTitle.trim().split(/\s+/).length === 1 && firstCore === d) return true;
  return false;
}

function remainderAfterDecorTitle(headline: string, decorTitle: string): string {
  const raw = headline.trim().replace(/\s+/g, " ");
  const decor = decorTitle.trim();
  if (normalizeOverlayText(raw) === normalizeOverlayText(decor)) return "";
  const decorLower = decor.toLowerCase();
  const rawLower = raw.toLowerCase();
  if (rawLower.startsWith(`${decorLower} `)) {
    return raw.slice(decor.length).trim();
  }
  if (rawLower.startsWith(`${decorLower}'s `)) {
    return raw.slice(decor.length + 2).trim();
  }
  if (rawLower.startsWith(`${decorLower}s `)) {
    return raw.slice(decor.length + 1).trim();
  }
  const firstWord = raw.split(/\s+/)[0] ?? "";
  const firstCore = stripPossessiveSuffix(firstWord);
  if (normalizeOverlayText(firstCore) === normalizeOverlayText(decor)) {
    return raw.slice(firstWord.length).trim();
  }
  return "";
}

/**
 * When the layout preserves a fixed decor title (name / label), split LLM `headline`
 * into the preserved title token(s) + the rewriteable hook phrase for body stacks.
 */
function normalizeHeadlineForDecorSplit(headline: string): string {
  return String(headline ?? "")
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

export function splitHeadlineWithPreservedDecorTitle(
  headline: string,
  orderedRef: Array<Pick<OverlayLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">>
): { decorTitle: string; remainder: string } | null {
  const raw = normalizeHeadlineForDecorSplit(headline);
  if (!raw) return null;

  const preserved = orderedRef
    .filter((r) => isPreserveReferenceDecorText(r.ref_text, r))
    .map((r) => r.ref_text.trim())
    .filter(Boolean)
    .sort((a, b) => a.split(/\s+/).length - b.split(/\s+/).length || a.length - b.length);

  for (const decorTitle of preserved) {
    if (!headlineStartsWithDecorTitle(raw, decorTitle)) continue;
    const remainder = remainderAfterDecorTitle(raw, decorTitle);
    if (remainder || normalizeOverlayText(raw) === normalizeOverlayText(decorTitle)) {
      return { decorTitle, remainder };
    }
  }
  return null;
}

function isPreservedDecorTranscriptLine(
  line: string,
  orderedRef: Array<Pick<OverlayLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">>
): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (/^@[\w.]{2,}$/.test(t)) return true;
  return orderedRef.some(
    (r) =>
      isPreserveReferenceDecorText(r.ref_text, r) &&
      normalizeOverlayText(r.ref_text) === normalizeOverlayText(t)
  );
}

function referenceOverlapScoreForRemainder(remainder: string, referenceText: string): number {
  const rem = remainder.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const ref = referenceText.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  let score = 0;
  for (const r of rem) {
    for (const t of ref) {
      if (r === t) score += 3;
      else if (r.length >= 4 && t.length >= 4 && (r.startsWith(t.slice(0, 4)) || t.startsWith(r.slice(0, 4)))) {
        score += 2;
      }
    }
  }
  return score;
}

/** Body copy-slot that should receive the headline remainder after decor title is preserved. */
export function bodySlotIndexForHeadlineRemainder(
  slots: Array<{
    slot_index: number;
    llm_field: string;
    block_texts: string[];
    reference_text?: string;
  }>,
  transcript: string,
  headlineRemainder: string | null | undefined,
  orderedRef: Array<Pick<OverlayLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">>
): number | null {
  const bodySlots = slots.filter((s) => s.llm_field === "body");
  if (bodySlots.length === 0) return null;

  const remainder = String(headlineRemainder ?? "").trim().toLowerCase();
  if (remainder) {
    let bestIdx: number | null = null;
    let bestScore = 0;
    for (const slot of bodySlots) {
      const ref = String(slot.reference_text ?? slot.block_texts.join(" "));
      const score = referenceOverlapScoreForRemainder(remainder, ref);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = slot.slot_index;
      }
    }
    if (bestIdx != null && bestScore > 0) return bestIdx;
  }

  const lines = transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let i = 0;
  while (i < lines.length && isPreservedDecorTranscriptLine(lines[i]!, orderedRef)) {
    i++;
  }
  if (i < lines.length) {
    const firstBodyLine = lines[i]!.toLowerCase();
    for (const slot of bodySlots) {
      const first = slot.block_texts[0]?.trim().toLowerCase() ?? "";
      if (first && first === firstBodyLine) return slot.slot_index;
    }
  }

  if (remainder) {
    const remWords = remainder.split(/\s+/).filter((w) => w.length >= 4);
    let bestIdx: number | null = null;
    let bestScore = 0;
    for (const slot of bodySlots) {
      const ref = String(slot.reference_text ?? slot.block_texts.join(" ")).toLowerCase();
      let score = 0;
      for (const w of remWords) {
        if (ref.includes(w)) score += 4;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = slot.slot_index;
      }
    }
    if (bestIdx != null && bestScore > 0) return bestIdx;
  }

  if (!remainder) return null;

  return bodySlots[0]?.slot_index ?? null;
}

function stackUnionBox(stack: OverlayLayoutBlock[]): { x: number; y: number; w: number; h: number } {
  const x1 = Math.min(...stack.map((b) => b.x));
  const y1 = Math.min(...stack.map((b) => b.y));
  const x2 = Math.max(...stack.map((b) => b.x + b.w));
  const y2 = Math.max(...stack.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: Math.max(0.02, x2 - x1), h: Math.max(0.02, y2 - y1) };
}

function horizontalOverlapRatio(
  a: Pick<OverlayLayoutBlock, "x" | "w">,
  b: Pick<OverlayLayoutBlock, "x" | "w">
): number {
  const a1 = a.x;
  const a2 = a.x + a.w;
  const b1 = b.x;
  const b2 = b.x + b.w;
  const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const union = Math.max(a2, b2) - Math.min(a1, b1);
  return union > 0 ? overlap / union : 0;
}

function blockCenterX(b: Pick<OverlayLayoutBlock, "x" | "w">): number {
  return b.x + b.w / 2;
}

function shareVerticalStack(
  a: Pick<OverlayLayoutBlock, "x" | "w">,
  b: Pick<OverlayLayoutBlock, "x" | "w">
): boolean {
  if (horizontalOverlapRatio(a, b) >= 0.35) return true;
  return Math.abs(blockCenterX(a) - blockCenterX(b)) < 0.07;
}

function groupIntoVerticalStacks(blocks: OverlayLayoutBlock[]): OverlayLayoutBlock[][] {
  const stacks: OverlayLayoutBlock[][] = [];
  for (const block of blocks) {
    let placed = false;
    for (const stack of stacks) {
      if (shareVerticalStack(block, stack[0]!)) {
        stack.push(block);
        placed = true;
        break;
      }
    }
    if (!placed) stacks.push([block]);
  }
  for (const stack of stacks) {
    stack.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return stacks;
}

function isCornerMicroStack(stack: OverlayLayoutBlock[]): boolean {
  if (stack.length === 0) return false;
  const union = stackUnionBox(stack);
  const avgRefLen = stack.reduce((s, b) => s + b.ref_text.trim().length, 0) / stack.length;
  return union.w < 0.42 && avgRefLen <= 36 && stack.length <= 4;
}

function isChatMockFriendSubtitle(text: string): boolean {
  return /^your .+ friend$/i.test(String(text ?? "").trim());
}

export { isChatMockFriendSubtitle };

function verticalGapNorm(
  upper: Pick<OverlayLayoutBlock, "y" | "h">,
  lower: Pick<OverlayLayoutBlock, "y">
): number {
  return lower.y - (upper.y + upper.h);
}

function isParagraphColumnStack(stack: OverlayLayoutBlock[]): boolean {
  if (stack.length <= 1) return false;
  if (stack.some((b) => isChatMockFriendSubtitle(b.ref_text))) return false;
  const union = stackUnionBox(stack);
  if (union.w < 0.4) return false;
  if (union.h > 0.32 && stack.length <= 2) return false;
  for (let i = 1; i < stack.length; i++) {
    if (verticalGapNorm(stack[i - 1]!, stack[i]!) > 0.08) return false;
  }
  const tall = union.h >= 0.1 || stack.some((b) => b.h >= 0.07);
  const refChars = stack.reduce((s, b) => s + b.ref_text.trim().length, 0);
  return tall && (refChars >= 40 || stack.length >= 3);
}

/**
 * Wide center paragraphs: map LLM body to one bbox (largest in stack), not comma-split micro-lines.
 * Corner micro-stacks (meme quadrants) stay separate.
 */
export function collapseParagraphCopyTargets(blocks: OverlayLayoutBlock[]): OverlayLayoutBlock[] {
  const headlines: OverlayLayoutBlock[] = [];
  const handles: OverlayLayoutBlock[] = [];
  const body: OverlayLayoutBlock[] = [];

  for (const block of blocks) {
    if (isHandleTextBlock(block.role, block.ref_text)) {
      handles.push(block);
    } else if (roleBucket(block.role) === "headline") {
      headlines.push(block);
    } else if (roleBucket(block.role) === "cta") {
      handles.push(block);
    } else {
      body.push(block);
    }
  }

  const sortPos = (a: OverlayLayoutBlock, b: OverlayLayoutBlock) => a.y - b.y || a.x - b.x;
  headlines.sort(sortPos);
  handles.sort(sortPos);

  const stacks = groupIntoVerticalStacks(body);
  const collapsedBody: OverlayLayoutBlock[] = [];

  for (const stack of stacks) {
    if (isCornerMicroStack(stack)) {
      collapsedBody.push(...[...stack].sort(sortPos));
      continue;
    }
    if (isParagraphColumnStack(stack)) {
      const best = [...stack].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
      const union = stackUnionBox(stack);
      collapsedBody.push({
        ...best,
        x: union.x,
        y: union.y,
        w: union.w,
        h: union.h,
        role: best.role ?? "paragraph",
      });
      continue;
    }
    collapsedBody.push(...[...stack].sort(sortPos));
  }

  collapsedBody.sort(sortPos);
  return [...headlines, ...collapsedBody, ...handles];
}

function refSuggestsSingleLine(refText: string, hNorm: number, wNorm: number): boolean {
  if (refText.includes("\n")) return false;
  if (refText.split(/\s+/).length <= 1 && refText.length <= 24) return true;
  return hNorm < 0.09 || hNorm / Math.max(wNorm, 0.01) < 0.38;
}

/** Prefer wrap + shrink over hard clip when copy is longer than reference. */
export function shouldRenderDocAiLayerSingleLine(
  refText: string,
  candidateText: string,
  boxWPx: number,
  boxHPx: number
): boolean {
  const candidate = String(candidateText ?? "").trim();
  const ref = String(refText ?? "").trim();
  if (!candidate) {
    const hNorm = boxHPx / 1350;
    const wNorm = boxWPx / 1080;
    return refSuggestsSingleLine(ref, hNorm, wNorm);
  }
  if (candidate.includes("\n")) return false;

  const hNorm = boxHPx / 1350;
  const wNorm = boxWPx / 1080;
  if (boxWPx < 140 && candidate.length > 10) return false;
  const approxCharWidth = 0.52;
  const estFs = Math.max(14, Math.min(boxHPx * 0.85, boxWPx / Math.max(4, candidate.length * approxCharWidth)));
  const charsPerLine = Math.max(6, Math.floor(boxWPx / (estFs * approxCharWidth)));
  const estLines = Math.ceil(candidate.length / charsPerLine);

  if (estLines > 1) return false;
  if (candidate.length > Math.max(ref.length, 12) * 1.35) return false;
  return refSuggestsSingleLine(ref, hNorm, wNorm);
}

/** White highlight pills: wrap long copy so box-decoration-break covers every line/word. */
export function preferSingleLineTextBackLayer(
  text: string,
  boxWPx: number,
  opts?: { forceSingleLine?: boolean; forceMultiLine?: boolean }
): boolean {
  if (opts?.forceMultiLine) return false;
  if (opts?.forceSingleLine) return true;
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (trimmed.split(/\s+/).length === 1 && trimmed.length <= 18) return true;
  const approxCharW = 28;
  const charsPerLine = Math.max(8, Math.floor(boxWPx / approxCharW));
  return trimmed.length <= charsPerLine;
}
