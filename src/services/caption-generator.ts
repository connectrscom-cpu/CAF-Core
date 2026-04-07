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
  const parts = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [t];
}

function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ms = Math.floor((s % 1) * 1000);
  const S = Math.floor(s);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(S).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
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
