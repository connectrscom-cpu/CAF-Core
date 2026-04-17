import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { joinEmojiOrphanLines, isEmojiOnlyLine } = require("./join-emoji-orphans.js") as {
  joinEmojiOrphanLines: (s: string | null | undefined) => string;
  isEmojiOnlyLine: (s: string) => boolean;
};

describe("joinEmojiOrphanLines", () => {
  it("merges trailing emoji-only line into previous paragraph", () => {
    expect(joinEmojiOrphanLines("Save this for later.\n\n✨")).toBe("Save this for later. ✨");
  });

  it("merges leading emoji-only line into following text", () => {
    expect(joinEmojiOrphanLines("✨\n\nSwipe for more.")).toBe("✨ Swipe for more.");
  });

  it("merges emoji between blank lines into prior text", () => {
    expect(joinEmojiOrphanLines("Hello\n\n\n🔥")).toBe("Hello 🔥");
  });

  it("joins consecutive emoji-only lines then attaches to text", () => {
    expect(joinEmojiOrphanLines("Tip one\n✨\n🔥\nTip two")).toBe("Tip one ✨ 🔥\nTip two");
  });

  it("leaves text-only lines unchanged", () => {
    expect(joinEmojiOrphanLines("A\nB")).toBe("A\nB");
  });
});

describe("isEmojiOnlyLine", () => {
  it("detects emoji-only lines", () => {
    expect(isEmojiOnlyLine("✨")).toBe(true);
    expect(isEmojiOnlyLine("  ✨ 🔥 ")).toBe(true);
  });

  it("rejects lines with letters", () => {
    expect(isEmojiOnlyLine("✨ mood")).toBe(false);
  });
});
