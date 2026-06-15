/**
 * Sentence-aware grouping for mimic carousel body copy before OCR stack assignment.
 */

const SENTENCE_END_RE = /[.!?]["']?\s*$/;

/** Trailing words that should not end a visible text box. */
export const DANGLING_TAIL_RE =
  /\b(for|and|or|to|up|in|on|at|with|but|of|from|into|making|aims|gets|hosts|pursues|cleans|ignores|delivers)\s*$/i;

export function lineContinuesPreviousUnit(previous: string, next: string): boolean {
  const n = String(next ?? "").trim();
  const p = String(previous ?? "").trim();
  if (!n || !p) return false;
  const nextWords = n.split(/\s+/).filter(Boolean);
  if (/^[a-z]/.test(n)) {
    if (nextWords.length >= 2) return true;
    if (n.length >= 3) return true;
    if (n.length >= 2 && DANGLING_TAIL_RE.test(p)) return true;
    return false;
  }
  if (/^[,;:.)]/.test(n)) return true;
  if (/[,;:]\s*$/.test(p) && !SENTENCE_END_RE.test(p)) return true;
  if (nextWords.length === 1 && n.length >= 3 && n.length <= 14 && /^[a-z]/.test(n)) {
    if (DANGLING_TAIL_RE.test(p)) return true;
    if (p.split(/\s+/).length >= 2 && !SENTENCE_END_RE.test(p)) return true;
  }
  return false;
}

/** Join single-word OCR tail fragments (e.g. "icons") onto the previous body line. */
export function joinOrphanWordBodyLines(bodyLines: string[]): string[] {
  const out: string[] = [];
  for (const line of bodyLines.map((l) => String(l ?? "").trim()).filter(Boolean)) {
    const words = line.split(/\s+/);
    if (out.length > 0 && words.length === 1 && line.length >= 4 && line.length <= 14 && /[a-z]/i.test(line)) {
      out[out.length - 1] = `${out[out.length - 1]!} ${line}`.trim();
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Merge micro-lines into complete phrases / sentences (reading order). */
export function bodyLinesToSemanticUnits(bodyLines: string[]): string[] {
  const cleaned = joinOrphanWordBodyLines(bodyLines);
  const units: string[] = [];
  for (const line of cleaned) {
    if (units.length > 0 && lineContinuesPreviousUnit(units[units.length - 1]!, line)) {
      units[units.length - 1] = `${units[units.length - 1]!} ${line}`.replace(/\s+/g, " ").trim();
    } else {
      units.push(line);
    }
  }
  return units;
}

function splitRunOnIntoPhrases(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const bySentence = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySentence.length > 1) return bySentence;
  const byCapital = trimmed
    .split(/(?<=[a-z0-9.,])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byCapital.length > 1) return byCapital;
  return [trimmed];
}

function mergeScoreForPair(left: string, right: string): number {
  let score = 0;
  if (lineContinuesPreviousUnit(left, right)) score += 12;
  if (DANGLING_TAIL_RE.test(left)) score += 10;
  return score;
}

/** Fit semantic units to stack count by merging phrases, never splitting mid-sentence. */
export function fitSemanticUnitsToStackCount(units: string[], stackCount: number): string[] {
  if (stackCount <= 0) return [];
  let work = units.map((u) => u.trim()).filter(Boolean);
  if (work.length === 0) return [];

  if (work.length === 1 && stackCount > 1) {
    work = splitRunOnIntoPhrases(work[0]!);
  }

  while (work.length > stackCount) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < work.length - 1; i++) {
      const score = mergeScoreForPair(work[i]!, work[i + 1]!);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestScore <= 0) break;
    work[bestIdx] = `${work[bestIdx]!} ${work[bestIdx + 1]!}`.replace(/\s+/g, " ").trim();
    work.splice(bestIdx + 1, 1);
  }

  if (work.length > stackCount) {
    const out: string[] = [];
    const per = Math.ceil(work.length / stackCount);
    for (let i = 0; i < stackCount; i++) {
      const chunk = work.slice(i * per, (i + 1) * per);
      if (chunk.length) out.push(chunk.join(" "));
    }
    return out;
  }

  if (work.length < stackCount && work.length === 1) {
    const parts = splitRunOnIntoPhrases(work[0]!);
    if (parts.length > work.length && parts.length <= stackCount) {
      work = parts;
    }
  }

  return work;
}

function stackCenter(stack: Array<{ x: number; y: number; w: number; h: number }>): { x: number; y: number } {
  const x1 = Math.min(...stack.map((b) => b.x));
  const y1 = Math.min(...stack.map((b) => b.y));
  const x2 = Math.max(...stack.map((b) => b.x + b.w));
  const y2 = Math.max(...stack.map((b) => b.y + b.h));
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

function stackCenterDist(
  a: Array<{ x: number; y: number; w: number; h: number }>,
  b: Array<{ x: number; y: number; w: number; h: number }>
): number {
  const ca = stackCenter(a);
  const cb = stackCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * Merge stacks whose text was split mid-phrase (dangling tail + continuation).
 */
export function repairDanglingStackTexts(
  stackTexts: string[],
  stacks: Array<Array<{ x: number; y: number; w: number; h: number }>>,
  opts?: { skipIndices?: number[] }
): string[] {
  const skip = new Set(opts?.skipIndices ?? []);
  const out = [...stackTexts];

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      if (skip.has(i)) continue;
      const text = out[i]?.trim();
      if (!text || !DANGLING_TAIL_RE.test(text)) continue;

      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < out.length; j++) {
        if (i === j || skip.has(j)) continue;
        const other = out[j]?.trim();
        if (!other) continue;
        const dist = stackCenterDist(stacks[i] ?? [], stacks[j] ?? []);
        const continuationBonus = lineContinuesPreviousUnit(text, other) ? -0.2 : 0;
        const score = dist + continuationBonus;
        if (score < bestDist) {
          bestDist = score;
          bestJ = j;
        }
      }
      if (bestJ < 0) continue;
      out[bestJ] = `${text}\n${out[bestJ]!.trim()}`.trim();
      out[i] = "";
      changed = true;
    }
    if (!changed) break;
  }

  return out;
}

/** Body lines → one phrase per stack (semantic, not raw line count). */
export function semanticBodyCopyForStacks(bodyLines: string[], stackCount: number): string[] {
  if (stackCount <= 0) return [];
  const units = bodyLinesToSemanticUnits(bodyLines);
  return fitSemanticUnitsToStackCount(units, stackCount);
}
