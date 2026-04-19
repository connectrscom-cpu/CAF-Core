import { describe, expect, it } from "vitest";
import {
  DEFAULT_SRT_MAX_CHARS_PER_LINE,
  DEFAULT_SRT_MAX_LINES_PER_CUE,
  DEFAULT_SRT_MAX_WORDS_PER_CUE,
  buildRoughSrt,
  chunkWordsForSrtCues,
  wrapCueToLines,
} from "./caption-generator.js";

const LONG_NARRATION =
  "Ever wonder how your zodiac sign shapes your love life? Aries, known for their fiery passion, often show love through adventurous acts. In contrast, Virgo expresses affection meticulously, paying attention to every detail. When it comes to conflicts, Cancer seeks comfort through empathy, aiming to resolve issues with compassion. Understanding these patterns can enrich your relationships and provide a deeper insight into your romantic dynamics.";

describe("chunkWordsForSrtCues", () => {
  it("respects max words and max chars per cue", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen".split(" ");
    const groups = chunkWordsForSrtCues(words, 6, 84);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const g of groups) {
      expect(g.length).toBeLessThanOrEqual(6);
      expect(g.join(" ").length).toBeLessThanOrEqual(84);
    }
  });
});

describe("wrapCueToLines", () => {
  it("returns text unchanged when within one-line budget", () => {
    expect(wrapCueToLines("Hello world", 2, 42)).toBe("Hello world");
  });

  it("splits into two balanced lines when over the budget", () => {
    const out = wrapCueToLines("Aries known for their fiery passion often show", 2, 42);
    const lines = out.split("\n");
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
    const left = lines[0]!.length;
    const right = lines[1]!.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(20);
  });
});

describe("buildRoughSrt", () => {
  it("returns empty SRT for empty text", () => {
    expect(buildRoughSrt("", 10)).toEqual({ srt: "", segments: [] });
  });

  it("produces multiple cues for a long narration (no wall of text)", () => {
    const { srt, segments } = buildRoughSrt(LONG_NARRATION, 26.462);
    expect(segments.length).toBeGreaterThanOrEqual(6);

    for (const seg of segments) {
      const lines = seg.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(DEFAULT_SRT_MAX_LINES_PER_CUE);
      for (const l of lines) {
        expect(l.length).toBeLessThanOrEqual(DEFAULT_SRT_MAX_CHARS_PER_LINE);
      }
      const words = seg.text.replace(/\s+/g, " ").trim().split(/\s+/);
      expect(words.length).toBeLessThanOrEqual(DEFAULT_SRT_MAX_WORDS_PER_CUE);
    }

    expect(segments[0]!.start).toBe(0);
    expect(segments[segments.length - 1]!.end).toBeCloseTo(26.462, 5);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.start).toBeCloseTo(segments[i - 1]!.end, 5);
    }
    expect(srt).toContain("00:00:00,000");
    expect(srt.split("\n\n").length).toBe(segments.length);
  });

  it("allocates time proportionally to word count (sync)", () => {
    const { segments } = buildRoughSrt(LONG_NARRATION, 60);
    const totalWords = segments
      .map((s) => s.text.replace(/\s+/g, " ").trim().split(/\s+/).length)
      .reduce((a, b) => a + b, 0);
    const expectedSecPerWord = 60 / totalWords;
    for (const s of segments) {
      const w = s.text.replace(/\s+/g, " ").trim().split(/\s+/).length;
      const dur = s.end - s.start;
      const expected = w * expectedSecPerWord;
      expect(Math.abs(dur - expected)).toBeLessThan(0.05);
    }
  });

  it("respects custom layout opts", () => {
    const { segments } = buildRoughSrt(LONG_NARRATION, 30, {
      maxCharsPerLine: 30,
      maxLinesPerCue: 1,
      maxWordsPerCue: 6,
    });
    for (const seg of segments) {
      expect(seg.text.includes("\n")).toBe(false);
      expect(seg.text.length).toBeLessThanOrEqual(30);
      const w = seg.text.split(/\s+/).filter(Boolean).length;
      expect(w).toBeLessThanOrEqual(6);
    }
  });
});
