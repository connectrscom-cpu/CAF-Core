import { describe, expect, it } from "vitest";
import {
  coerceMimicOverlayCopyText,
  mimicSlideEditableCopyDiffersFromTextBlocks,
  resolveMimicSlideEditableCopyLines,
  sanitizeMimicOverlayCopyText,
} from "./mimic-overlay-copy.js";

describe("coerceMimicOverlayCopyText", () => {
  it("unwraps nested object and array shapes", () => {
    expect(coerceMimicOverlayCopyText({ text: "Libra" })).toBe("Libra");
    expect(coerceMimicOverlayCopyText([{ text: "a" }, { text: "b" }])).toBe("a\nb");
    expect(coerceMimicOverlayCopyText({})).toBe("");
  });

  it("never returns [object Object]", () => {
    expect(sanitizeMimicOverlayCopyText({ foo: "bar" })).toBe("");
    expect(sanitizeMimicOverlayCopyText([{ nested: "x" }])).toBe("");
  });
});

describe("sanitizeMimicOverlayCopyText", () => {
  it("strips br tags and collapses whitespace", () => {
    expect(sanitizeMimicOverlayCopyText("hello<br>world")).toBe("hello\nworld");
    expect(sanitizeMimicOverlayCopyText("a<BR/>b< br >c")).toBe("a\nb\nc");
  });

  it("removes other html tags", () => {
    expect(sanitizeMimicOverlayCopyText("<b>bold</b> text")).toBe("bold text");
  });

  it("resolveMimicSlideEditableCopyLines prefers body newlines", () => {
    expect(
      resolveMimicSlideEditableCopyLines({
        body: "line one\nline two\n@astro_moods",
      })
    ).toEqual(["line one", "line two", "@astro_moods"]);
  });

  it("mimicSlideEditableCopyDiffersFromTextBlocks detects stale OCR text", () => {
    const slide = {
      body: "new copy one\nnew copy two",
      text_blocks: [{ role: "body", text: "old ref one" }, { role: "body", text: "old ref two" }],
    };
    expect(mimicSlideEditableCopyDiffersFromTextBlocks(slide)).toBe(true);
  });
});
