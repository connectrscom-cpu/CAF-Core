import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import {
  countWords,
  heygenSpokenScriptWordBoundsFromConfig,
  fitSpokenScriptToWordBudget,
} from "./spoken-script-word-budget.js";

function cfg(partial: Partial<AppConfig>): AppConfig {
  return {
    SCENE_VO_WORDS_PER_MINUTE: 145,
    VIDEO_TARGET_DURATION_MIN_SEC: 30,
    VIDEO_TARGET_DURATION_MAX_SEC: 60,
    ...partial,
  } as AppConfig;
}

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("  a  b  c  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("heygenSpokenScriptWordBoundsFromConfig", () => {
  it("maps 30–60s at 145 WPM to ~73–145 words", () => {
    const { minWords, maxWords } = heygenSpokenScriptWordBoundsFromConfig(cfg({}));
    expect(minWords).toBe(73);
    expect(maxWords).toBe(145);
  });

  it("handles reversed min/max env normalization via loadConfig (here: manual swap)", () => {
    const { minWords, maxWords } = heygenSpokenScriptWordBoundsFromConfig(
      cfg({ VIDEO_TARGET_DURATION_MIN_SEC: 60, VIDEO_TARGET_DURATION_MAX_SEC: 30 })
    );
    expect(minWords).toBe(73);
    expect(maxWords).toBe(145);
  });
});

describe("fitSpokenScriptToWordBudget", () => {
  it("trims when over budget", () => {
    const s = "one two three four five";
    const r = fitSpokenScriptToWordBudget(s, [], 3);
    expect(r.trimmed).toBe(true);
    expect(r.script).toBe("one two three");
  });
});
