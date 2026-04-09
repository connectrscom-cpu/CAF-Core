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

export function buildRoughSrt(text: string, durationSec: number): { srt: string; segments: SubtitleSegment[] } {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return { srt: "", segments: [] };
  }
  const slice = Math.max(0.5, durationSec / sentences.length);
  const segments: SubtitleSegment[] = [];
  let lines = "";
  let t = 0;
  for (let i = 0; i < sentences.length; i++) {
    const start = t;
    const end = i === sentences.length - 1 ? durationSec : Math.min(durationSec, t + slice);
    segments.push({ index: i + 1, start, end, text: sentences[i] });
    lines += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${sentences[i]}\n\n`;
    t = end;
  }
  return { srt: lines.trimEnd(), segments };
}
