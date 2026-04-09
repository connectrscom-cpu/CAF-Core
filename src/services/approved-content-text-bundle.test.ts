import { describe, expect, it } from "vitest";
import { buildApprovedContentTextBundle } from "./approved-content-text-bundle.js";

describe("buildApprovedContentTextBundle", () => {
  it("includes hook caption and nested generated_output", () => {
    const text = buildApprovedContentTextBundle(
      {
        generated_output: {
          hook: "Test hook",
          caption: "Short caption",
          video_prompt: "Scene 1: ...",
        },
      },
      10_000
    );
    expect(text).toContain("Test hook");
    expect(text).toContain("Short caption");
    expect(text).toContain("video_prompt");
  });

  it("truncates to maxChars", () => {
    const long = "x".repeat(5000);
    const text = buildApprovedContentTextBundle({ generated_output: { hook: long } }, 100);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).toContain("truncated for model context");
  });
});
