import { describe, expect, it } from "vitest";
import { detectVideoScriptRuntimeMismatch } from "./video-script-runtime-qc.js";

describe("detectVideoScriptRuntimeMismatch", () => {
  it("flags when estimated runtime implies far more words than dialogue", () => {
    const hit = detectVideoScriptRuntimeMismatch({
      estimated_runtime_seconds: 54,
      dialogue: [
        {
          role: "narrator",
          line: "Geminis are known for their dual nature. Comment your take!",
        },
      ],
    });
    expect(hit).not.toBeNull();
    expect(hit?.actual_word_count).toBeLessThan(hit?.implied_words_at_wpm ?? 0);
    expect(hit?.message).toContain("54s");
  });

  it("returns null when runtime matches spoken length", () => {
    const words = Array.from({ length: 75 }, (_, i) => `word${i}`).join(" ");
    const hit = detectVideoScriptRuntimeMismatch({
      estimated_runtime_seconds: 30,
      dialogue: [{ role: "narrator", line: words }],
    });
    expect(hit).toBeNull();
  });
});
