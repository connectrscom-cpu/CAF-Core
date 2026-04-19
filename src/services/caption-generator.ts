/**
 * Rough SRT from plain text + target duration (n8n-style, no external API).
 */

export interface SubtitleSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

function splitSentences(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?…])\s+/u).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [t];
}

/** If one long line with no sentence breaks, split on ; or , for extra cues in the same scene. */
function phraseSplitLongLine(text: string): string[] {
  if (text.length < 90) return [text];
  const bySemi = text.split(/;\s+/).map((s) => s.trim()).filter(Boolean);
  if (bySemi.length > 1) return bySemi;
  const byComma = text.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
  if (byComma.length > 1) return byComma;
  return [text];
}

/**
 * Lines to show within one scene (sentence-first, then phrase split for long run-ons).
 * Callers then share that scene’s clip duration across these lines.
 */
export function subtitleLinesForSceneText(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  let parts = splitSentences(t);
  if (parts.length === 1 && parts[0].length > 85) {
    const phrases = phraseSplitLongLine(parts[0]);
    if (phrases.length > 1) return phrases;
  }
  return parts;
}

function mergeLinesIntoGroups(lines: string[], groupCount: number): string[] {
  if (lines.length === 0) return [];
  if (groupCount < 1) return [lines.join(" ").trim()];
  if (lines.length <= groupCount) return lines;
  const out: string[] = [];
  const base = Math.floor(lines.length / groupCount);
  let rem = lines.length % groupCount;
  let idx = 0;
  for (let g = 0; g < groupCount; g++) {
    const take = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push(lines.slice(idx, idx + take).join(" ").trim());
    idx += take;
  }
  return out.filter(Boolean);
}

/** Cap sentence count so each cue gets at least ~minCueSec within the scene window. */
function packSentencesForSceneDuration(
  sentences: string[],
  sceneDurationSec: number,
  minCueSec: number
): string[] {
  if (sentences.length === 0) return [];
  const minC = Math.max(0.55, minCueSec);
  const maxCues = Math.max(1, Math.floor(sceneDurationSec / minC));
  if (sentences.length <= maxCues) return sentences;
  return mergeLinesIntoGroups(sentences, maxCues);
}

/**
 * Map full spoken_script into one string per scene (same order as concat).
 * Prefer consecutive sentence groups; if not enough sentences, split words evenly.
 */
export function splitScriptIntoSceneChunks(text: string, sceneCount: number): string[] {
  if (sceneCount < 1) return [];
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return Array.from({ length: sceneCount }, () => "—");
  const sentences = splitSentences(t);
  if (sentences.length >= sceneCount) {
    const out: string[] = [];
    let base = Math.floor(sentences.length / sceneCount);
    let rem = sentences.length % sceneCount;
    let idx = 0;
    for (let s = 0; s < sceneCount; s++) {
      const n = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      const chunk = sentences.slice(idx, idx + n).join(" ").trim();
      out.push(chunk || "—");
      idx += n;
    }
    return out;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return Array.from({ length: sceneCount }, () => "—");
  const per = Math.max(1, Math.ceil(words.length / sceneCount));
  const out: string[] = [];
  for (let s = 0; s < sceneCount; s++) {
    const chunk = words.slice(s * per, (s + 1) * per).join(" ").trim();
    out.push(chunk || "—");
  }
  return out;
}

/**
 * Split `spoken_script` into one string per scene so word share matches visual clip weights
 * (longer clips get more words). Keeps word order; aligns burned captions with concat timeline
 * when TTS is time-stretched to the same duration.
 */
export function splitScriptIntoSceneChunksByWeights(text: string, weights: number[]): string[] {
  const n = weights.length;
  if (n < 1) return [];
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return Array.from({ length: n }, () => "—");
  const words = t.split(/\s+/).filter(Boolean);
  const W = words.length;
  const wts = weights.map((x) => Math.max(0, Number(x) || 0));
  const sumW = wts.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return splitScriptIntoSceneChunks(t, n);

  const boundaries: number[] = new Array(n + 1).fill(0);
  boundaries[0] = 0;
  for (let i = 1; i < n; i++) {
    const cum = wts.slice(0, i).reduce((a, b) => a + b, 0) / sumW;
    boundaries[i] = Math.round(cum * W);
  }
  boundaries[n] = W;
  for (let i = 1; i <= n; i++) {
    if (boundaries[i]! < boundaries[i - 1]!) boundaries[i] = boundaries[i - 1]!;
  }
  boundaries[n] = W;

  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const slice = words.slice(boundaries[i]!, boundaries[i + 1]!).join(" ").trim();
    out.push(slice || "—");
  }
  return out;
}

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ms = Math.floor((s % 1) * 1000);
  const S = Math.floor(s);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(S).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * One cue per scene (same order as concat). Each cue spans `durationPerLineSec[i]` seconds.
 * `defaultClipSec` pads missing/zero durations (matches SCENE_ASSEMBLY_CLIP_DURATION_SEC).
 */
export function buildSrtFromLinesWithDurations(
  lines: string[],
  durationPerLineSec: number[],
  defaultClipSec = 4
): { srt: string; segments: SubtitleSegment[] } {
  const fill = Number.isFinite(defaultClipSec) && defaultClipSec > 0 ? defaultClipSec : 4;
  const texts = lines.map((s) => {
    const x = s.replace(/\s+/g, " ").trim();
    return x.length > 0 ? x : "—";
  });
  if (texts.length === 0) {
    return { srt: "", segments: [] };
  }
  let durs = durationPerLineSec.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  while (durs.length < texts.length) durs.push(fill);
  durs = durs.slice(0, texts.length);
  durs = durs.map((x) => (x > 0 ? x : fill));
  const segments: SubtitleSegment[] = [];
  let linesOut = "";
  let t = 0;
  for (let i = 0; i < texts.length; i++) {
    const dur = Math.max(0.25, durs[i]!);
    const start = t;
    const end = t + dur;
    segments.push({ index: i + 1, start, end, text: texts[i]! });
    linesOut += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${texts[i]}\n\n`;
    t = end;
  }
  return { srt: linesOut.trimEnd(), segments };
}

/**
 * Multiple SRT cues per scene when narration has several sentences: time is split across the scene’s
 * clip duration (`durationPerSceneSec[i]`). If there are too many sentences for the duration, adjacent
 * sentences are merged so each cue stays readable (~`minCueSec`).
 */
export function buildSrtFromScenesWithSentenceCues(
  sceneTexts: string[],
  durationPerSceneSec: number[],
  defaultClipSec = 4,
  opts?: { minCueSec?: number }
): { srt: string; segments: SubtitleSegment[] } {
  const fill = Number.isFinite(defaultClipSec) && defaultClipSec > 0 ? defaultClipSec : 4;
  const minCueSec = opts?.minCueSec ?? 1.0;
  const texts = sceneTexts.map((s) => {
    const x = s.replace(/\s+/g, " ").trim();
    return x.length > 0 ? x : "—";
  });
  if (texts.length === 0) {
    return { srt: "", segments: [] };
  }
  let durs = durationPerSceneSec.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  while (durs.length < texts.length) durs.push(fill);
  durs = durs.slice(0, texts.length);
  durs = durs.map((x) => (x > 0 ? x : fill));

  const segments: SubtitleSegment[] = [];
  let linesOut = "";
  let globalT = 0;
  let cueNum = 1;

  for (let i = 0; i < texts.length; i++) {
    const D = Math.max(0.25, durs[i]!);
    const raw = subtitleLinesForSceneText(texts[i]!);
    const lines = raw.length > 0 ? packSentencesForSceneDuration(raw, D, minCueSec) : ["—"];
    const n = lines.length;
    for (let j = 0; j < n; j++) {
      const start = globalT + (D * j) / n;
      const end = globalT + (D * (j + 1)) / n;
      segments.push({ index: cueNum, start, end, text: lines[j]! });
      linesOut += `${cueNum}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${lines[j]}\n\n`;
      cueNum++;
    }
    globalT += D;
  }

  return { srt: linesOut.trimEnd(), segments };
}

/** One subtitle block per line, duration split evenly (legacy / when scene durations unknown). */
export function buildRoughSrtFromLines(
  lines: string[],
  durationSec: number
): { srt: string; segments: SubtitleSegment[] } {
  const trimmed = lines.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return { srt: "", segments: [] };
  }
  const slice = Math.max(0.5, durationSec / trimmed.length);
  const segments: SubtitleSegment[] = [];
  let linesOut = "";
  let t = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const start = t;
    const end = i === trimmed.length - 1 ? durationSec : Math.min(durationSec, t + slice);
    segments.push({ index: i + 1, start, end, text: trimmed[i] });
    linesOut += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${trimmed[i]}\n\n`;
    t = end;
  }
  return { srt: linesOut.trimEnd(), segments };
}

/** Default subtitle layout: ~broadcast TV / TikTok cap conventions. */
export const DEFAULT_SRT_MAX_CHARS_PER_LINE = 42;
export const DEFAULT_SRT_MAX_LINES_PER_CUE = 2;
export const DEFAULT_SRT_MAX_WORDS_PER_CUE = 14;

/** Split a sentence's words into cue-sized groups (≤ maxWords AND ≤ maxChars). Preserves order. */
export function chunkWordsForSrtCues(
  words: string[],
  maxWordsPerCue: number,
  maxCharsPerCue: number
): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  let curChars = 0;
  for (const w of words) {
    const addLen = cur.length === 0 ? w.length : curChars + 1 + w.length;
    if (cur.length >= maxWordsPerCue || (cur.length > 0 && addLen > maxCharsPerCue)) {
      groups.push(cur);
      cur = [w];
      curChars = w.length;
    } else {
      cur.push(w);
      curChars = addLen;
    }
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/**
 * Wrap a single cue's text onto at most `maxLines` visible lines (≤ maxCharsPerLine each), splitting on
 * word boundaries closest to the centre so neither line dominates. SRT players (libass) treat literal `\n`
 * inside cue text as a hard line break.
 */
export function wrapCueToLines(text: string, maxLines: number, maxCharsPerLine: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (maxLines <= 1) return t;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return t;
  const total = t.length;
  if (total <= maxCharsPerLine) return t;

  // Two-line case: pick the boundary closest to the middle that still respects per-line caps.
  if (maxLines === 2) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    let acc = 0;
    for (let i = 0; i < words.length - 1; i++) {
      acc += (i === 0 ? 0 : 1) + words[i]!.length;
      const left = acc;
      const right = total - acc - 1;
      if (left > maxCharsPerLine || right > maxCharsPerLine) continue;
      const diff = Math.abs(left - right);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i + 1;
      }
    }
    if (bestIdx < 0) {
      const mid = Math.ceil(words.length / 2);
      return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`;
    }
    return `${words.slice(0, bestIdx).join(" ")}\n${words.slice(bestIdx).join(" ")}`;
  }

  // N>2 lines: greedy per-line packing up to maxCharsPerLine; capped at maxLines.
  const out: string[] = [];
  let line: string[] = [];
  let lineLen = 0;
  for (const w of words) {
    const tentative = line.length === 0 ? w.length : lineLen + 1 + w.length;
    if (line.length > 0 && tentative > maxCharsPerLine) {
      out.push(line.join(" "));
      line = [w];
      lineLen = w.length;
      if (out.length === maxLines - 1) break;
    } else {
      line.push(w);
      lineLen = tentative;
    }
  }
  if (line.length > 0 && out.length < maxLines) out.push(line.join(" "));
  return out.join("\n");
}

/**
 * Build a rough SRT from plain text + total duration.
 *
 * Old behaviour was one cue per sentence, which produced wall-of-text cues for long narrations.
 * New behaviour chunks each sentence into cue-sized groups (≤14 words / ≤84 chars by default) and
 * allocates time **proportional to word count** so playback stays in sync with the underlying TTS.
 * Each cue is then wrapped into at most 2 visible lines (≈42 chars per line) for readability.
 */
export function buildRoughSrt(
  text: string,
  durationSec: number,
  opts?: {
    maxCharsPerLine?: number;
    maxLinesPerCue?: number;
    maxWordsPerCue?: number;
  }
): { srt: string; segments: SubtitleSegment[] } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { srt: "", segments: [] };

  const maxCharsPerLine = Math.max(10, opts?.maxCharsPerLine ?? DEFAULT_SRT_MAX_CHARS_PER_LINE);
  const maxLinesPerCue = Math.max(1, opts?.maxLinesPerCue ?? DEFAULT_SRT_MAX_LINES_PER_CUE);
  const maxWordsPerCue = Math.max(2, opts?.maxWordsPerCue ?? DEFAULT_SRT_MAX_WORDS_PER_CUE);
  const maxCharsPerCue = maxCharsPerLine * maxLinesPerCue;

  const sentences = splitSentences(t);
  if (sentences.length === 0) return { srt: "", segments: [] };

  type Chunk = { text: string; words: number };
  const chunks: Chunk[] = [];
  for (const s of sentences) {
    const ws = s.split(/\s+/).filter(Boolean);
    if (ws.length === 0) continue;
    for (const g of chunkWordsForSrtCues(ws, maxWordsPerCue, maxCharsPerCue)) {
      chunks.push({ text: g.join(" "), words: g.length });
    }
  }
  if (chunks.length === 0) return { srt: "", segments: [] };

  const totalDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;
  const totalWords = chunks.reduce((a, c) => a + c.words, 0) || 1;

  const segments: SubtitleSegment[] = [];
  let out = "";
  let cumWords = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const start = (cumWords / totalWords) * totalDuration;
    cumWords += c.words;
    const end =
      i === chunks.length - 1 ? totalDuration : (cumWords / totalWords) * totalDuration;
    const wrapped = wrapCueToLines(c.text, maxLinesPerCue, maxCharsPerLine);
    segments.push({ index: i + 1, start, end, text: wrapped });
    out += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${wrapped}\n\n`;
  }
  return { srt: out.trimEnd(), segments };
}
