import { describe, expect, it } from "vitest";
import {
  ensureOpenAiJsonObjectPromptHints,
  messagesIncludeJsonKeyword,
} from "./openai-json-mode-prompt.js";

describe("openai-json-mode-prompt", () => {
  it("detects json keyword in prompts", () => {
    expect(messagesIncludeJsonKeyword("Return JSON only", "hello")).toBe(true);
    expect(messagesIncludeJsonKeyword("structured output", "use json_object shape")).toBe(true);
    expect(messagesIncludeJsonKeyword("Write a post", "No structured output")).toBe(false);
  });

  it("appends json hint when missing", () => {
    const out = ensureOpenAiJsonObjectPromptHints("You write text posts.", "Generate copy.");
    expect(out.system_prompt.toLowerCase()).toContain("json");
    expect(out.user_prompt).toBe("Generate copy.");
  });

  it("does not duplicate hint when json already present", () => {
    const sys = "Return valid JSON with post_text.";
    const out = ensureOpenAiJsonObjectPromptHints(sys, "Go.");
    expect(out.system_prompt).toBe(sys);
  });
});
