import { describe, expect, it } from "vitest";
import {
  parseCarouselBodyCharScale,
  resolveCarouselBodyCharTargets,
  buildCarouselBodyLengthSystemBlock,
} from "./carousel-body-length.js";

describe("parseCarouselBodyCharScale", () => {
  it("parses numbers and strings", () => {
    expect(parseCarouselBodyCharScale(undefined)).toBe(1);
    expect(parseCarouselBodyCharScale(2)).toBe(2);
    expect(parseCarouselBodyCharScale("2")).toBe(2);
    expect(parseCarouselBodyCharScale("2x")).toBe(2);
    expect(parseCarouselBodyCharScale("0.5x")).toBe(0.5);
    expect(parseCarouselBodyCharScale("half")).toBe(0.5);
  });
});

describe("resolveCarouselBodyCharTargets", () => {
  it("scales platform row and defaults when null", () => {
    const a = resolveCarouselBodyCharTargets({ slide_min_chars: 100, slide_max_chars: 200 }, 2);
    expect(a.scale).toBe(2);
    expect(a.effective_min_chars).toBe(200);
    expect(a.effective_max_chars).toBe(400);

    const b = resolveCarouselBodyCharTargets({}, 1);
    expect(b.effective_min_chars).toBeGreaterThan(0);
    expect(b.effective_max_chars).toBeGreaterThan(b.effective_min_chars);
    expect(b.effective_min_chars).toBeGreaterThanOrEqual(200);
  });
});

describe("buildCarouselBodyLengthSystemBlock", () => {
  it("includes scale and range", () => {
    const t = resolveCarouselBodyCharTargets({ slide_min_chars: 80, slide_max_chars: 160 }, 2);
    const s = buildCarouselBodyLengthSystemBlock(t);
    expect(s).toContain("2×");
    expect(s).toContain(String(t.effective_min_chars));
  });
});
